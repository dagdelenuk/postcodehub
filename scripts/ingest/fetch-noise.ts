import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { NoiseFile } from "../../src/lib/types.js";

const STEP = "noise";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/processed/noise.json");

// Defra strategic noise mapping (Round 4, modelled 2022): road noise as Lden, the day-evening-night average level that
// weights evening and night noise more heavily. Served as a WMS, so each district's surroundings are drawn as a picture and
// the share of the picture in each noise band is counted from its pixel colours.
const WMS = "https://environment.data.gov.uk/spatialdata/road-noise-all-metrics-england-round-4/wms";
const LAYER = "Road_Noise_Lden_England_Round_4_All";
const RADIUS_M = 1609; // one mile around the district centre, matching how crime is counted
const SIZE_PX = 320;

// Colours the WMS style uses, quietest to loudest: <40, 40-45, 45-50, 50-55, 55-60, 60-65, 65-70, 70-75, 75-80, 80+ dB.
const BAND_COLOURS: [number, number, number][] = [
  [255, 255, 255],
  [184, 214, 209],
  [206, 228, 204],
  [226, 242, 191],
  [243, 198, 131],
  [232, 126, 77],
  [205, 70, 62],
  [161, 26, 77],
  [117, 8, 92],
  [67, 10, 74],
];

function nearestBand(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  BAND_COLOURS.forEach(([cr, cg, cb], i) => {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

async function bandShares(lat: number, lon: number): Promise<number[] | null> {
  const dLat = RADIUS_M / 111320;
  const dLon = RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
  // WMS 1.3.0 with EPSG:4326 orders the box as lat,lon.
  const url =
    `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${LAYER}&styles=&crs=EPSG:4326` +
    `&bbox=${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}&width=${SIZE_PX}&height=${SIZE_PX}&format=image/png&transparent=true`;
  const buffer = await withRetry(
    async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`GET WMS -> ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    { retries: 3, baseDelayMs: 2000 }
  );
  const png = PNG.sync.read(buffer);
  const counts = new Array(BAND_COLOURS.length).fill(0);
  let covered = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] === 0) continue; // outside the modelled area
    counts[nearestBand(png.data[i], png.data[i + 1], png.data[i + 2])]++;
    covered++;
  }
  if (covered < SIZE_PX * SIZE_PX * 0.5) return null; // mostly unmodelled: no honest figure
  return counts.map((c) => Math.round((c / covered) * 1000) / 10);
}

async function main() {
  const hierarchy = await loadHierarchy();
  const districts = new Map<string, { lat: number; lon: number }>();
  for (const b of hierarchy.cities.flatMap((c) => c.boroughs)) for (const o of b.outcodes) districts.set(o.outcode, { lat: o.latitude, lon: o.longitude });

  const outcodes: NoiseFile["outcodes"] = {};
  const entries = [...districts.entries()];
  let done = 0;
  // A few requests at a time: the WMS takes a second or two per picture.
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(
      entries.slice(i, i + 4).map(async ([code, { lat, lon }]) => {
        try {
          const bands = await bandShares(lat, lon);
          if (bands) outcodes[code] = { bands };
        } catch (err) {
          logStep(STEP, `${code}: ${(err as Error).message.slice(0, 80)}`);
        }
      })
    );
    done += 4;
    if (done % 40 === 0) logStep(STEP, `${Math.min(done, entries.length)}/${entries.length} districts.`);
    await sleep(200);
  }

  const data: NoiseFile = {
    source: "Defra strategic noise mapping, road noise (Lden), England Round 4",
    modelled: "2022",
    /** Band labels in order, quietest first. */
    bandLabels: ["Under 40 dB", "40-45 dB", "45-50 dB", "50-55 dB", "55-60 dB", "60-65 dB", "65-70 dB", "70-75 dB", "75-80 dB", "80+ dB"],
    outcodes,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote noise bands for ${Object.keys(outcodes).length} of ${entries.length} districts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
