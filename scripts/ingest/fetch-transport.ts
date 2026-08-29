import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { haversineKm, loadOutcodeIndex } from "./lib/geo.js";
import type { NearbyStation, TransportData } from "../../src/lib/types.js";

const STEP = "transport";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const TFL_BASE = "https://api.tfl.gov.uk";

// A station near an outcode is only "real" transport access if it's within a
// short walk - roughly 18-20 minutes. This is a new cutoff for this feature,
// not shared with findNearbyOutcodes' much larger 8km default (which finds
// outcodes touching a borough, not stations serving a resident).
const RADIUS_METRES = 1500;
const NEARBY_STATION_LIMIT = 5;

interface TflLineSummary {
  id: string;
  name: string;
}

interface StopPointLine {
  id: string;
  name: string;
}

interface StopPoint {
  commonName: string;
  lat: number;
  lon: number;
  modes: string[];
  lines: StopPointLine[];
}

interface StopPointSearchResponse {
  stopPoints: StopPoint[];
}

async function fetchTubeFamilyLineIds(): Promise<Set<string>> {
  const lines = await withRetry(() =>
    fetchJson<TflLineSummary[]>(`${TFL_BASE}/Line/Mode/tube,dlr,overground,elizabeth-line,tram`)
  );
  return new Set(lines.map((l) => l.id));
}

async function fetchNearbyStopPoints(lat: number, lon: number): Promise<StopPoint[]> {
  const url = `${TFL_BASE}/StopPoint?lat=${lat}&lon=${lon}&radius=${RADIUS_METRES}&stopTypes=NaptanMetroStation,NaptanRailStation`;
  // TfL's unauthenticated rate limit is tight enough to 429 well before the
  // default withRetry backoff catches up, so this call gets a slower, longer one.
  const data = await withRetry(() => fetchJson<StopPointSearchResponse>(url), { retries: 6, baseDelayMs: 2000 });
  return data.stopPoints ?? [];
}

async function main() {
  const tubeFamilyLineIds = await fetchTubeFamilyLineIds();
  logStep(STEP, `${tubeFamilyLineIds.size} canonical tube/DLR/overground/Elizabeth-line/tram lines fetched.`);

  const outcodeIndex = await loadOutcodeIndex();
  const byOutcode: Record<string, TransportData> = {};

  const outcodes = [...outcodeIndex.entries()];
  const CONCURRENCY = 2;
  let i = 0;
  for (let start = 0; start < outcodes.length; start += CONCURRENCY) {
    const batch = outcodes.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(async ([outcode, entry]) => {
        const stops = await fetchNearbyStopPoints(entry.outcode.latitude, entry.outcode.longitude);

        // Filter by line id against the canonical allow-list, not by station
        // modes - an interchange stop can list National Rail train-operator
        // "lines" (e.g. "South Western Railway") alongside real Underground
        // lines, and modes alone can't tell those apart.
        const lineIds = new Set<string>();
        for (const stop of stops) {
          for (const line of stop.lines ?? []) {
            if (tubeFamilyLineIds.has(line.id)) lineIds.add(line.id);
          }
        }

        const nearbyStations: NearbyStation[] = stops
          .map((s) => ({
            name: s.commonName,
            modes: s.modes,
            distanceKm: Math.round(haversineKm(entry.outcode.latitude, entry.outcode.longitude, s.lat, s.lon) * 10) / 10,
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, NEARBY_STATION_LIMIT);

        byOutcode[outcode] = { lines: [...lineIds], nearbyStations };
      })
    );
    i += batch.length;
    if (i % 20 === 0 || i === outcodes.length) logStep(STEP, `Processed ${i}/${outcodes.length} outcodes...`);
    await sleep(1000);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "transport-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byOutcode, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
