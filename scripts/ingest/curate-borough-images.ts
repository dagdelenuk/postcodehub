import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import { readImageDir, writeImageFile } from "./lib/manual-images.js";

const STEP = "curate-borough-images";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");
const DISTRICT_IMAGES_DIR = path.join(PROCESSED_DIR, "district-images");
const OUT_DIR = path.join(PROCESSED_DIR, "borough-images");

const BOROUGH_CAP = 8;

/** No network calls: derives each borough's photo set purely by pooling from the district photos fetch-district-images.ts
 * already chose (one per district, best-first), so nothing here duplicates a Geograph search. City-level photos are a
 * separate, hand-curated collection (data/processed/city-images/) - this script never touches those. */
async function main() {
  const [hierarchy, districtImages] = await Promise.all([loadHierarchy(), readImageDir(DISTRICT_IMAGES_DIR)]);

  if (Object.keys(districtImages).length === 0) {
    logStep(STEP, "WARNING: data/processed/district-images/ is missing or empty - run fetch-district-images.ts first. Nothing to curate.");
    return;
  }

  let written = 0;

  for (const city of hierarchy.cities) {
    for (const borough of city.boroughs) {
      const primary = borough.outcodes.filter((o) => o.isPrimaryBorough);
      const pooled = primary.flatMap((o) => (districtImages[o.slug] ?? []).slice(0, 1));
      if (pooled.length > 0) {
        await writeImageFile(OUT_DIR, borough.slug, pooled.slice(0, BOROUGH_CAP));
        written++;
      }
    }
  }

  logStep(STEP, `Wrote ${written} borough photo files to ${OUT_DIR}.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
