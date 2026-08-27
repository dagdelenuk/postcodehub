import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, loadOutcodeBoroughPairs } from "./lib/geo.js";
import type {
  EventsData,
  HealthData,
  HistoryData,
  OutcodeData,
  PlacesData,
  PlanningData,
  PropertyData,
  RepresentativesData,
  CrimeData,
  SchoolsData,
} from "../../src/lib/types.js";

const STEP = "build-outcode-data";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");

async function loadRaw<T>(filename: string): Promise<Record<string, T>> {
  const raw = await readFile(path.join(RAW_DIR, filename), "utf-8");
  return JSON.parse(raw) as Record<string, T>;
}

async function main() {
  // health/schools/crime/property are keyed by plain outcode (borough-agnostic
  // raw facts); representatives/planning/places/events/history are keyed by
  // the (borough, outcode) composite key (genuinely borough-specific). Every
  // (borough, outcode) PAIR gets its own merged file and page - a boundary
  // outcode shared between boroughs is not deduplicated away.
  const pairs = await loadOutcodeBoroughPairs();

  const [health, schools, crime, property, representatives, planning, places, events, history] = await Promise.all([
    loadRaw<HealthData>("health-by-outcode.json"),
    loadRaw<SchoolsData>("schools-by-outcode.json").then((raw) => {
      // schools raw is keyed by outcode -> School[], not { schools: [] }
      const wrapped: Record<string, SchoolsData> = {};
      for (const [outcode, list] of Object.entries(raw as unknown as Record<string, SchoolsData["schools"]>)) {
        wrapped[outcode] = { schools: list };
      }
      return wrapped;
    }),
    loadRaw<CrimeData>("crime-by-outcode.json"),
    loadRaw<PropertyData>("property-by-outcode.json"),
    loadRaw<RepresentativesData>("representatives-by-outcode.json"),
    loadRaw<PlanningData>("planning-by-outcode.json"),
    loadRaw<PlacesData>("places-by-outcode.json"),
    loadRaw<EventsData>("events-by-outcode.json"),
    loadRaw<HistoryData>("history-by-outcode.json"),
  ]);

  let written = 0;
  for (const entry of pairs) {
    const outcode = entry.outcode.outcode;
    const key = boroughOutcodeKey(entry.boroughSlug, outcode);
    const outcodeData: OutcodeData = {
      outcode,
      slug: entry.outcode.slug,
      city: entry.city,
      borough: entry.borough,
      latitude: entry.outcode.latitude,
      longitude: entry.outcode.longitude,
      wards: entry.outcode.wards,
      health: health[outcode] ?? { gpSurgeries: [], dentists: [], pharmacies: [] },
      schools: schools[outcode] ?? { schools: [] },
      safety: crime[outcode] ?? { monthlyTrend: [], categoryBreakdown: {}, totalLast12Months: 0 },
      property: property[outcode] ?? { sales: [], averagePrice: null, medianPrice: null },
      representatives: representatives[key] ?? { representatives: [] },
      planning: planning[key] ?? { applications: [], searchUrl: null },
      places: places[key] ?? { places: [] },
      events: events[key] ?? { events: [], listingUrl: null },
      history: history[key] ?? { summary: "", keyFacts: [] },
    };

    const dir = path.join(PROCESSED_DIR, entry.citySlug, entry.boroughSlug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${entry.outcode.slug}.json`), JSON.stringify(outcodeData, null, 2));
    written++;
  }

  logStep(STEP, `Wrote ${written} merged outcode data files.`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
