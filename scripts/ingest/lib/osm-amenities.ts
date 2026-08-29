import { fetchJson, logStep, withRetry } from "./fetch-utils.js";
import { bulkReverseGeocode } from "./postcodes.js";
import { LONDON_BOROUGHS } from "./london-boroughs.js";
import type { PoliceStation } from "../../../src/lib/types.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
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

async function fetchOverpassAmenity(amenityValue: string): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:60];(node["amenity"="${amenityValue}"](${BBOX});way["amenity"="${amenityValue}"](${BBOX}););out center tags;`;
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

export type OsmStation = PoliceStation & { borough: string };

/**
 * Fetches every OSM `amenity=<amenityValue>` point/way in Greater London,
 * reverse-geocodes each to a borough via postcodes.io, and returns the ones
 * that land in one of this site's 33 London boroughs. Shared by the police
 * and fire station ingest scripts - identical shape and pipeline, only the
 * OSM amenity tag and generic fallback name differ.
 */
export async function fetchOsmStations(stepName: string, amenityValue: string, fallbackName: string): Promise<OsmStation[]> {
  const elements = await fetchOverpassAmenity(amenityValue);
  logStep(stepName, `Overpass returned ${elements.length} amenity=${amenityValue} elements in Greater London.`);

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
        name: name ?? fallbackName,
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
  logStep(stepName, `Reverse-geocoded ${geocoded.length} candidates.`);

  const stations: OsmStation[] = [];
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

  logStep(stepName, `${stations.length} ${amenityValue} stations matched to a London borough.`);
  return stations;
}
