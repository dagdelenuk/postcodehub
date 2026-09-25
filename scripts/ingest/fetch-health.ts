import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, fetchText, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadOutcodeIndex, postcodeToOutcode } from "./lib/geo.js";
import { streamOdsSheetRows } from "./lib/ods.js";
import type { GpSurgery, HealthData } from "../../src/lib/types.js";

const STEP = "health";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const ORD_BASE = "https://directory.spineservices.nhs.uk/ORD/2-0-0";
const CQC_DATA_PAGE = "https://www.cqc.org.uk/about-us/transparency/using-cqc-data";

// GP practices are the only ODS category CQC rates on its Outstanding/Good/Requires improvement/Inadequate scale in a way
// that's both matchable by ODS code and actually populated: pharmacies aren't CQC-regulated at all (that's the GPhC),
// hospitals in the ODS list don't carry a usable CQC-matching ODS code, and CQC's own data confirms dental practices are
// almost universally marked "Not applicable" for an overall rating (verified live: 4,008 of 4,016 English dental locations),
// so showing "no rating" for nearly every dentist would just be noise rather than useful signal.
const CQC_MATCHED_CATEGORIES = new Set(["GP Practices"]);
const CQC_GRADED_RATINGS = new Set(["Outstanding", "Good", "Requires improvement", "Inadequate"]);

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

interface CqcRating {
  rating: string;
  lastInspection: string | null;
  url: string | null;
}

/**
 * CQC's "Care directory with ratings" is a monthly ODS export (no API key needed, unlike their Syndication API) with one
 * row per location per rating domain (Safe/Effective/Caring/Responsive/Well-led/Overall) per service population group, so
 * the same location's Overall row repeats several times with identical values - only its "Location ODS Code" is unique per
 * location, and only GP practices carry one that lines up with the ODS codes fetched above (see CQC_MATCHED_CATEGORIES).
 */
async function fetchCqcRatings(): Promise<Map<string, CqcRating>> {
  const ratings = new Map<string, CqcRating>();
  try {
    const page = await fetchText(CQC_DATA_PAGE);
    const match = page.match(/https:\/\/www\.cqc\.org\.uk\/system\/files\/[^"]*Latest_ratings\.ods/);
    if (!match) {
      logStep(STEP, "WARNING: could not find the CQC 'Care directory with ratings' file link — proceeding without CQC ratings.");
      return ratings;
    }
    const url = match[0];
    const dest = path.join(RAW_DIR, "cqc-latest-ratings.ods");
    await mkdir(RAW_DIR, { recursive: true });
    logStep(STEP, `Downloading ${url}...`);
    const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));

    // ~250k locations x up to 6 domain rows x several population groups makes this sheet's XML over a gigabyte uncompressed
    // - well past Node's maximum string length - so it's streamed row by row rather than read into memory at once.
    let idx: Record<string, number> | null = null;
    let rowNum = 0;
    await streamOdsSheetRows(dest, "Locations", (row) => {
      rowNum++;
      if (rowNum === 1) {
        const col = (name: string) => row.indexOf(name);
        idx = { odsCode: col("Location ODS Code"), category: col("Location Primary Inspection Category"), rating: col("Latest Rating"), domain: col("Domain"), reportType: col("Report Type"), date: col("Publication Date"), url: col("URL") };
        if (Object.values(idx).some((i) => i === -1)) idx = null;
        return;
      }
      if (!idx) return; // header didn't match what we expect - skip every row rather than misread columns
      if (row[idx.domain] !== "Overall" || row[idx.reportType] !== "Location") return;
      const odsCode = row[idx.odsCode];
      const category = row[idx.category];
      const rating = row[idx.rating];
      if (typeof odsCode !== "string" || !odsCode || typeof category !== "string" || !CQC_MATCHED_CATEGORIES.has(category)) return;
      if (typeof rating !== "string" || !CQC_GRADED_RATINGS.has(rating)) return;
      const dateRaw = row[idx.date];
      ratings.set(odsCode, {
        rating,
        lastInspection: typeof dateRaw === "string" ? dateRaw.slice(0, 10) : null,
        url: typeof row[idx.url] === "string" ? (row[idx.url] as string) : null,
      });
    });
    if (rowNum === 0) {
      logStep(STEP, "WARNING: CQC ratings sheet 'Locations' was empty or not found — proceeding without CQC ratings.");
    } else if (ratings.size === 0) {
      logStep(STEP, "WARNING: CQC ratings file header didn't match the expected columns — proceeding without CQC ratings.");
    } else {
      logStep(STEP, `Loaded CQC ratings for ${ratings.size} GP practices.`);
    }
  } catch (err) {
    logStep(STEP, `WARNING: fetching CQC ratings failed (${(err as Error).message}) — proceeding without CQC ratings.`);
  }
  return ratings;
}

/** Merges a CQC rating onto each org by NHS ODS code, returning a fresh array (only meaningful for the GP surgeries list). */
function mergeCqcRatings(orgs: GpSurgery[], cqcRatings: Map<string, CqcRating>): GpSurgery[] {
  return orgs.map((org) => {
    const cqc = cqcRatings.get(org.odsCode);
    return cqc ? { ...org, cqcRating: cqc.rating, cqcLastInspection: cqc.lastInspection, cqcUrl: cqc.url } : { ...org, cqcRating: null, cqcLastInspection: null, cqcUrl: null };
  });
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
  const cqcRatings = await fetchCqcRatings();
  const byOutcode: Record<string, HealthData> = {};

  for (const outcode of outcodeIndex.keys()) {
    const [gpSurgeries, dentists, pharmacies, hospitals] = await Promise.all([
      fetchCategory(outcode, ROLES.gpSurgeries),
      fetchCategory(outcode, ROLES.dentists),
      fetchCategory(outcode, ROLES.pharmacies),
      fetchCategory(outcode, ROLES.hospitals, /hospital/i),
    ]);
    byOutcode[outcode] = { gpSurgeries: mergeCqcRatings(gpSurgeries, cqcRatings), dentists, pharmacies, hospitals };
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
