import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type {
  Banners,
  BannerImage,
  FireStation,
  GpSurgery,
  Hierarchy,
  HierarchyBorough,
  HierarchyCity,
  HierarchyOutcode,
  OutcodeData,
  Place,
  PoliceStation,
  School,
} from "./types";

const PROCESSED_DIR = path.resolve(process.cwd(), "data/processed");
const REFERENCE_DIR = path.resolve(process.cwd(), "data/reference");

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

export interface FavouriteEntry {
  label: string;
  sublabel: string;
  href: string;
  thumb?: string;
  /** Outcode code (e.g. "TW11") - only set for type "outcode", rendered as a text avatar in place of a thumb. */
  code?: string;
  /** Groups the "Your Favourites" roll-up: cities, then boroughs, then postcodes. */
  type: "city" | "borough" | "outcode";
  /** A-Z sort key within a type - the post town name for outcodes, not the outcode code itself. */
  sortKey: string;
}

/**
 * Every possible favourite (every city/borough/outcode) in one flat lookup,
 * keyed the same way FavoriteStar's favKey props are ("city:slug",
 * "borough:slug", "outcode:city/borough/slug") - favourites live in the
 * visitor's localStorage, unknown at build time, so any page that wants a
 * "Your Favourites" roll-up embeds this whole lookup and lets the shared
 * client-side script in FavoriteStar.astro pick out whichever keys are
 * actually favourited, without needing to fetch anything at runtime.
 */
export function getFavouritesLookup(): Record<string, FavouriteEntry> {
  const hierarchy = loadHierarchy();
  const lookup: Record<string, FavouriteEntry> = {};
  for (const city of hierarchy.cities) {
    lookup[`city:${city.slug}`] = {
      label: city.name,
      sublabel: `${city.boroughs.length} council ${city.boroughs.length === 1 ? "authority" : "authorities"} covered`,
      href: `/${city.slug}/`,
      thumb: getBannerImages(city.slug)[0]?.src,
      type: "city",
      sortKey: city.name,
    };
    for (const borough of city.boroughs) {
      lookup[`borough:${borough.slug}`] = {
        label: borough.name,
        sublabel: `${borough.outcodes.length} postcode districts`,
        href: `/${city.slug}/${borough.slug}/`,
        thumb: getBannerImages(borough.slug)[0]?.src,
        type: "borough",
        sortKey: borough.name,
      };
      for (const outcode of borough.outcodes) {
        const postTown = displayPlaceName(outcode.postTown, outcode.wards, city.name);
        lookup[`outcode:${city.slug}/${borough.slug}/${outcode.slug}`] = {
          label: postTown,
          sublabel: outcode.wards.join(", "),
          href: `/${city.slug}/${borough.slug}/${outcode.slug}/`,
          code: outcode.outcode,
          type: "outcode",
          sortKey: postTown,
        };
      }
    }
  }
  return lookup;
}

export interface CouncilTaxBands {
  boroughName: string;
  /** Band D figure the other bands are derived from - the "area" total, i.e. inclusive of the GLA precept for London boroughs. */
  bandD: number;
  bands: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G" | "H", number>;
}

let cachedCouncilTax: Record<string, CouncilTaxBands> | null = null;

// Sourced once from gov.uk's "Council Tax levels set by local authorities in
// England 2026 to 2027" (Band D area council tax, i.e. including the GLA
// precept) - see data/reference/council-tax-2026-27.json. Not a live API:
// councils set rates once a year each March, so this is refreshed by hand
// the same way, not fetched per request.
function loadCouncilTax(): Record<string, CouncilTaxBands> {
  if (cachedCouncilTax) return cachedCouncilTax;
  const filePath = path.join(REFERENCE_DIR, "council-tax-2026-27.json");
  cachedCouncilTax = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, CouncilTaxBands>) : {};
  return cachedCouncilTax;
}

export function getCouncilTax(boroughSlug: string): CouncilTaxBands | undefined {
  return loadCouncilTax()[boroughSlug];
}

let cachedCouncilTaxAverage: CouncilTaxBands["bands"] | null = null;

/** Mean Council Tax per band across every borough with data - for comparing one borough's own rates against the citywide picture. */
export function getCouncilTaxAverage(): CouncilTaxBands["bands"] {
  if (cachedCouncilTaxAverage) return cachedCouncilTaxAverage;
  const all = Object.values(loadCouncilTax());
  const bandKeys = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
  const result = {} as CouncilTaxBands["bands"];
  for (const band of bandKeys) {
    const values = all.map((c) => c.bands[band]);
    result[band] = values.length > 0 ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;
  }
  cachedCouncilTaxAverage = result;
  return result;
}

let cachedSchoolAdmissions: Record<string, string> | null = null;

// Each council's own school admissions page - verified live one at a time
// (not guessed from a URL pattern, since every council's site structure
// differs), so this is a static reference table refreshed by hand, same as
// council-tax-2026-27.json and post-towns.json.
function loadSchoolAdmissions(): Record<string, string> {
  if (cachedSchoolAdmissions) return cachedSchoolAdmissions;
  const filePath = path.join(REFERENCE_DIR, "school-admissions.json");
  cachedSchoolAdmissions = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string>) : {};
  return cachedSchoolAdmissions;
}

export function getSchoolAdmissionsUrl(boroughSlug: string): string | undefined {
  return loadSchoolAdmissions()[boroughSlug];
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

/**
 * outcode -> its page path, for the header postcode search box. A boundary
 * outcode has a real page under every borough it touches; prefer the
 * primary borough's page since that's the "main" copy, falling back to
 * whichever page exists if for some reason none is marked primary.
 */
export function getPostcodeSearchIndex(): Record<string, string> {
  const hierarchy = loadHierarchy();
  const index: Record<string, string> = {};
  for (const city of hierarchy.cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        const path = `/${city.slug}/${borough.slug}/${outcode.slug}/`;
        if (outcode.isPrimaryBorough || !index[outcode.outcode]) {
          index[outcode.outcode] = path;
        }
      }
    }
  }
  return index;
}

export interface QuickSearchEntry {
  type: "city" | "borough" | "outcode";
  label: string;
  sublabel: string;
  href: string;
  /** Lowercased, space-joined blob of everything this entry should match on. */
  keywords: string;
  /** Outcode entries only - wards have no page of their own, so they're kept only as extra keyword matches, not shown in the dropdown. */
  wards?: string[];
  /** Outcode entries only - kept separate from `sublabel` so the label line can show "{outcode} · {borough}". */
  borough?: string;
  /** Outcode entries only - Royal Mail post town (e.g. "Teddington" for TW11), shown as the dropdown sub-line instead of ward names. */
  postTown?: string;
}

/**
 * Flat, pre-lowercased index for the live quick-search dropdown: one entry
 * per city, per borough, and per unique outcode (deduped by primary borough,
 * same rule as getPostcodeSearchIndex - a boundary outcode is one real place,
 * not one result per borough it touches). An outcode's ward names are folded
 * into its own keywords rather than getting separate entries, since wards
 * have no page of their own to land on.
 */
export function getQuickSearchIndex(): QuickSearchEntry[] {
  const hierarchy = loadHierarchy();
  const entries: QuickSearchEntry[] = [];
  const outcodeEntries = new Map<string, { entry: QuickSearchEntry; isPrimary: boolean }>();

  for (const city of hierarchy.cities) {
    entries.push({
      type: "city",
      label: city.name,
      sublabel: `${city.boroughs.length} ${city.boroughs.length === 1 ? "borough" : "boroughs"}`,
      href: `/${city.slug}/`,
      keywords: city.name.toLowerCase(),
    });

    for (const borough of city.boroughs) {
      entries.push({
        type: "borough",
        label: borough.name,
        sublabel: city.name,
        href: `/${city.slug}/${borough.slug}/`,
        keywords: `${borough.name} ${city.name}`.toLowerCase(),
      });

      for (const outcode of borough.outcodes) {
        const existing = outcodeEntries.get(outcode.outcode);
        if (existing?.isPrimary && !outcode.isPrimaryBorough) continue;
        outcodeEntries.set(outcode.outcode, {
          isPrimary: outcode.isPrimaryBorough,
          entry: {
            type: "outcode",
            label: outcode.outcode,
            sublabel: `${borough.name}, ${city.name}`,
            href: `/${city.slug}/${borough.slug}/${outcode.slug}/`,
            keywords: `${outcode.outcode} ${borough.name} ${city.name} ${outcode.wards.join(" ")}`.toLowerCase(),
            wards: outcode.wards,
            borough: borough.name,
            postTown: displayPlaceName(outcode.postTown, outcode.wards, city.name),
          },
        });
      }
    }
  }

  for (const { entry } of outcodeEntries.values()) entries.push(entry);
  return entries;
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
  // Only sum outcodes this borough actually owns the majority of - a boundary
  // outcode this borough merely touches (isPrimaryBorough === false) is
  // already counted in full by whichever borough IS its primary, so summing
  // it here too would double-count and inflate this borough's totals.
  const entries = (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => ({ citySlug, boroughSlug, outcodeSlug: o.slug }));
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

export interface CityTrendData {
  /** "YYYY-MM", ascending. */
  months: string[];
  boroughs: { name: string; slug: string; series: number[] }[];
  /** Mean value-per-borough for each month - not the city total, so it sits on the same scale as each borough's own line. */
  average: number[];
}

/**
 * Shared aggregator for any per-borough monthly comparison chart: sums
 * `monthValues(data)` entries across every primary-borough outcode (same
 * rule as getBoroughSummary - a boundary outcode's figures are only counted
 * by whichever borough actually owns it), then adds a per-month average
 * across boroughs.
 */
function aggregateBoroughTrend(citySlug: string, monthValues: (data: OutcodeData) => [month: string, value: number][]): CityTrendData {
  const city = getCity(citySlug);
  const monthsSeen = new Set<string>();
  const perBorough: { name: string; slug: string; byMonth: Map<string, number> }[] = [];

  for (const borough of city?.boroughs ?? []) {
    const byMonth = new Map<string, number>();
    for (const outcode of borough.outcodes.filter((o) => o.isPrimaryBorough)) {
      const data = loadOutcodeData(citySlug, borough.slug, outcode.slug);
      for (const [month, value] of monthValues(data)) {
        monthsSeen.add(month);
        byMonth.set(month, (byMonth.get(month) ?? 0) + value);
      }
    }
    if (byMonth.size > 0) perBorough.push({ name: borough.name, slug: borough.slug, byMonth });
  }

  const months = [...monthsSeen].sort();
  const boroughs = perBorough
    .map((b) => ({ name: b.name, slug: b.slug, series: months.map((m) => b.byMonth.get(m) ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const average = months.map((_, i) => {
    const values = boroughs.map((b) => b.series[i]);
    return values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  });

  return { months, boroughs, average };
}

/**
 * Monthly crime trend per borough, for the comparative chart reached from a
 * borough's "Crimes (12mo)" stat card.
 */
export function getCityCrimeTrend(citySlug: string): CityTrendData {
  return aggregateBoroughTrend(citySlug, (data) => data.safety.monthlyTrend.map((m) => [m.month, m.totalCrimes]));
}

/**
 * Monthly sale COUNT per borough (not price - HM Land Registry data here
 * covers roughly the last two calendar years, not a fixed rolling window,
 * so every month we actually have data for is included), for the
 * comparative chart reached from a borough's "Property sales" stat card.
 */
export function getCityPropertyTrend(citySlug: string): CityTrendData {
  return aggregateBoroughTrend(citySlug, (data) => data.property.sales.map((s) => [s.dateOfTransfer.slice(0, 7), 1]));
}

export interface BoroughPostTownTrend {
  months: string[];
  postTowns: { name: string; series: number[] }[];
  average: number[];
}

/**
 * Monthly property sale count within one borough, grouped by Royal Mail post
 * town (multiple outcodes can share one - e.g. TW1+TW2 are both Twickenham).
 * Same primary-only filter as aggregateBoroughTrend/getBoroughSummary, since
 * this sums per-outcode counts into buckets (unlike getBoroughCrimeTrend,
 * which plots one line per outcode with nothing summed, so needs no filter).
 */
export function getBoroughPropertyTrendByPostTown(citySlug: string, boroughSlug: string): BoroughPostTownTrend {
  const borough = getBorough(citySlug, boroughSlug);
  const monthsSeen = new Set<string>();
  const byPostTown = new Map<string, Map<string, number>>();

  for (const outcode of (borough?.outcodes ?? []).filter((o) => o.isPrimaryBorough)) {
    const data = loadOutcodeData(citySlug, boroughSlug, outcode.slug);
    const byMonth = byPostTown.get(outcode.postTown) ?? new Map<string, number>();
    for (const sale of data.property.sales) {
      const month = sale.dateOfTransfer.slice(0, 7);
      monthsSeen.add(month);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    byPostTown.set(outcode.postTown, byMonth);
  }

  const months = [...monthsSeen].sort();
  const postTowns = [...byPostTown.entries()]
    .map(([name, byMonth]) => ({ name, series: months.map((m) => byMonth.get(m) ?? 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const average = months.map((_, i) => {
    const values = postTowns.map((p) => p.series[i]);
    return values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  });

  return { months, postTowns, average };
}

export interface BoroughCrimeTrend {
  /** "YYYY-MM", ascending. */
  months: string[];
  outcodes: { outcode: string; slug: string; total: number[]; violent: number[]; property: number[] }[];
  /** Mean value-per-outcode for each month, one series per crime dimension. */
  average: { total: number[]; violent: number[]; property: number[] };
}

/**
 * Monthly crime trend per postcode area within one borough (every outcode
 * shown on the borough's own page, not just primary-owned ones - unlike the
 * summary totals, this isn't being summed anywhere so there's no
 * double-counting risk from including a boundary outcode), split by Total /
 * Violent / Property. For the comparative chart on each outcode's Safety page.
 */
export function getBoroughCrimeTrend(citySlug: string, boroughSlug: string): BoroughCrimeTrend {
  const borough = getBorough(citySlug, boroughSlug);
  const monthsSeen = new Set<string>();
  const perOutcode: { outcode: string; slug: string; byMonth: Map<string, { total: number; violent: number; property: number }> }[] = [];

  for (const outcode of borough?.outcodes ?? []) {
    const data = loadOutcodeData(citySlug, boroughSlug, outcode.slug);
    const byMonth = new Map<string, { total: number; violent: number; property: number }>();
    for (const m of data.safety.monthlyTrend) {
      monthsSeen.add(m.month);
      byMonth.set(m.month, { total: m.totalCrimes, violent: m.violentCrimes, property: m.propertyCrimes });
    }
    if (byMonth.size > 0) perOutcode.push({ outcode: outcode.outcode, slug: outcode.slug, byMonth });
  }

  const months = [...monthsSeen].sort();
  const outcodes = perOutcode
    .map((o) => ({
      outcode: o.outcode,
      slug: o.slug,
      total: months.map((m) => o.byMonth.get(m)?.total ?? 0),
      violent: months.map((m) => o.byMonth.get(m)?.violent ?? 0),
      property: months.map((m) => o.byMonth.get(m)?.property ?? 0),
    }))
    .sort((a, b) => a.outcode.localeCompare(b.outcode));

  const avgOf = (key: "total" | "violent" | "property") =>
    months.map((_, i) => {
      const values = outcodes.map((o) => o[key][i]);
      return values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
    });

  return { months, outcodes, average: { total: avgOf("total"), violent: avgOf("violent"), property: avgOf("property") } };
}

export interface BoroughHealthGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  gpSurgeries: GpSurgery[];
  dentists: GpSurgery[];
  pharmacies: GpSurgery[];
  hospitals: GpSurgery[];
}

/**
 * GP surgeries/dentists/pharmacies/hospitals for every outcode this borough
 * is the primary owner of, grouped by outcode - same primary-only filter as
 * getBoroughSummary(), so a boundary outcode's practices aren't listed
 * under every borough it touches.
 */
export function getBoroughHealth(citySlug: string, boroughSlug: string): BoroughHealthGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return {
        outcode: o.outcode,
        outcodeSlug: o.slug,
        wards: o.wards,
        postTown: o.postTown,
        gpSurgeries: data.health.gpSurgeries,
        dentists: data.health.dentists,
        pharmacies: data.health.pharmacies,
        hospitals: data.health.hospitals,
      };
    })
    .filter((g) => g.gpSurgeries.length + g.dentists.length + g.pharmacies.length + g.hospitals.length > 0)
    .sort((a, b) => a.outcode.localeCompare(b.outcode));
}

export interface BoroughSchoolsGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  schools: School[];
}

/** Schools for every outcode this borough is the primary owner of, grouped by outcode. */
export function getBoroughSchools(citySlug: string, boroughSlug: string): BoroughSchoolsGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, schools: data.schools.schools };
    })
    .filter((g) => g.schools.length > 0)
    .sort((a, b) => a.outcode.localeCompare(b.outcode));
}

export interface BoroughPlacesGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  places: Place[];
}

/** Places (parks, libraries, pubs, etc.) for every outcode this borough is the primary owner of, grouped by outcode. */
export function getBoroughPlaces(citySlug: string, boroughSlug: string): BoroughPlacesGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, places: data.places.places };
    })
    .filter((g) => g.places.length > 0)
    .sort((a, b) => a.outcode.localeCompare(b.outcode));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The post town for the ~10 inner-London postcode areas (E, EC, N, NW, SE,
 * SW, W, WC) is officially just "London" (Royal Mail's historic 1857-1866
 * London postal district) - repeating that on every outcode card in a
 * borough like Hackney (100% inner-London postcodes) adds nothing, since
 * the city name is already shown elsewhere on the page. Falls back to the
 * most-populous ward name (wards are pre-sorted - see fetch-geography.ts)
 * so every card still gets a locally-recognisable place name either way.
 */
export function displayPlaceName(postTown: string, wards: string[], cityName: string): string {
  if (postTown && postTown !== cityName) return postTown;
  return wards[0] ?? postTown;
}

/**
 * The label a district should carry in a borough-scoped list: its Royal Mail
 * post town when the whole district is in this borough (unchanged from
 * displayPlaceName), or this borough's own leading ward names when the
 * district is split across boroughs - "KT1 - Kingston upon Thames" inside
 * Richmond upon Thames would be actively misleading, so a split district is
 * labelled by what's actually in this slice instead (e.g. "Hampton Wick &
 * South Teddington"). Does not modify displayPlaceName itself, which has
 * several existing callers that need unchanged non-split behaviour.
 */
export function districtLocalName(o: HierarchyOutcode, cityName: string, maxWards = 2): string {
  if (!o.isSplit || o.wards.length === 0) return displayPlaceName(o.postTown, o.wards, cityName);
  return o.wards.slice(0, maxWards).join(" & ");
}

/**
 * Splits a borough's districts into "full" (this borough is the whole
 * district) and "split" (shared with another borough), each sorted by the
 * same districtLocalName key already used for display - so `full` is
 * ordered identically to today's single sorted list, and `split` sorts the
 * same way among itself.
 */
export function partitionDistrictsForNav(
  outcodes: HierarchyOutcode[],
  cityName: string
): { full: HierarchyOutcode[]; split: HierarchyOutcode[] } {
  const byLocalName = (a: HierarchyOutcode, b: HierarchyOutcode) =>
    districtLocalName(a, cityName).localeCompare(districtLocalName(b, cityName));
  const full = outcodes.filter((o) => !o.isSplit).sort(byLocalName);
  const split = outcodes.filter((o) => o.isSplit).sort(byLocalName);
  return { full, split };
}

export interface SplitSibling {
  boroughName: string;
  boroughSlug: string;
  href: string;
  sharePercent: number;
  isPrimary: boolean;
  wards: string[];
  localName: string;
}

export interface SplitInfo {
  isSplit: boolean;
  outcode: string;
  boroughName: string;
  boroughSlug: string;
  isPrimary: boolean;
  sharePercent: number;
  wards: string[];
  localName: string;
  /** Every OTHER London slice of this district, share desc. Empty when !isSplit. */
  siblings: SplitSibling[];
  /** Every London borough this district appears in, share desc, including this one. */
  allBoroughNames: string[];
}

let cachedOutcodeIndex: Map<string, { citySlug: string; boroughSlug: string; boroughName: string; outcode: HierarchyOutcode }[]> | null = null;

function outcodeIndex(): Map<string, { citySlug: string; boroughSlug: string; boroughName: string; outcode: HierarchyOutcode }[]> {
  if (cachedOutcodeIndex) return cachedOutcodeIndex;
  const index = new Map<string, { citySlug: string; boroughSlug: string; boroughName: string; outcode: HierarchyOutcode }[]>();
  for (const city of loadHierarchy().cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        const key = `${city.slug}:${outcode.outcode}`;
        const list = index.get(key) ?? [];
        list.push({ citySlug: city.slug, boroughSlug: borough.slug, boroughName: borough.name, outcode });
        index.set(key, list);
      }
    }
  }
  cachedOutcodeIndex = index;
  return index;
}

/**
 * Everything a page needs to describe a district's split status and link to
 * its sibling slice(s) - built from the (already in-process-memoised)
 * hierarchy, so sibling wards/labels come straight from each sibling's own
 * entry rather than being duplicated into the JSON at ingest time.
 */
export function getSplitInfo(citySlug: string, boroughSlug: string, outcode: string): SplitInfo {
  const cityName = getCity(citySlug)?.name ?? "";
  const entries = outcodeIndex().get(`${citySlug}:${outcode}`) ?? [];
  const mine = entries.find((e) => e.boroughSlug === boroughSlug)!;
  const others = entries.filter((e) => e.boroughSlug !== boroughSlug).sort((a, b) => b.outcode.sharePercent - a.outcode.sharePercent);

  return {
    isSplit: mine.outcode.isSplit,
    outcode,
    boroughName: mine.boroughName,
    boroughSlug: mine.boroughSlug,
    isPrimary: mine.outcode.isPrimaryBorough,
    sharePercent: mine.outcode.sharePercent,
    wards: mine.outcode.wards,
    localName: districtLocalName(mine.outcode, cityName),
    siblings: others.map((e) => ({
      boroughName: e.boroughName,
      boroughSlug: e.boroughSlug,
      href: `/${e.citySlug}/${e.boroughSlug}/${e.outcode.slug}/`,
      sharePercent: e.outcode.sharePercent,
      isPrimary: e.outcode.isPrimaryBorough,
      wards: e.outcode.wards,
      localName: districtLocalName(e.outcode, cityName),
    })),
    allBoroughNames: [...entries]
      .sort((a, b) => b.outcode.sharePercent - a.outcode.sharePercent)
      .map((e) => e.boroughName),
  };
}

/** "KT1 (Richmond upon Thames)" - BaseLayout appends " · PostcodeHub". */
export function districtTitle(outcode: string, boroughName: string): string {
  return `${outcode} (${boroughName})`;
}

/** "Planning in KT1, Richmond upon Thames" */
export function topicTitle(topic: string, outcode: string, boroughName: string): string {
  return `${topic} in ${outcode}, ${boroughName}`;
}

const MAX_DESCRIPTION_LENGTH = 155;
function truncateDescription(s: string): string {
  return s.length <= MAX_DESCRIPTION_LENGTH ? s : `${s.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

export function districtDescription(outcode: string, boroughName: string, info: SplitInfo): string {
  const base = info.isSplit
    ? `The ${boroughName} part of ${outcode} — ${info.localName}. Health, schools, safety, transport and civic information.`
    : `Health, schools, safety, transport, and civic information for the ${outcode} postcode district in ${boroughName}.`;
  return truncateDescription(base);
}

export function topicDescription(topic: string, outcode: string, boroughName: string, info: SplitInfo): string {
  const base = info.isSplit
    ? `${topic} for the ${boroughName} part of ${outcode} — ${info.localName}.`
    : `${topic} for the ${outcode} postcode district in ${boroughName}.`;
  return truncateDescription(base);
}

/**
 * Every distinct station (police or fire) in a borough, nearest-to-furthest
 * from the borough's centroid. Every primary-borough outcode's `safety.*`
 * list already carries the FULL set of that kind of station in that outcode's
 * borough (built once per borough at ingest time, just distance-sorted per
 * outcode) - so any one primary outcode's list already IS the deduplicated
 * borough set, just needing its distances recomputed against the borough
 * centroid instead of that one outcode.
 */
function boroughStations(citySlug: string, boroughSlug: string, pick: (data: OutcodeData) => PoliceStation[]): PoliceStation[] {
  const borough = getBorough(citySlug, boroughSlug);
  const firstPrimary = (borough?.outcodes ?? []).find((o) => o.isPrimaryBorough);
  if (!firstPrimary) return [];

  const summary = getBoroughSummary(citySlug, boroughSlug);
  const data = loadOutcodeData(citySlug, boroughSlug, firstPrimary.slug);
  return pick(data)
    .map((s) => ({ ...s, distanceKm: Math.round(haversineKm(summary.latitude, summary.longitude, s.latitude, s.longitude) * 10) / 10 }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function getBoroughPoliceStations(citySlug: string, boroughSlug: string): PoliceStation[] {
  return boroughStations(citySlug, boroughSlug, (data) => data.safety.policeStations);
}

export function getBoroughFireStations(citySlug: string, boroughSlug: string): FireStation[] {
  return boroughStations(citySlug, boroughSlug, (data) => data.safety.fireStations);
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
