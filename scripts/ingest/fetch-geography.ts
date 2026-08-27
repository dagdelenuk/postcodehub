import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNearbyOutcodes, getOutcode, filterByDistrict } from "./lib/postcodes.js";
import { geocodeBoroughsSequentially } from "./lib/nominatim.js";
import { logStep } from "./lib/fetch-utils.js";
import type { Hierarchy, HierarchyOutcode } from "../../src/lib/types.js";

const STEP = "geography";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");

const CITY = { name: "London", slug: "london" };

// All 33 London boroughs (32 boroughs + the City of London), the name used to
// match postcodes.io's admin_district field.
const LONDON_BOROUGHS = [
  "Barking and Dagenham",
  "Barnet",
  "Bexley",
  "Brent",
  "Bromley",
  "Camden",
  "City of London",
  "Croydon",
  "Ealing",
  "Enfield",
  "Greenwich",
  "Hackney",
  "Hammersmith and Fulham",
  "Haringey",
  "Harrow",
  "Havering",
  "Hillingdon",
  "Hounslow",
  "Islington",
  "Kensington and Chelsea",
  "Kingston upon Thames",
  "Lambeth",
  "Lewisham",
  "Merton",
  "Newham",
  "Redbridge",
  "Richmond upon Thames",
  "Southwark",
  "Sutton",
  "Tower Hamlets",
  "Waltham Forest",
  "Wandsworth",
  "Westminster",
] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function discoverBoroughOutcodes(
  boroughName: string,
  centroid: { latitude: number; longitude: number; radiusMetres: number }
): Promise<HierarchyOutcode[]> {
  const nearby = await findNearbyOutcodes(centroid.latitude, centroid.longitude, centroid.radiusMetres, 100);
  const matches = filterByDistrict(nearby, boroughName);

  const outcodes: HierarchyOutcode[] = [];
  for (const candidate of matches) {
    const detail = await getOutcode(candidate.outcode);
    outcodes.push({
      outcode: detail.outcode,
      slug: slugify(detail.outcode),
      latitude: detail.latitude,
      longitude: detail.longitude,
      wards: detail.admin_ward,
      parliamentaryConstituency: detail.parliamentary_constituency[0] ?? "",
    });
  }
  outcodes.sort((a, b) => a.outcode.localeCompare(b.outcode));
  return outcodes;
}

async function main() {
  logStep(STEP, `Geocoding ${LONDON_BOROUGHS.length} London boroughs via Nominatim (rate-limited to 1/sec)...`);
  const geocoded = await geocodeBoroughsSequentially([...LONDON_BOROUGHS]);

  const hierarchy: Hierarchy = { cities: [{ name: CITY.name, slug: CITY.slug, boroughs: [] }] };
  const city = hierarchy.cities[0];

  let totalOutcodes = 0;
  for (const boroughName of LONDON_BOROUGHS) {
    const centroid = geocoded.get(boroughName)!;
    const outcodes = await discoverBoroughOutcodes(boroughName, centroid);
    if (outcodes.length === 0) {
      logStep(STEP, `WARNING: 0 outcodes found for "${boroughName}" — skipping.`);
      continue;
    }
    city.boroughs.push({ name: boroughName, slug: slugify(boroughName), outcodes });
    totalOutcodes += outcodes.length;
    logStep(STEP, `${boroughName}: ${outcodes.length} outcodes (radius ${Math.round(centroid.radiusMetres / 1000)}km)`);
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  const outPath = path.join(PROCESSED_DIR, "hierarchy.json");
  await writeFile(outPath, JSON.stringify(hierarchy, null, 2));
  logStep(
    STEP,
    `Wrote ${outPath}: ${city.boroughs.length} boroughs, ${totalOutcodes} outcode entries (boundary outcodes counted once per borough they touch).`
  );
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
