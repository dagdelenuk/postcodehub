import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { JourneyTimesFile } from "../../src/lib/types.js";

const STEP = "journey-times";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/processed/journey-times.json");
const API = "https://api.tfl.gov.uk/Journey/JourneyResults";

// Fixed central London destinations, as coordinates on the station entrances.
const DESTINATIONS = [
  { id: "bank", name: "Bank", area: "the City", lat: 51.5133, lon: -0.0886 },
  { id: "canary-wharf", name: "Canary Wharf", area: "Docklands", lat: 51.5054, lon: -0.0235 },
  { id: "kings-cross", name: "King's Cross St Pancras", area: "King's Cross", lat: 51.5308, lon: -0.1238 },
  { id: "oxford-circus", name: "Oxford Circus", area: "the West End", lat: 51.5152, lon: -0.1419 },
  { id: "victoria", name: "Victoria", area: "Victoria", lat: 51.4965, lon: -0.1447 },
];

interface Journey {
  duration: number;
  legs: { mode: { name: string }; duration: number }[];
}

/** The next Tuesday after today, as YYYYMMDD - a typical weekday, so results don't depend on weekend engineering works. */
function nextTuesday(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
  return d;
}

async function main() {
  const day = nextTuesday();
  const date = day.toISOString().slice(0, 10);
  const compact = date.replaceAll("-", "");
  const hierarchy = await loadHierarchy();
  const outcodes = new Map<string, { lat: number; lon: number }>();
  for (const b of hierarchy.cities.flatMap((c) => c.boroughs)) for (const o of b.outcodes) outcodes.set(o.outcode, { lat: o.latitude, lon: o.longitude });

  const result: JourneyTimesFile["outcodes"] = {};
  let done = 0;
  for (const [outcode, { lat, lon }] of outcodes) {
    const times: JourneyTimesFile["outcodes"][string] = {};
    // The five destinations for one outcode run in parallel (each request takes ~2s); outcodes go one at a time to stay polite to TfL.
    await Promise.all(
      DESTINATIONS.map(async (dest) => {
        const url = `${API}/${lat},${lon}/to/${dest.lat},${dest.lon}?date=${compact}&time=0830&timeIs=Departing&journeyPreference=LeastTime`;
        try {
          const res = await withRetry(() => fetchJson<{ journeys?: Journey[] }>(url, { signal: AbortSignal.timeout(30000) }), { retries: 3, baseDelayMs: 1500 });
          const fastest = (res.journeys ?? []).sort((a, b) => a.duration - b.duration)[0];
          if (fastest) {
            const modes = fastest.legs.map((l) => l.mode.name).filter((m, i, all) => m !== "walking" && all.indexOf(m) === i);
            const rides = fastest.legs.filter((l) => l.mode.name !== "walking").length;
            times[dest.id] = { minutes: fastest.duration, modes, changes: Math.max(0, rides - 1) };
          }
        } catch (err) {
          logStep(STEP, `${outcode} -> ${dest.name}: ${(err as Error).message.slice(0, 80)}`);
        }
      })
    );
    await sleep(300);
    if (Object.keys(times).length > 0) result[outcode] = times;
    if (++done % 25 === 0) logStep(STEP, `${done}/${outcodes.size} outcodes done.`);
  }

  const data: JourneyTimesFile = {
    source: "Transport for London Journey Planner",
    departure: `Tuesday ${day.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}, 08:30`,
    destinations: DESTINATIONS.map(({ id, name, area }) => ({ id, name, area })),
    outcodes: result,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote journey times for ${Object.keys(result).length} outcodes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
