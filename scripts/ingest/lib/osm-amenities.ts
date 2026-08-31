import { fetchJson, logStep, withRetry } from "./fetch-utils.js";
import { bulkReverseGeocode } from "./postcodes.js";
import { LONDON_BOROUGHS } from "./london-boroughs.js";
import type { PoliceStation } from "../../../src/lib/types.js";

// Overridable for local testing when the default host isn't reachable from a
// given network - defaults to the flagship public instance.
const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
// Bounding box comfortably covering Greater London.
const BBOX = "51.28,-0.51,51.70,0.33";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function runOverpassQuery(query: string, timeoutMs: number): Promise<OverpassElement[]> {
  const body = new URLSearchParams({ data: query });
  const data = await withRetry(
    () =>
      fetchJson<OverpassResponse>(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "postcodehub.uk ingest (https://postcodehub.uk)",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    { retries: 4, baseDelayMs: 5000 }
  );
  return data.elements ?? [];
}

async function fetchOverpassAmenity(amenityValue: string): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:60];(node["amenity"="${amenityValue}"](${BBOX});way["amenity"="${amenityValue}"](${BBOX}););out center tags;`;
  return runOverpassQuery(query, 60_000);
}

function buildAddress(tags: Record<string, string>): string {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"] ?? tags["addr:suburb"],
  ].filter(Boolean);
  return parts.join(", ");
}

interface Candidate {
  name: string | null;
  address: string;
  postcode: string | null;
  telephone?: string;
  website?: string;
  latitude: number;
  longitude: number;
  category: string;
}

/** Matches an element's tags against `filters` in order - first match wins, so callers control precedence via list order. */
function resolveCategory(tags: Record<string, string>, filters: OsmTagFilter[]): string | null {
  for (const filter of filters) {
    if (tags[filter.key] === filter.value) return filter.category;
  }
  return null;
}

function elementsToCandidates(elements: OverpassElement[], filters: OsmTagFilter[], requireName: boolean): Candidate[] {
  return elements
    .map((el) => {
      const tags = el.tags ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      const category = resolveCategory(tags, filters);
      if (!category) return null;
      const name = tags.name || tags.branch || null;
      const address = buildAddress(tags);
      if (!name && (requireName || !address)) return null;
      return {
        name,
        address,
        postcode: tags["addr:postcode"] ?? null,
        telephone: tags.phone,
        website: tags.website ?? tags["contact:website"],
        latitude: lat,
        longitude: lon,
        category,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}

/** ~150m is small enough to catch the same real-world feature mapped twice (e.g. a park as both a way and a member relation), not distinct nearby features. */
const DEDUPE_RADIUS_KM = 0.15;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Lowercases, strips a leading "the", and drops punctuation, so "The Sussex Arms" and "Sussex Arms" compare equal. */
function normalizeName(name: string | null): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddress(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, " ");
}

/** "Very close" names - identical after normalising, or one is a prefix/suffix of the other (e.g. a branch suffix like "Sussex Arms (Twickenham)"). */
function namesAreClose(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Drops candidates that are almost certainly the same real-world place as
 * one already kept:
 *  - same address and a very close name (e.g. "Sussex Arms" vs "The Sussex
 *    Arms" at the same street address), regardless of distance apart, or
 *  - same normalised name and within DEDUPE_RADIUS_KM (OSM often maps the
 *    same feature as more than one element - a park as both a way and a
 *    member relation).
 */
function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const candidate of candidates) {
    const name = normalizeName(candidate.name);
    const address = normalizeAddress(candidate.address);
    const isDuplicate = kept.some((k) => {
      const kName = normalizeName(k.name);
      const kAddress = normalizeAddress(k.address);
      if (address && kAddress && address === kAddress && namesAreClose(name, kName)) return true;
      if (name && name === kName && haversineKm(k.latitude, k.longitude, candidate.latitude, candidate.longitude) < DEDUPE_RADIUS_KM) return true;
      return false;
    });
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

type GeocodedCandidate = Omit<Candidate, "postcode"> & { postcode: string; borough: string };

async function geocodeToLondonBoroughs(stepName: string, candidates: Candidate[]): Promise<GeocodedCandidate[]> {
  const geocoded = await bulkReverseGeocode(candidates);
  logStep(stepName, `Reverse-geocoded ${geocoded.length} candidates.`);

  const results: GeocodedCandidate[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const g = geocoded[i];
    const borough = g.adminDistrict;
    if (!borough || !LONDON_BOROUGHS.has(borough)) continue; // out of scope for this site
    results.push({ ...c, borough, postcode: c.postcode ?? g.postcode ?? "" });
  }
  return results;
}

export type OsmStation = PoliceStation & { borough: string };

/**
 * Fetches every OSM `amenity=<amenityValue>` point/way in Greater London,
 * reverse-geocodes each to a borough via postcodes.io, and returns the ones
 * that land in one of this site's 33 London boroughs. Shared by the police
 * and fire station ingest scripts - identical shape and pipeline, only the
 * OSM amenity tag and generic fallback name differ. Thin wrapper over
 * fetchOsmFeatures with a single filter and the police/fire fallback-name
 * behaviour (keep nameless-but-addressed entries) preserved.
 */
export async function fetchOsmStations(stepName: string, amenityValue: string, fallbackName: string): Promise<OsmStation[]> {
  const elements = await fetchOverpassAmenity(amenityValue);
  logStep(stepName, `Overpass returned ${elements.length} amenity=${amenityValue} elements in Greater London.`);

  const filters: OsmTagFilter[] = [{ key: "amenity", value: amenityValue, category: "station" }];
  const candidates = elementsToCandidates(elements, filters, false);
  const geocoded = await geocodeToLondonBoroughs(stepName, candidates);

  const stations: OsmStation[] = geocoded.map((c) => ({
    name: c.name ?? fallbackName,
    address: c.address,
    postcode: c.postcode,
    telephone: c.telephone,
    latitude: c.latitude,
    longitude: c.longitude,
    borough: c.borough,
    distanceKm: 0, // filled in per-outcode at merge time
  }));

  logStep(stepName, `${stations.length} ${amenityValue} stations matched to a London borough.`);
  return stations;
}

export interface OsmTagFilter {
  /** OSM tag key, e.g. "amenity" or "leisure". */
  key: string;
  value: string;
  /** The site-facing category this tag resolves to. */
  category: string;
}

export interface OsmFeature {
  name: string;
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  telephone?: string;
  website?: string;
  category: string;
}

/**
 * Generalised version of fetchOsmStations: queries multiple OSM tag/value
 * pairs (across any key, not just "amenity") in a single Overpass union
 * query, resolves each matched element to a category by filter order (first
 * match wins), dedupes near-identical elements (OSM often maps one real
 * feature as more than one element), reverse-geocodes to a London borough,
 * and drops anything outside this site's 33 boroughs.
 *
 * Includes relations (not just node/way) - large features like Richmond
 * Park or Hyde Park are commonly mapped as multipolygon relations and would
 * otherwise be silently missed.
 */
export async function fetchOsmFeatures(
  stepName: string,
  filters: OsmTagFilter[],
  opts: { requireName?: boolean; timeoutMs?: number; limit?: number } = {}
): Promise<(OsmFeature & { borough: string })[]> {
  const clauses = filters.map((f) => `nwr["${f.key}"="${f.value}"](${BBOX});`).join("\n  ");
  const query = `[out:json][timeout:180];\n(\n  ${clauses}\n);\nout center tags;`;
  const elements = await runOverpassQuery(query, opts.timeoutMs ?? 180_000);
  logStep(stepName, `Overpass returned ${elements.length} elements across ${filters.length} tag filters.`);

  const candidates = elementsToCandidates(elements, filters, opts.requireName ?? true);
  logStep(stepName, `${candidates.length} candidates have a usable name/address.`);

  const deduped = dedupeCandidates(candidates);
  logStep(stepName, `${deduped.length} candidates remain after de-duplication.`);

  // Truncate before the (comparatively slow, sequential) reverse-geocode
  // pass - lets a dry run test the Overpass query without a full postcodes.io
  // run against thousands of candidates.
  const toGeocode = opts.limit ? deduped.slice(0, opts.limit) : deduped;
  if (opts.limit) logStep(stepName, `Truncated to ${toGeocode.length} candidates before geocoding (PLACES_LIMIT).`);

  const geocoded = await geocodeToLondonBoroughs(stepName, toGeocode);
  const features = geocoded.map((c) => ({
    name: c.name ?? "",
    address: c.address,
    postcode: c.postcode,
    latitude: c.latitude,
    longitude: c.longitude,
    telephone: c.telephone,
    website: c.website,
    category: c.category,
    borough: c.borough,
  }));

  logStep(stepName, `${features.length} features matched to a London borough.`);
  return features;
}
