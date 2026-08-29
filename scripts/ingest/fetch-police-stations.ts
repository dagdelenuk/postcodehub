import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, withRetry } from "./lib/fetch-utils.js";
import { bulkReverseGeocode } from "./lib/postcodes.js";
import type { PoliceStation } from "../../src/lib/types.js";

const STEP = "police-stations";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Same 33 London boroughs fetch-geography.ts covers - kept as a local literal
// (rather than importing it) since that module runs its own live fetch as a
// side effect of being loaded.
const LONDON_BOROUGHS = new Set([
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden",
  "City of London", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney",
  "Hammersmith and Fulham", "Haringey", "Harrow", "Havering", "Hillingdon",
  "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge",
  "Richmond upon Thames", "Southwark", "Sutton", "Tower Hamlets",
  "Waltham Forest", "Wandsworth", "Westminster",
]);

// Bounding box comfortably covering Greater London.
const BBOX = "51.28,-0.51,51.70,0.33";

interface OverpassElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function fetchOverpassPoliceStations(): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:60];(node["amenity"="police"](${BBOX});way["amenity"="police"](${BBOX}););out center tags;`;
  const body = new URLSearchParams({ data: query });
  const data = await withRetry(() =>
    fetchJson<OverpassResponse>(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    })
  );
  return data.elements ?? [];
}

function buildAddress(tags: Record<string, string>): string {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"] ?? tags["addr:suburb"],
  ].filter(Boolean);
  return parts.join(", ");
}

async function main() {
  const elements = await fetchOverpassPoliceStations();
  logStep(STEP, `Overpass returned ${elements.length} amenity=police elements in Greater London.`);

  // Drop entries with no name and no address - nothing usable to display.
  const candidates = elements
    .map((el) => {
      const tags = el.tags ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      const name = tags.name || tags.branch || null;
      const address = buildAddress(tags);
      if (!name && !address) return null;
      return {
        name: name ?? "Police Station",
        address,
        postcode: tags["addr:postcode"] ?? null,
        telephone: tags.phone,
        latitude: lat,
        longitude: lon,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Reverse-geocode every candidate to get its borough (admin_district) and,
  // for the ones OSM didn't tag with one, a postcode.
  const geocoded = await bulkReverseGeocode(candidates);
  logStep(STEP, `Reverse-geocoded ${geocoded.length} candidates.`);

  const stations: (PoliceStation & { borough: string; latitude: number; longitude: number })[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const g = geocoded[i];
    const borough = g.adminDistrict;
    if (!borough || !LONDON_BOROUGHS.has(borough)) continue; // out of scope for this site
    stations.push({
      name: c.name,
      address: c.address,
      postcode: c.postcode ?? g.postcode ?? "",
      telephone: c.telephone,
      latitude: c.latitude,
      longitude: c.longitude,
      borough,
      distanceKm: 0, // filled in per-outcode at merge time
    });
  }

  logStep(STEP, `${stations.length} police stations matched to a London borough.`);

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "police-stations.json");
  await writeFile(outPath, JSON.stringify(stations, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
