import { fetchJson, sleep } from "./fetch-utils.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

interface NominatimResult {
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
  class: string;
  type: string;
}

export interface BoroughGeo {
  latitude: number;
  longitude: number;
  /** Metres from centroid to the bounding box corner, used as a postcodes.io search radius. */
  radiusMetres: number;
}

function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Geocodes a London borough's name via OpenStreetMap Nominatim rather than
 * hardcoding centroids from memory. Returns a centroid + a search radius sized
 * to the borough's actual bounding box (half-diagonal + 15% margin), so large
 * outer-London boroughs get a wider net than small central ones.
 */
const HEADERS = { "User-Agent": "postcodehub-uk-poc/1.0 (community data pipeline)" };
// A minimum search radius floor: guards against a bad/overly-specific Nominatim
// match (e.g. a single building) producing a near-zero radius that silently
// finds no outcodes at all.
const MIN_RADIUS_METRES = 2000;

async function nominatimSearch(query: string): Promise<NominatimResult | null> {
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const results = await fetchJson<NominatimResult[]>(url, { headers: HEADERS });
  return results[0] ?? null;
}

/**
 * Three London boroughs are legally "Royal Borough of X" (Kensington and
 * Chelsea, Kingston upon Thames, Greenwich), not "London Borough of X" - and
 * Nominatim's fuzzy free-text search will happily match an unrelated small
 * business/office/building for the "wrong" phrasing instead of erroring, which
 * silently produces a near-zero search radius. So rather than special-case
 * borough names, every candidate query is validated to be an actual
 * administrative boundary (class=boundary, type=administrative) before it's
 * accepted; if none of the phrasings resolve to a real boundary, we fail loudly.
 */
async function findBoroughBoundary(name: string): Promise<NominatimResult> {
  const candidateQueries = [
    `London Borough of ${name}, UK`,
    `Royal Borough of ${name}, UK`,
    `City of ${name}, UK`,
    `${name}, Greater London, UK`,
    `${name}, UK`,
  ];
  for (const query of candidateQueries) {
    const result = await nominatimSearch(query);
    await sleep(1100); // Nominatim's usage policy caps public requests at 1/second
    if (result && result.class === "boundary" && result.type === "administrative") {
      return result;
    }
  }
  throw new Error(`Nominatim never resolved an administrative boundary for borough "${name}" (tried: ${candidateQueries.join(" | ")})`);
}

export async function geocodeBorough(name: string): Promise<BoroughGeo> {
  const result = await findBoroughBoundary(name);

  const lat = Number(result.lat);
  const lon = Number(result.lon);
  const [south, north, west, east] = result.boundingbox.map(Number);
  const halfDiagonal = haversineMetres(south, west, north, east) / 2;

  return { latitude: lat, longitude: lon, radiusMetres: Math.max(Math.round(halfDiagonal * 1.15), MIN_RADIUS_METRES) };
}

export async function geocodeBoroughsSequentially(names: string[]): Promise<Map<string, BoroughGeo>> {
  const result = new Map<string, BoroughGeo>();
  for (const name of names) {
    result.set(name, await geocodeBorough(name));
  }
  return result;
}
