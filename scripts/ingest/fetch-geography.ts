import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOutcode } from "./lib/postcodes.js";
import { ensureNsplZip, listZipEntries, readLadNameLookup, readNsplArea } from "./lib/nspl.js";
import { logStep, sleep } from "./lib/fetch-utils.js";
import type { Hierarchy, HierarchyOutcode } from "../../src/lib/types.js";

const STEP = "geography";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const NSPL_ZIP_PATH = path.join(RAW_DIR, "nspl.zip");

const CITY = { name: "London", slug: "london" };

// All 33 London boroughs (32 boroughs + the City of London). Matched by exact
// name against ONS's own LAD25NM field (confirmed live - all 33 match with no
// "Royal Borough of"/"City of" naming quirks in NSPL's own lookup, unlike
// some other data sources used elsewhere in this pipeline).
const LONDON_BOROUGHS = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden",
  "City of London", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney",
  "Hammersmith and Fulham", "Haringey", "Harrow", "Havering", "Hillingdon",
  "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge",
  "Richmond upon Thames", "Southwark", "Sutton", "Tower Hamlets",
  "Waltham Forest", "Wandsworth", "Westminster",
] as const;

// Postcode-AREA prefixes (the 1-2 letter part before the district digits)
// that plausibly reach into Greater London. Being generous here is harmless -
// real per-postcode LAD data (not this list) decides what actually counts.
const AREA_PREFIXES = [
  "BR", "CM", "CR", "DA", "E", "EC", "EN", "HA", "IG", "KT", "N", "NW", "RM",
  "SE", "SM", "SW", "TN", "TW", "UB", "W", "WC", "WD",
];

// A "touching" borough must have at least this share of an outcode's real
// postcodes to count - otherwise a borough that just barely clips an
// outcode's edge gets it listed (and, worse, summed into totals). Matches
// the external audit report's own suggested floor.
const PRIMARY_THRESHOLD = 0.05;

// Below this many real small-user postcodes, an outcode is too
// small/non-standard to be worth its own page (catches single-organisation
// "large user" remnants and other NSPL edge cases - confirmed live against
// the previously-published "NW26", which turned out to be 100% large-user
// postcodes, i.e. one organisation's mail code, not a neighbourhood).
const MIN_SMALL_USER_POSTCODES = 20;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface OutcodeTally {
  count: number;
  latSum: number;
  lonSum: number;
}

interface OutcodeAssignment {
  outcode: string;
  latitude: number;
  longitude: number;
  primaryLad: string;
  touchingLads: Set<string>;
  totalPostcodes: number;
}

async function main() {
  await ensureNsplZip(NSPL_ZIP_PATH);
  const entries = listZipEntries(NSPL_ZIP_PATH);
  const ladNames = readLadNameLookup(NSPL_ZIP_PATH, entries);

  const boroughLadCode = new Map<string, string>();
  for (const [code, name] of ladNames) {
    if ((LONDON_BOROUGHS as readonly string[]).includes(name)) boroughLadCode.set(name, code);
  }
  const missingBoroughs = LONDON_BOROUGHS.filter((b) => !boroughLadCode.has(b));
  if (missingBoroughs.length > 0) {
    throw new Error(`NSPL's LAD lookup doesn't contain: ${missingBoroughs.join(", ")} - check LAD25NM naming hasn't changed.`);
  }

  // outcode -> ladCode -> tally
  const tally = new Map<string, Map<string, OutcodeTally>>();
  for (const prefix of AREA_PREFIXES) {
    const rows = readNsplArea(NSPL_ZIP_PATH, entries, prefix);
    let kept = 0;
    for (const row of rows) {
      if (row.terminated || row.largeUser) continue;
      kept++;
      let ladMap = tally.get(row.outcode);
      if (!ladMap) {
        ladMap = new Map();
        tally.set(row.outcode, ladMap);
      }
      const t = ladMap.get(row.ladCode) ?? { count: 0, latSum: 0, lonSum: 0 };
      t.count++;
      t.latSum += row.lat;
      t.lonSum += row.lon;
      ladMap.set(row.ladCode, t);
    }
    logStep(STEP, `NSPL area ${prefix}: ${rows.length} rows, ${kept} real small-user postcodes kept.`);
  }

  const assignments: OutcodeAssignment[] = [];
  for (const [outcode, ladMap] of tally) {
    const total = [...ladMap.values()].reduce((sum, t) => sum + t.count, 0);
    if (total < MIN_SMALL_USER_POSTCODES) continue;

    let primaryLad = "";
    let primaryCount = -1;
    let latSum = 0;
    let lonSum = 0;
    const touchingLads = new Set<string>();
    for (const [lad, t] of ladMap) {
      latSum += t.latSum;
      lonSum += t.lonSum;
      if (t.count > primaryCount) {
        primaryCount = t.count;
        primaryLad = lad;
      }
      if (t.count / total >= PRIMARY_THRESHOLD) touchingLads.add(lad);
    }
    assignments.push({ outcode, latitude: latSum / total, longitude: lonSum / total, primaryLad, touchingLads, totalPostcodes: total });
  }
  logStep(STEP, `${assignments.length} real outcodes pass the ${MIN_SMALL_USER_POSTCODES}-postcode floor.`);

  // Only outcodes that touch at least one of our 33 boroughs matter from here.
  const londonLadCodes = new Set(boroughLadCode.values());
  const relevant = assignments.filter((a) => [...a.touchingLads].some((lad) => londonLadCodes.has(lad)));
  logStep(STEP, `${relevant.length} outcodes touch at least one London borough at the ${Math.round(PRIMARY_THRESHOLD * 100)}% floor.`);

  // Enrich each unique outcode once (wards, constituency) - cached so a
  // boundary outcode shared by several boroughs only costs one API call.
  const enrichment = new Map<string, { wards: string[]; constituency: string }>();
  let i = 0;
  for (const a of relevant) {
    i++;
    try {
      const detail = await getOutcode(a.outcode);
      enrichment.set(a.outcode, { wards: detail.admin_ward, constituency: detail.parliamentary_constituency[0] ?? "" });
    } catch {
      enrichment.set(a.outcode, { wards: [], constituency: "" });
    }
    if (i % 50 === 0) logStep(STEP, `Enriched ${i}/${relevant.length} outcodes via postcodes.io...`);
    await sleep(50);
  }

  const hierarchy: Hierarchy = { cities: [{ name: CITY.name, slug: CITY.slug, boroughs: [] }] };
  const city = hierarchy.cities[0];

  for (const boroughName of LONDON_BOROUGHS) {
    const ladCode = boroughLadCode.get(boroughName)!;
    const outcodes: HierarchyOutcode[] = [];
    for (const a of relevant) {
      if (!a.touchingLads.has(ladCode)) continue;
      const e = enrichment.get(a.outcode)!;
      outcodes.push({
        outcode: a.outcode,
        slug: slugify(a.outcode),
        latitude: a.latitude,
        longitude: a.longitude,
        wards: e.wards,
        parliamentaryConstituency: e.constituency,
        isPrimaryBorough: a.primaryLad === ladCode,
      });
    }
    outcodes.sort((x, y) => x.outcode.localeCompare(y.outcode));
    city.boroughs.push({ name: boroughName, slug: slugify(boroughName), outcodes });
    const primaryCount = outcodes.filter((o) => o.isPrimaryBorough).length;
    logStep(STEP, `${boroughName}: ${outcodes.length} outcodes (${primaryCount} primary)`);
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  const outPath = path.join(PROCESSED_DIR, "hierarchy.json");
  await writeFile(outPath, JSON.stringify(hierarchy, null, 2));
  const totalPairs = city.boroughs.reduce((sum, b) => sum + b.outcodes.length, 0);
  const uniqueOutcodes = new Set(city.boroughs.flatMap((b) => b.outcodes.map((o) => o.outcode))).size;
  logStep(STEP, `Wrote ${outPath}: ${city.boroughs.length} boroughs, ${uniqueOutcodes} unique outcodes, ${totalPairs} borough-outcode pairs.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
