import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadOutcodeIndex, postcodeToOutcode } from "./lib/geo.js";
import type { GpSurgery, HealthData } from "../../src/lib/types.js";

const STEP = "health";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const ORD_BASE = "https://directory.spineservices.nhs.uk/ORD/2-0-0";

// NHS ODS role codes, confirmed live against /ORD/2-0-0/roles.
const ROLES = {
  gpSurgeries: "RO177", // GP practice (prescribing cost centre)
  dentists: "RO110", // General dental practice
  pharmacies: "RO182", // Pharmacy
  // ODS has no single clean "hospital" role - NHS trust sites (RO198) and
  // independent-sector provider sites (RO176) both include plenty of
  // non-hospital premises (clinics, schools, care homes), confirmed live,
  // so this is combined with a name filter for "hospital" in fetchCategory.
  hospitals: "RO198,RO176",
} as const;

interface OrgListItem {
  Name: string;
  OrgId: string;
  Status: string;
  PostCode: string;
}

interface OrgListResponse {
  Organisations: OrgListItem[];
}

interface OrgDetailResponse {
  Organisation: {
    GeoLoc?: { Location?: { AddrLn1?: string; AddrLn2?: string; Town?: string; PostCode?: string } };
    Contacts?: { Contact?: { type: string; value: string }[] };
  };
}

async function listActiveOrgs(outcode: string, roleId: string): Promise<OrgListItem[]> {
  const url = `${ORD_BASE}/organisations?PostCode=${encodeURIComponent(outcode)}&Roles=${roleId}&Status=Active&Limit=1000`;
  const data = await withRetry(() => fetchJson<OrgListResponse>(url));
  const orgs = data.Organisations ?? [];
  // The ODS API matches PostCode as a plain string prefix, so a query for "KT1"
  // also returns KT10-KT19 etc. Re-filter to the exact outcode client-side.
  return orgs.filter((org) => postcodeToOutcode(org.PostCode) === outcode);
}

// NHS ODS returns address lines in ALL CAPS ("STATION ROAD, BARNES, LONDON");
// title-case them to match how GIAS's school addresses already read.
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function getOrgDetail(orgId: string): Promise<GpSurgery> {
  const data = await withRetry(() => fetchJson<OrgDetailResponse>(`${ORD_BASE}/organisations/${orgId}`));
  const loc = data.Organisation.GeoLoc?.Location;
  const tel = data.Organisation.Contacts?.Contact?.find((c) => c.type === "tel")?.value;
  const postcode = loc?.PostCode ?? "";
  const addressParts = [loc?.AddrLn1, loc?.AddrLn2, loc?.Town].filter(Boolean).map(toTitleCase);
  if (postcode) addressParts.splice(1, 0, postcode);
  return {
    name: "", // filled in by caller from the list item (detail omits it in some records)
    odsCode: orgId,
    address: addressParts.join(", "),
    postcode,
    telephone: tel,
  };
}

// ODS carries genuine duplicate org records for the same physical site (repeat
// entries under multiple ODS codes, occasional name typos like "Castlenau" vs
// "Castelnau"), so an exact-string dedupe misses them. Cluster same-postcode
// entries by fuzzy name similarity instead, which catches those while leaving
// distinct real organisations that happen to share a generic ODS name (e.g.
// two different "Dental Surgery" practices in different postcodes) alone.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(a, b) / maxLen;
}

const NAME_MATCH_THRESHOLD = 0.82;

function dedupeOrgs(orgs: GpSurgery[]): GpSurgery[] {
  const byPostcode = new Map<string, GpSurgery[]>();
  for (const org of orgs) {
    const key = org.postcode.toUpperCase().replace(/\s+/g, "");
    const list = byPostcode.get(key) ?? [];
    list.push(org);
    byPostcode.set(key, list);
  }

  const deduped: GpSurgery[] = [];
  for (const group of byPostcode.values()) {
    const clusters: { orgs: GpSurgery[]; normName: string }[] = [];
    for (const org of group) {
      const normName = normalizeName(org.name);
      const cluster = clusters.find((c) => nameSimilarity(c.normName, normName) >= NAME_MATCH_THRESHOLD);
      if (cluster) cluster.orgs.push(org);
      else clusters.push({ orgs: [org], normName });
    }
    for (const cluster of clusters) {
      // Shortest address tends to be the cleanest (fewer extra building-name lines);
      // borrow a phone number from a sibling record if the chosen one lacks one.
      const best = [...cluster.orgs].sort((a, b) => a.address.length - b.address.length)[0];
      const telephone = best.telephone ?? cluster.orgs.find((o) => o.telephone)?.telephone;
      deduped.push({ ...best, telephone });
    }
  }
  return deduped;
}

async function fetchCategory(outcode: string, roleId: string, nameFilter?: RegExp): Promise<GpSurgery[]> {
  let orgs = await listActiveOrgs(outcode, roleId);
  if (nameFilter) orgs = orgs.filter((org) => nameFilter.test(org.Name));
  const results: GpSurgery[] = [];
  // Small concurrency + delay: ODS has no published rate limit, but this is a
  // shared public NHS service, so stay polite rather than firing everything at once.
  const CONCURRENCY = 5;
  for (let i = 0; i < orgs.length; i += CONCURRENCY) {
    const batch = orgs.slice(i, i + CONCURRENCY);
    const detailed = await Promise.all(
      batch.map(async (org) => {
        const detail = await getOrgDetail(org.OrgId);
        return { ...detail, name: toTitleCase(org.Name) };
      })
    );
    results.push(...detailed);
    await sleep(150);
  }
  return dedupeOrgs(results);
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const byOutcode: Record<string, HealthData> = {};

  for (const outcode of outcodeIndex.keys()) {
    const [gpSurgeries, dentists, pharmacies, hospitals] = await Promise.all([
      fetchCategory(outcode, ROLES.gpSurgeries),
      fetchCategory(outcode, ROLES.dentists),
      fetchCategory(outcode, ROLES.pharmacies),
      fetchCategory(outcode, ROLES.hospitals, /hospital/i),
    ]);
    byOutcode[outcode] = { gpSurgeries, dentists, pharmacies, hospitals };
    logStep(
      STEP,
      `${outcode}: ${gpSurgeries.length} GPs, ${dentists.length} dentists, ${pharmacies.length} pharmacies, ${hospitals.length} hospitals`
    );
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "health-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byOutcode, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
