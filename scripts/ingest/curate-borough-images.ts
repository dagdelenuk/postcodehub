import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import { fromOverridesFile, toOverridesFile, type ImageOverridesFile } from "./lib/manual-images.js";
import type { BannerImage } from "../../src/lib/types.js";

const STEP = "curate-borough-images";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");
const DISTRICT_IMAGES_PATH = path.join(PROCESSED_DIR, "district-images.json");
const OUT_PATH = path.join(PROCESSED_DIR, "place-images.json");
const MANUAL_OVERRIDES_PATH = path.resolve(__dirname, "../../data/manual/geograph-overrides.json");

const BOROUGH_CAP = 8;
const CITY_CAP = 12;

interface OverrideEntry {
  slug: string;
  locked?: boolean;
}

async function loadLockedSlugs(): Promise<Set<string>> {
  let parsed: { overrides?: OverrideEntry[] };
  try {
    parsed = JSON.parse(await readFile(MANUAL_OVERRIDES_PATH, "utf-8")) as { overrides?: OverrideEntry[] };
  } catch {
    return new Set();
  }
  return new Set((parsed.overrides ?? []).filter((o) => o.locked).map((o) => o.slug));
}

/** No network calls: derives borough/city photo sets purely by pooling from the district photos fetch-district-images.ts
 * already chose (one per district, best-first), so nothing here duplicates a Geograph search. */
async function main() {
  const [hierarchy, districtImages, locked, existing] = await Promise.all([
    loadHierarchy(),
    readFile(DISTRICT_IMAGES_PATH, "utf-8")
      .then((raw) => fromOverridesFile(JSON.parse(raw) as ImageOverridesFile))
      .catch(() => ({}) as Record<string, BannerImage[]>),
    loadLockedSlugs(),
    readFile(OUT_PATH, "utf-8")
      .then((raw) => fromOverridesFile(JSON.parse(raw) as ImageOverridesFile))
      .catch(() => ({}) as Record<string, BannerImage[]>),
  ]);

  if (Object.keys(districtImages).length === 0) {
    logStep(STEP, "WARNING: data/processed/district-images.json is missing or empty - run fetch-district-images.ts first. Nothing to curate.");
    return;
  }

  const result: Record<string, BannerImage[]> = { ...existing, ...districtImages };

  for (const city of hierarchy.cities) {
    const cityPool: BannerImage[] = [];
    for (const borough of city.boroughs) {
      if (locked.has(borough.slug)) {
        cityPool.push(...(result[borough.slug] ?? []).slice(0, 1));
        continue;
      }
      const primary = borough.outcodes.filter((o) => o.isPrimaryBorough);
      const pooled = primary.flatMap((o) => (districtImages[o.slug] ?? []).slice(0, 1));
      if (pooled.length > 0) {
        const boroughImages = pooled.slice(0, BOROUGH_CAP);
        result[borough.slug] = boroughImages;
        cityPool.push(...boroughImages.slice(0, 1));
      }
    }
    if (!locked.has(city.slug) && cityPool.length > 0) result[city.slug] = cityPool.slice(0, CITY_CAP);
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(toOverridesFile(result), null, 2));
  logStep(STEP, `Wrote ${OUT_PATH} (${Object.keys(result).length} places with photos).`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
