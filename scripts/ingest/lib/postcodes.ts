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
