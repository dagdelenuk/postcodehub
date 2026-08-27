import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Banners, BannerImage, Hierarchy, HierarchyBorough, HierarchyCity, OutcodeData } from "./types";

const PROCESSED_DIR = path.resolve(process.cwd(), "data/processed");

let cachedHierarchy: Hierarchy | null = null;

export function loadHierarchy(): Hierarchy {
  if (cachedHierarchy) return cachedHierarchy;
  const raw = readFileSync(path.join(PROCESSED_DIR, "hierarchy.json"), "utf-8");
  cachedHierarchy = JSON.parse(raw) as Hierarchy;
  return cachedHierarchy;
}

let cachedBanners: Banners | null = null;

export function loadBanners(): Banners {
  if (cachedBanners) return cachedBanners;
  const bannersPath = path.join(PROCESSED_DIR, "banners.json");
  cachedBanners = existsSync(bannersPath) ? (JSON.parse(readFileSync(bannersPath, "utf-8")) as Banners) : {};
  return cachedBanners;
}

/** Never throws - a location with no verified free-licensed photos just gets no banner. */
export function getBannerImages(slug: string): BannerImage[] {
  return loadBanners()[slug] ?? [];
}

// A short, genuinely-about-the-city fact, used on the city page instead of
// rolling up one borough's history text (which reads oddly generalised to
// the whole city - "Formed in 1965 from the former boroughs of Barking and
// Dagenham" is a fact about that borough, not about London).
const CITY_FACTS: Record<string, string> = {
  london: "Greater London comprises 32 boroughs plus the City of London, each with its own local council, spanning both banks of the Thames and covering roughly 1,570 square kilometres.",
};

export function getCityFact(citySlug: string): string | undefined {
  return CITY_FACTS[citySlug];
}

export function getCity(citySlug: string): HierarchyCity | undefined {
  return loadHierarchy().cities.find((c) => c.slug === citySlug);
}

export function getBorough(citySlug: string, boroughSlug: string): HierarchyBorough | undefined {
  return getCity(citySlug)?.boroughs.find((b) => b.slug === boroughSlug);
}

export function loadOutcodeData(citySlug: string, boroughSlug: string, outcodeSlug: string): OutcodeData {
  const raw = readFileSync(path.join(PROCESSED_DIR, citySlug, boroughSlug, `${outcodeSlug}.json`), "utf-8");
  return JSON.parse(raw) as OutcodeData;
}

export interface OutcodeParams {
  city: string;
  borough: string;
  outcode: string;
}

/** Flattens the hierarchy into every {city, borough, outcode} slug triple, for getStaticPaths(). */
export function getAllOutcodeParams(): OutcodeParams[] {
  const hierarchy = loadHierarchy();
  const params: OutcodeParams[] = [];
  for (const city of hierarchy.cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        params.push({ city: city.slug, borough: borough.slug, outcode: outcode.slug });
      }
    }
  }
  return params;
}

export interface AreaSummary {
  gpSurgeries: number;
  schools: number;
  crimes12mo: number;
  propertySales: number;
  latitude: number;
  longitude: number;
  historySummary: string;
}

function summariseOutcodes(entries: { citySlug: string; boroughSlug: string; outcodeSlug: string }[]): AreaSummary {
  let gpSurgeries = 0;
  let schools = 0;
  let crimes12mo = 0;
  let propertySales = 0;
  let latSum = 0;
  let lonSum = 0;
  let historySummary = "";

  for (const entry of entries) {
    const data = loadOutcodeData(entry.citySlug, entry.boroughSlug, entry.outcodeSlug);
    gpSurgeries += data.health.gpSurgeries.length;
    schools += data.schools.schools.length;
    crimes12mo += data.safety.totalLast12Months;
    propertySales += data.property.sales.length;
    latSum += data.latitude;
    lonSum += data.longitude;
    // keyFacts[0] is always the borough-neutral paragraph (see
    // seed-places-events-history.ts); history.summary itself is often phrased
    // around one specific outcode ("TW9 covers Kew...", "KT1 lies within..."),
    // which reads oddly rolled up to a whole borough or city.
    if (!historySummary) historySummary = data.history.keyFacts[0] || data.history.summary;
  }

  const count = entries.length || 1;
  return {
    gpSurgeries,
    schools,
    crimes12mo,
    propertySales,
    latitude: latSum / count,
    longitude: lonSum / count,
    historySummary,
  };
}

/** Aggregates every outcode in a borough - each outcode belongs to exactly one borough's own file set, no double-counting. */
export function getBoroughSummary(citySlug: string, boroughSlug: string): AreaSummary {
  const borough = getBorough(citySlug, boroughSlug);
  const entries = (borough?.outcodes ?? []).map((o) => ({ citySlug, boroughSlug, outcodeSlug: o.slug }));
  return summariseOutcodes(entries);
}

/**
 * Aggregates every outcode across all of a city's boroughs. A boundary outcode
 * (e.g. N1, shared by Hackney and Islington) has its own file under each
 * borough it touches with identical underlying facts - dedupe by outcode code
 * so it's only counted once at city level, not once per borough it borders.
 */
export function getCitySummary(citySlug: string): AreaSummary {
  const city = getCity(citySlug);
  const seen = new Set<string>();
  const entries: { citySlug: string; boroughSlug: string; outcodeSlug: string }[] = [];
  for (const borough of city?.boroughs ?? []) {
    for (const outcode of borough.outcodes) {
      if (seen.has(outcode.outcode)) continue;
      seen.add(outcode.outcode);
      entries.push({ citySlug, boroughSlug: borough.slug, outcodeSlug: outcode.slug });
    }
  }
  return summariseOutcodes(entries);
}

/**
 * Astro's thin-content guardrail: don't build a category sub-page when the
 * outcode has no real records for it, rather than shipping an empty page.
 */
export function hasContent(data: OutcodeData, category: keyof OutcodeData): boolean {
  const value = data[category];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.values(value).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  }
  return Boolean(value);
}
