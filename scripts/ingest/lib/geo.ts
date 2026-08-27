import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hierarchy, HierarchyOutcode } from "../../../src/lib/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../../data/processed");

/** Extracts the outcode ("TW9") from a full UK postcode ("TW9 3PZ" or "TW93PZ"). */
export function postcodeToOutcode(postcode: string): string | null {
  const normalised = postcode.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalised.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  return match ? match[1] : null;
}

export async function loadHierarchy(): Promise<Hierarchy> {
  const raw = await readFile(path.join(PROCESSED_DIR, "hierarchy.json"), "utf-8");
  return JSON.parse(raw) as Hierarchy;
}

export interface OutcodeEntry {
  city: string;
  citySlug: string;
  borough: string;
  boroughSlug: string;
  outcode: HierarchyOutcode;
}

/**
 * Flattens the hierarchy into a lookup of outcode -> single {city, borough, ...}.
 * A boundary outcode that legitimately touches multiple boroughs (e.g. N1
 * spans both Hackney and Islington) only gets ONE entry here - whichever
 * borough is processed last "wins". That's fine for borough-AGNOSTIC data
 * (health/schools/crime/property: the same real-world facts regardless of
 * which borough's page you reach them from), which is what this is for - it
 * also avoids duplicate API calls for outcodes shared between boroughs.
 *
 * It is NOT fine for borough-SPECIFIC data (councillors, planning portal,
 * curated places/history - genuinely different per council) or for anything
 * writing one output file per page: use loadOutcodeBoroughPairs() instead,
 * which preserves every (borough, outcode) combination that Astro will
 * actually build a page for.
 */
export async function loadOutcodeIndex(): Promise<Map<string, OutcodeEntry>> {
  const hierarchy = await loadHierarchy();
  const index = new Map<string, OutcodeEntry>();
  for (const city of hierarchy.cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        index.set(outcode.outcode, {
          city: city.name,
          citySlug: city.slug,
          borough: borough.name,
          boroughSlug: borough.slug,
          outcode,
        });
      }
    }
  }
  return index;
}

/** A stable composite key for a (borough, outcode) pair - use with loadOutcodeBoroughPairs(). */
export function boroughOutcodeKey(boroughSlug: string, outcode: string): string {
  return `${boroughSlug}::${outcode}`;
}

/**
 * Every (borough, outcode) pair in the hierarchy, undeduplicated - one entry
 * per page Astro will actually build. Use this for anything borough-specific.
 */
export async function loadOutcodeBoroughPairs(): Promise<OutcodeEntry[]> {
  const hierarchy = await loadHierarchy();
  const pairs: OutcodeEntry[] = [];
  for (const city of hierarchy.cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        pairs.push({ city: city.name, citySlug: city.slug, borough: borough.name, boroughSlug: borough.slug, outcode });
      }
    }
  }
  return pairs;
}
