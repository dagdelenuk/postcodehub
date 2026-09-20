import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep, fetchText } from "./lib/fetch-utils.js";
import { postcodeToOutcode, loadOutcodeIndex } from "./lib/geo.js";
import type { ChildcareProvider } from "../../src/lib/types.js";

const STEP = "childcare";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

const OFSTED_RATING_LABELS: Record<string, string> = {
  "1": "Outstanding",
  "2": "Good",
  "3": "Requires improvement",
  "4": "Inadequate",
  Outstanding: "Outstanding",
  Good: "Good",
  "Requires improvement": "Requires improvement",
  Inadequate: "Inadequate",
};

function normaliseOfstedRating(raw: string | undefined): string | null {
  if (!raw) return null;
  return OFSTED_RATING_LABELS[raw.trim()] ?? null;
}

/** The CSV's own column names have varied release to release (e.g. "Provider Postcode" vs "Postcode") - try each candidate in order. */
function firstColumn(row: Record<string, string>, candidates: string[]): string | undefined {
  for (const name of candidates) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
  }
  return undefined;
}

/**
 * Ofsted's "Childcare providers and inspections: management information"
 * statistical data set is a single stable landing page that gets a fresh CSV
 * attachment added twice a year (as at 31 December / 30 June) - scrape that
 * page for its most recent CSV link rather than guessing a dated URL, same
 * approach as fetch-schools.ts's fetchOfstedRatings() but with one fixed page
 * instead of walking back guessed quarter-end URLs, since this one doesn't
 * get a new URL slug every release.
 */
async function fetchChildcareCsv(): Promise<Record<string, string>[]> {
  const pageUrl = "https://www.gov.uk/government/statistical-data-sets/childcare-providers-and-inspections-management-information";
  const html = await fetchText(pageUrl);
  const matches = [...html.matchAll(/https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[a-z0-9]+\/[^"]*\.csv/gi)];
  // Prefer a file whose name says "all inspections" or "most recent inspections data" over
  // narrower attachments on the same page (e.g. childminder-agency-only extracts).
  const preferred =
    matches.find((m) => /all[_ ]inspections|most[_ ]recent[_ ]inspections[_ ]data/i.test(m[0])) ?? matches[0];
  if (!preferred) throw new Error(`Could not find a childcare providers CSV link on ${pageUrl}`);
  logStep(STEP, `Found childcare providers CSV: ${preferred[0]}`);
  const csvText = await fetchText(preferred[0]);
  return parse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const rows = await fetchChildcareCsv();

  const byOutcode = new Map<string, ChildcareProvider[]>();
  let matched = 0;

  for (const row of rows) {
    const postcode = firstColumn(row, ["Provider Postcode", "Postcode", "Setting Postcode"]);
    const outcode = postcode ? postcodeToOutcode(postcode) : null;
    if (!outcode || !outcodeIndex.has(outcode)) continue;

    const statusRaw = firstColumn(row, ["Registration Status", "Provider Status", "Status"]);
    if (statusRaw && !/^registered$/i.test(statusRaw)) continue;

    matched++;
    const urn = firstColumn(row, ["Provider URN", "URN"]) ?? "";
    const name = firstColumn(row, ["Provider Name", "Setting Name", "Name"]) ?? "Unnamed provider";
    const providerType = firstColumn(row, ["Provider Type", "Setting Type", "Type of Provision"]) ?? "Childcare provider";
    const ratingRaw = firstColumn(row, ["Overall effectiveness", "Latest overall effectiveness", "Overall Effectiveness"]);
    const inspectionDate = firstColumn(row, ["Inspection Date", "Latest Inspection Date", "Inspection date"]) ?? null;
    const placesRaw = firstColumn(row, ["Registered Places", "Places Registered", "Number of Registered Places"]);
    const street = firstColumn(row, ["Provider Address 1", "Address 1", "Setting Address 1"]);
    const town = firstColumn(row, ["Provider Address 3", "Town", "Setting Address 3"]);

    const provider: ChildcareProvider = {
      name,
      urn,
      providerType,
      ofstedRating: normaliseOfstedRating(ratingRaw),
      ofstedLastInspection: inspectionDate,
      registeredPlaces: placesRaw ? Number(placesRaw) : null,
      address: [street, postcode, town].filter(Boolean).join(", "),
      postcode: postcode!,
      latitude: null,
      longitude: null,
    };

    const list = byOutcode.get(outcode) ?? [];
    list.push(provider);
    byOutcode.set(outcode, list);
  }

  logStep(STEP, `Matched ${matched} registered childcare providers across ${byOutcode.size} outcodes.`);

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "childcare-by-outcode.json");
  await writeFile(outPath, JSON.stringify(Object.fromEntries(byOutcode), null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
