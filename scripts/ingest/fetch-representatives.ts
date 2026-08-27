import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, fetchText, logStep, withRetry } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, loadOutcodeBoroughPairs, loadOutcodeIndex } from "./lib/geo.js";
import { COUNCIL_CONFIG } from "./lib/councils.js";
import type { Representative, RepresentativesData } from "../../src/lib/types.js";

const STEP = "representatives";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

// A realistic browser UA clears basic bot-checks some councils' sites have
// (confirmed necessary for a couple during research); it does nothing against
// a full Cloudflare JS challenge, which some other councils sit behind - those
// are detected (no "mgSectionTitle" marker in the response) and skipped below
// rather than producing empty/garbage data silently.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

interface ConstituencySearchResponse {
  items: {
    value: {
      name: string;
      currentRepresentation?: {
        member?: {
          value?: {
            nameDisplayAs: string;
            latestParty?: { name: string };
          };
        };
      };
    };
  }[];
}

async function fetchMp(constituency: string): Promise<Representative | null> {
  const url = `https://members-api.parliament.uk/api/Location/Constituency/Search?searchText=${encodeURIComponent(constituency)}`;
  const data = await withRetry(() => fetchJson<ConstituencySearchResponse>(url));
  const match = data.items.find((i) => i.value.name.toLowerCase() === constituency.toLowerCase()) ?? data.items[0];
  const member = match?.value.currentRepresentation?.member?.value;
  if (!member) return null;
  return {
    role: "MP",
    name: member.nameDisplayAs,
    party: member.latestParty?.name ?? "Unknown",
    constituency,
    contactUrl: "https://www.parliament.uk/mps-lords-and-offices/mps/",
  };
}

/** Parses a ModernGov "councillors by ward" HTML page. Returns null if the page isn't actually ModernGov. */
function parseModerngovCouncillors(html: string, contactUrl: string): Map<string, Representative[]> | null {
  if (!html.includes("mgSectionTitle")) return null;

  const byWard = new Map<string, Representative[]>();
  const sections = html.split('<h2 class="mgSectionTitle">&nbsp;').slice(1);
  for (const section of sections) {
    const [wardRaw, body] = section.split("</h2>", 2);
    const ward = wardRaw.trim();
    const items = [
      ...body.matchAll(/Councillor ([^<]+)<\/a>\s*<p>([^<]*)<\/p>\s*(?:<!--.*?-->\s*)?<p>([^<]*)<\/p>/g),
    ];
    const reps: Representative[] = items.map(([, name, , party]) => ({
      role: "Councillor",
      name: name.trim(),
      party: party.trim() || "Independent",
      ward,
      contactUrl,
    }));
    byWard.set(ward, reps);
  }
  return byWard;
}

async function fetchCouncillorsByWard(boroughName: string): Promise<Map<string, Representative[]>> {
  const config = COUNCIL_CONFIG[boroughName];
  if (!config?.councillorsUrl) {
    logStep(STEP, `${boroughName}: no verified councillors URL — skipping (honest gap, not fabricated).`);
    return new Map();
  }

  try {
    // Belt-and-suspenders on top of fetchText's own per-request timeout: a
    // stalled body read on a Cloudflare-challenged host has been observed to
    // outlast individual request timeouts across retries, so cap the whole
    // borough at a hard wall-clock budget rather than let one host stall the
    // entire 33-borough pipeline.
    const html = await Promise.race([
      withRetry(() => fetchText(config.councillorsUrl!, { headers: BROWSER_HEADERS }), { retries: 1, baseDelayMs: 1000 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hard 25s borough budget exceeded")), 25000)),
    ]);
    const byWard = parseModerngovCouncillors(html, config.councillorsUrl!.split("/mg")[0] ?? config.councillorsUrl!);
    if (!byWard) {
      logStep(STEP, `${boroughName}: fetched councillors page but it didn't match the expected ModernGov structure (likely blocked, e.g. Cloudflare challenge) — skipping.`);
      return new Map();
    }
    logStep(STEP, `${boroughName}: scraped councillors for ${byWard.size} wards.`);
    return byWard;
  } catch (err) {
    logStep(STEP, `${boroughName}: councillors fetch failed (${(err as Error).message}) — skipping.`);
    return new Map();
  }
}

async function main() {
  // MP lookup is genuinely borough-agnostic (constituency-based, and a given
  // outcode's constituency is the same regardless of which borough's page you
  // reach it from), so the deduplicated index is fine and avoids redundant
  // Parliament API calls for shared outcodes.
  const outcodeIndex = await loadOutcodeIndex();
  const constituencies = new Set(
    [...outcodeIndex.values()].map((e) => e.outcode.parliamentaryConstituency).filter(Boolean)
  );
  const mpByConstituency = new Map<string, Representative>();
  for (const constituency of constituencies) {
    const mp = await fetchMp(constituency);
    if (mp) mpByConstituency.set(constituency, mp);
    logStep(STEP, `${constituency}: MP ${mp?.name ?? "not found"}`);
  }

  // Councillors are genuinely borough-specific, so use every (borough,
  // outcode) pair - a shared outcode gets each borough's own councillors.
  const pairs = await loadOutcodeBoroughPairs();
  const boroughNames = new Set(pairs.map((e) => e.borough));
  const councillorsByWardPerBorough = new Map<string, Map<string, Representative[]>>();
  for (const boroughName of boroughNames) {
    councillorsByWardPerBorough.set(boroughName, await fetchCouncillorsByWard(boroughName));
  }

  const byKey: Record<string, RepresentativesData> = {};
  for (const entry of pairs) {
    const representatives: Representative[] = [];
    const mp = mpByConstituency.get(entry.outcode.parliamentaryConstituency);
    if (mp) representatives.push(mp);
    const councillorsByWard = councillorsByWardPerBorough.get(entry.borough);
    if (councillorsByWard) {
      for (const ward of entry.outcode.wards) {
        const reps = councillorsByWard.get(ward);
        if (reps) representatives.push(...reps);
      }
    }
    byKey[boroughOutcodeKey(entry.boroughSlug, entry.outcode.outcode)] = { representatives };
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "representatives-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byKey, null, 2));
  logStep(STEP, `Wrote ${outPath} for ${Object.keys(byKey).length} outcode pages.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
