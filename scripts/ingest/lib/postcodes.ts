import { fetchJson } from "./fetch-utils.js";

const POSTCODES_IO_BASE = "https://api.postcodes.io";

export interface OutcodeResult {
  outcode: string;
  longitude: number;
  latitude: number;
  admin_district: string[];
  admin_ward: string[];
  parliamentary_constituency: string[];
}

interface OutcodesIoResponse {
  status: number;
  result: OutcodeResult[];
}

interface OutcodeIoResponse {
  status: number;
  result: OutcodeResult;
}

/** Looks up a single outcode's centroid and admin geography. */
export async function getOutcode(outcode: string): Promise<OutcodeResult> {
  const data = await fetchJson<OutcodeIoResponse>(
    `${POSTCODES_IO_BASE}/outcodes/${encodeURIComponent(outcode)}`
  );
  return data.result;
}

/**
 * Finds outcodes within `radiusMetres` of a lat/lng, used to discover the full
 * set of outcodes touching a borough without needing the full ONSPD bulk file.
 */
export async function findNearbyOutcodes(
  lat: number,
  lon: number,
  radiusMetres = 8000,
  limit = 100
): Promise<OutcodeResult[]> {
  const url = `${POSTCODES_IO_BASE}/outcodes?lon=${lon}&lat=${lat}&radius=${radiusMetres}&limit=${limit}`;
  const data = await fetchJson<OutcodesIoResponse>(url);
  return data.result ?? [];
}

/** Filters a list of outcodes down to those touching the given local authority name. */
export function filterByDistrict(outcodes: OutcodeResult[], districtName: string): OutcodeResult[] {
  return (outcodes ?? []).filter((o) => o.admin_district.includes(districtName));
}

interface BulkForwardGeocodeResponse {
  status: number;
  result: { query: string; result: { latitude: number; longitude: number } | null }[];
}

/**
 * Forward-geocodes up to 100 full UK postcodes at a time (postcodes.io's
 * bulk limit) to their latitude/longitude. Used to backfill coordinates for
 * data sources (NHS ODS health orgs, DfE GIAS schools) that only carry a
 * postcode string, not a lat/lon, so the merge step can plot them on a map
 * without needing a second live fetch of the underlying dataset.
 */
export async function bulkForwardGeocode(postcodes: string[]): Promise<Map<string, { latitude: number; longitude: number }>> {
  const result = new Map<string, { latitude: number; longitude: number }>();
  const BATCH = 100;
  for (let i = 0; i < postcodes.length; i += BATCH) {
    const batch = postcodes.slice(i, i + BATCH);
    const data = await fetchJson<BulkForwardGeocodeResponse>(`${POSTCODES_IO_BASE}/postcodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch }),
    });
    for (const entry of data.result) {
      if (entry.result) result.set(entry.query, { latitude: entry.result.latitude, longitude: entry.result.longitude });
    }
  }
  return result;
}

interface BulkReverseGeocodeResponse {
  status: number;
  result: { query: { longitude: number; latitude: number }; result: { postcode: string; admin_district: string }[] | null }[];
}

/**
 * Reverse-geocodes up to 100 points at a time (postcodes.io's bulk limit) to
 * their nearest postcode + local authority. Used to assign a borough/postcode
 * to points from a source (like OSM) that has no postcode of its own.
 */
export async function bulkReverseGeocode(
  points: { latitude: number; longitude: number }[]
): Promise<{ postcode: string | null; adminDistrict: string | null }[]> {
  const results: { postcode: string | null; adminDistrict: string | null }[] = [];
  const BATCH = 100;
  for (let i = 0; i < points.length; i += BATCH) {
    const batch = points.slice(i, i + BATCH);
    const data = await fetchJson<BulkReverseGeocodeResponse>(`${POSTCODES_IO_BASE}/postcodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geolocations: batch.map((p) => ({ longitude: p.longitude, latitude: p.latitude, radius: 2000, limit: 1 })),
      }),
    });
    for (const entry of data.result) {
      const nearest = entry.result?.[0];
      results.push({ postcode: nearest?.postcode ?? null, adminDistrict: nearest?.admin_district ?? null });
    }
  }
  return results;
}
