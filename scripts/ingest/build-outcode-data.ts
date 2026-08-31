import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, haversineKm, loadOutcodeBoroughPairs } from "./lib/geo.js";
import { bulkForwardGeocode } from "./lib/postcodes.js";
import type {
  EventsData,
  FireStation,
  HealthData,
  HistoryData,
  OutcodeData,
  Place,
  PlanningData,
  PoliceStation,
  PropertyData,
  RepresentativesData,
  CrimeData,
  SchoolsData,
  TransportData,
} from "../../src/lib/types.js";

const STEP = "build-outcode-data";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");

async function loadRaw<T>(filename: string): Promise<Record<string, T>> {
  const raw = await readFile(path.join(RAW_DIR, filename), "utf-8");
  return JSON.parse(raw) as Record<string, T>;
}

type RawStation = PoliceStation & { borough: string };
type RawPlace = Omit<Place, "distanceKm"> & { borough: string };

/** Groups a flat, borough-tagged list (stations or places) by borough name. */
async function loadByBorough<T extends { borough: string }>(filename: string): Promise<Map<string, T[]>> {
  const all = JSON.parse(await readFile(path.join(RAW_DIR, filename), "utf-8")) as T[];
  const byBorough = new Map<string, T[]>();
  for (const item of all) {
    const list = byBorough.get(item.borough) ?? [];
    list.push(item);
    byBorough.set(item.borough, list);
  }
  return byBorough;
}

/** Every station in `borough`, with distance recomputed from (lat, lon) and sorted nearest-first. */
function stationsNearestTo(byBorough: Map<string, RawStation[]>, borough: string, lat: number, lon: number): PoliceStation[] {
  return (byBorough.get(borough) ?? [])
    .map((s) => ({
      name: s.name,
      address: s.address,
      postcode: s.postcode,
      telephone: s.telephone,
      latitude: s.latitude,
      longitude: s.longitude,
      distanceKm: Math.round(haversineKm(lat, lon, s.latitude, s.longitude) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Every place in `borough` nearest to (lat, lon), capped at `perCategory`
 * per category (not globally - a global top-N in central London would
 * return N places of worship and nothing else) and sorted nearest-first
 * within each category.
 */
function nearestPlacesTo(byBorough: Map<string, RawPlace[]>, borough: string, lat: number, lon: number, perCategory: number): Place[] {
  const withDistance = (byBorough.get(borough) ?? [])
    .map((p) => ({
      name: p.name,
      category: p.category,
      address: p.address,
      postcode: p.postcode,
      latitude: p.latitude,
      longitude: p.longitude,
      website: p.website,
      distanceKm: Math.round(haversineKm(lat, lon, p.latitude, p.longitude) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const byCategory = new Map<string, Place[]>();
  for (const place of withDistance) {
    const list = byCategory.get(place.category) ?? [];
    if (list.length < perCategory) list.push(place);
    byCategory.set(place.category, list);
  }
  return [...byCategory.values()].flat();
}

// Places nearer than this per-outcode cap are dropped once a category has
// enough entries - keeps a dense central-London outcode from showing 30+
// cards of the same category. Tune here if that still feels overwhelming.
const PLACES_PER_CATEGORY = 6;

async function main() {
  // health/schools/crime/property are keyed by plain outcode (borough-agnostic
  // raw facts); representatives/planning/events/history are keyed by the
  // (borough, outcode) composite key (genuinely borough-specific). Every
  // (borough, outcode) PAIR gets its own merged file and page - a boundary
  // outcode shared between boroughs is not deduplicated away.
  const pairs = await loadOutcodeBoroughPairs();

  // Police/fire stations and places are flat, borough-tagged lists (not keyed
  // by outcode - an outcode's nearest station/place is often outside it),
  // grouped here so each outcode can be matched against everything in its
  // own borough.
  const policeByBorough = await loadByBorough<RawStation>("police-stations.json");
  const fireByBorough = await loadByBorough<RawStation>("fire-stations.json");
  const placesByBorough = await loadByBorough<RawPlace>("places.json");

  const [health, schools, crime, transport, property, representatives, planning, events, history] = await Promise.all([
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
    loadRaw<TransportData>("transport-by-outcode.json"),
    loadRaw<PropertyData>("property-by-outcode.json"),
    loadRaw<RepresentativesData>("representatives-by-outcode.json"),
    loadRaw<PlanningData>("planning-by-outcode.json"),
    loadRaw<EventsData>("events-by-outcode.json"),
    loadRaw<HistoryData>("history-by-outcode.json"),
  ]);

  // GP surgeries and schools only carry a postcode from their source APIs
  // (NHS ODS / DfE GIAS) - geocode those postcodes here, once, in bulk,
  // rather than re-running the slow live fetches just to add coordinates
  // for the card/map toggle's map view.
  const healthPostcodes = new Set<string>();
  for (const h of Object.values(health)) {
    for (const org of [...h.gpSurgeries, ...h.dentists, ...h.pharmacies, ...h.hospitals]) {
      if (org.postcode) healthPostcodes.add(org.postcode);
    }
  }
  const schoolPostcodes = new Set<string>();
  for (const s of Object.values(schools)) {
    for (const school of s.schools) {
      if (school.postcode) schoolPostcodes.add(school.postcode);
    }
  }
  const geocoded = await bulkForwardGeocode([...healthPostcodes, ...schoolPostcodes]);
  logStep(STEP, `Geocoded ${geocoded.size} of ${healthPostcodes.size + schoolPostcodes.size} unique health/school postcodes.`);

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
  for (const s of Object.values(schools)) {
    s.schools = s.schools.map(withCoords);
  }

  let written = 0;
  for (const entry of pairs) {
    const outcode = entry.outcode.outcode;
    const key = boroughOutcodeKey(entry.boroughSlug, outcode);

    const policeStations = stationsNearestTo(policeByBorough, entry.borough, entry.outcode.latitude, entry.outcode.longitude);
    const fireStations: FireStation[] = stationsNearestTo(fireByBorough, entry.borough, entry.outcode.latitude, entry.outcode.longitude);

    const safety: CrimeData = {
      ...(crime[outcode] ?? { monthlyTrend: [], categoryBreakdown: {}, totalLast12Months: 0 }),
      policeStations,
      fireStations,
    };

    const outcodeData: OutcodeData = {
      outcode,
      slug: entry.outcode.slug,
      city: entry.city,
      borough: entry.borough,
      latitude: entry.outcode.latitude,
      longitude: entry.outcode.longitude,
      wards: entry.outcode.wards,
      postTown: entry.outcode.postTown,
      health: health[outcode] ?? { gpSurgeries: [], dentists: [], pharmacies: [], hospitals: [] },
      schools: schools[outcode] ?? { schools: [] },
      safety,
      transport: transport[outcode] ?? { lines: [], nearbyStations: [] },
      property: property[outcode] ?? { sales: [], averagePrice: null, medianPrice: null },
      representatives: representatives[key] ?? { representatives: [] },
      planning: planning[key] ?? { applications: [], searchUrl: null },
      places: { places: nearestPlacesTo(placesByBorough, entry.borough, entry.outcode.latitude, entry.outcode.longitude, PLACES_PER_CATEGORY) },
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
