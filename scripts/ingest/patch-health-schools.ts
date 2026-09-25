import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { bulkForwardGeocode } from "./lib/postcodes.js";
import type { HealthData, OutcodeData, SchoolsData } from "../../src/lib/types.js";

const STEP = "patch-health-schools";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");

/**
 * Re-merges just the `health` and `schools` sections of every already-built outcode file, from freshly fetched
 * `data/raw/health-by-outcode.json` / `schools-by-outcode.json` (run fetch-health.ts and fetch-schools.ts first).
 *
 * build-outcode-data.ts does the same merge, but needs every other raw source (property, crime, places, transport...) to
 * be present too, which only a full `run-all.ts` pipeline guarantees - too heavy to run on a schedule just to pick up new
 * Ofsted/CQC ratings. This instead patches the two sections in place on top of whatever's already committed, leaving
 * everything else in each file untouched, so it only needs the two raw files these two ingests produce.
 */

async function loadRaw<T>(filename: string): Promise<Record<string, T>> {
  return JSON.parse(await readFile(path.join(RAW_DIR, filename), "utf-8")) as Record<string, T>;
}

/** schools-by-outcode.json is keyed outcode -> School[], not outcode -> { schools: [] } like the merged shape. */
async function loadSchools(): Promise<Record<string, SchoolsData>> {
  const raw = await loadRaw<SchoolsData["schools"]>("schools-by-outcode.json");
  const wrapped: Record<string, SchoolsData> = {};
  for (const [outcode, list] of Object.entries(raw)) wrapped[outcode] = { schools: list };
  return wrapped;
}

async function findOutcodeFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findOutcodeFiles(full);
      return entry.name.endsWith(".json") ? [full] : [];
    })
  );
  return found.flat();
}

async function main() {
  const [health, schools] = await Promise.all([loadRaw<HealthData>("health-by-outcode.json"), loadSchools()]);

  // GP surgeries and schools only carry a postcode from their source APIs (NHS ODS / DfE GIAS) - geocode those here, same
  // as build-outcode-data.ts does, so the card/map toggle's map view still works for anything new since the last full run.
  const postcodes = new Set<string>();
  for (const h of Object.values(health)) for (const org of [...h.gpSurgeries, ...h.dentists, ...h.pharmacies, ...h.hospitals]) if (org.postcode) postcodes.add(org.postcode);
  for (const s of Object.values(schools)) for (const school of s.schools) if (school.postcode) postcodes.add(school.postcode);
  const geocoded = await bulkForwardGeocode([...postcodes]);
  logStep(STEP, `Geocoded ${geocoded.size} of ${postcodes.size} unique health/school postcodes.`);

  function withCoords<T extends { postcode: string }>(item: T): T & { latitude: number | null; longitude: number | null } {
    const g = geocoded.get(item.postcode);
    return { ...item, latitude: g?.latitude ?? null, longitude: g?.longitude ?? null };
  }
  for (const h of Object.values(health)) {
    h.gpSurgeries = h.gpSurgeries.map(withCoords);
    h.dentists = h.dentists.map(withCoords);
    h.pharmacies = h.pharmacies.map(withCoords);
    h.hospitals = h.hospitals.map(withCoords);
  }
  for (const s of Object.values(schools)) s.schools = s.schools.map(withCoords);

  // Every city gets its own subdirectory under data/processed (currently just "london") - the top-level *.json files
  // (hierarchy.json, banners.json, etc.) are separate aggregate datasets, not outcode files, so only directories count.
  const topLevel = await readdir(PROCESSED_DIR, { withFileTypes: true });
  const cityDirs = topLevel.filter((e) => e.isDirectory()).map((e) => path.join(PROCESSED_DIR, e.name));
  const files = (await Promise.all(cityDirs.map(findOutcodeFiles))).flat();
  let patched = 0;
  let missing = 0;
  for (const file of files) {
    const data = JSON.parse(await readFile(file, "utf-8")) as OutcodeData;
    if (typeof data.outcode !== "string" || !data.health || !data.schools) continue; // not an outcode file

    const freshHealth = health[data.outcode];
    const freshSchools = schools[data.outcode];
    if (!freshHealth && !freshSchools) {
      missing++;
      continue;
    }
    data.health = freshHealth ?? data.health;
    data.schools = freshSchools ?? data.schools;
    await writeFile(file, JSON.stringify(data, null, 2));
    patched++;
  }

  logStep(STEP, `Patched health/schools in ${patched} outcode files${missing > 0 ? ` (${missing} had no fresh data for their outcode - left unchanged)` : ""}.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
