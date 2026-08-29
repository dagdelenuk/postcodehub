import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { fetchOsmStations } from "./lib/osm-amenities.js";

const STEP = "fire-stations";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

async function main() {
  const stations = await fetchOsmStations(STEP, "fire_station", "Fire Station");

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "fire-stations.json");
  await writeFile(outPath, JSON.stringify(stations, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
