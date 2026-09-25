import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  Banners,
  BannerImage,
  ChildcareProvider,
  FireStation,
  AreaRents,
  BroadbandFile,
  CouncilServicesData,
  EvChargingFile,
  EvBoroughStats,
  GreenspaceFile,
  GreenspaceMetrics,
  NoiseFile,
  CouncilServicesFile,
  BroadbandMetrics,
  DemographicsFile,
  DemographicsWithDeprivation,
  MobileCoverageFile,
  MobileCoverageMetrics,
  FoodEstablishment,
  FoodHygieneFile,
  GpSurgery,
  HpiData,
  JourneyTimesFile,
  HpiSeries,
  Hierarchy,
  HierarchyBorough,
  HierarchyCity,
  HierarchyOutcode,
  LocalElectionData,
  OutcodeData,
  Place,
  PoliceStation,
  RentsFile,
  Representative,
  School,
  WardElectionResult,
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

let cachedPlaceImages: Banners | null = null;

// data/processed/place-images/ holds one small JSON file per slug ({slug, images}), not one combined file - that's what
// lets Decap CMS's folder collection type show a real, searchable per-entry list in /admin (see public/admin/config.yml's
// "place_photos" collection), so a bad automatic pick can be fixed by looking at the actual photo, not blind by ID.
function loadPlaceImages(): Banners {
  if (cachedPlaceImages) return cachedPlaceImages;
  const dir = path.join(PROCESSED_DIR, "place-images");
  const record: Banners = {};
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const entry = JSON.parse(readFileSync(path.join(dir, file), "utf-8")) as { slug?: string; images?: BannerImage[] };
      if (entry.slug && entry.images && entry.images.length > 0) record[entry.slug] = entry.images;
    }
  }
  cachedPlaceImages = record;
  return cachedPlaceImages;
}

/**
 * Geograph-sourced photos (fetch-district-images.ts / curate-borough-images.ts) - preferred over the Wikimedia banners
 * above wherever available, since Geograph has real coverage of ordinary postcode districts that Wikipedia mostly
 * doesn't. Falls back to getBannerImages(slug) only when Geograph has nothing for this slug.
 */
export function getPlaceImages(slug: string): BannerImage[] {
  const geograph = loadPlaceImages()[slug];
  return geograph && geograph.length > 0 ? geograph : getBannerImages(slug);
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

let cachedLocalElections: Record<string, LocalElectionData> | null = null;

// Local (borough) election results have no single free bulk API - each
// council publishes its own declared results, same problem as the
// councillors scrape in fetch-representatives.ts. Rather than fabricate
// ward-by-ward figures for boroughs we haven't sourced yet, this is a
// hand-curated reference table (see data/reference/local-elections.json),
// populated borough by borough as results are verified - a borough missing
// here just gets no "Local election results" section, same honest-gap
// approach as fetchCouncillorsByWard.
function loadLocalElections(): Record<string, LocalElectionData> {
  if (cachedLocalElections) return cachedLocalElections;
  const filePath = path.join(REFERENCE_DIR, "local-elections.json");
  cachedLocalElections = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, LocalElectionData>) : {};
  return cachedLocalElections;
}

export function getLocalElections(boroughSlug: string): LocalElectionData | undefined {
  return loadLocalElections()[boroughSlug];
}

/** This outcode's own wards, matched against the borough's ward-level election results (a ward not yet sourced is just left out, not fabricated). */
export function getWardElectionResults(boroughSlug: string, wards: string[]): WardElectionResult[] {
  const election = getLocalElections(boroughSlug);
  if (!election) return [];
  const wardSet = new Set(wards);
  return election.wards.filter((w) => wardSet.has(w.ward));
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
  const data = JSON.parse(raw) as OutcodeData;
  data.food = { establishments: (loadFoodHygiene()?.outcodes[data.outcode] ?? []).filter((e) => e.rating >= MIN_FOOD_RATING) };
  data.services = getCouncilServices(boroughSlug);
  data.demographics = loadDemographics()?.outcodes[data.outcode] ?? null;
  // Pubs live under Food & Hospitality (with hygiene ratings), not Places.
  data.places = { ...data.places, places: data.places.places.filter((p) => p.category !== "pub") };
  return data;
}

/** Businesses rated below this (FHRS 0 to 2) are not listed anywhere on the site. */
export const MIN_FOOD_RATING = 3;

let cachedFood: FoodHygieneFile | null | undefined;

// FSA hygiene ratings by outcode, written by scripts/ingest/fetch-food-hygiene.ts.
function loadFoodHygiene(): FoodHygieneFile | null {
  if (cachedFood !== undefined) return cachedFood;
  const filePath = path.join(PROCESSED_DIR, "food-hygiene.json");
  cachedFood = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as FoodHygieneFile) : null;
  return cachedFood;
}

export function getFoodHygieneMeta(): { source: string; fetchedAt: string; londonCounts: Record<string, number> } | null {
  const f = loadFoodHygiene();
  if (!f) return null;
  // London's split is compared against districts that only list ratings of MIN_FOOD_RATING and above, so leave the lower ratings out of it too.
  const londonCounts = Object.fromEntries(Object.entries(f.londonCounts).filter(([rating]) => Number(rating) >= MIN_FOOD_RATING));
  return { source: f.source, fetchedAt: f.fetchedAt, londonCounts };
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

export interface BoroughChildcareGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  providers: ChildcareProvider[];
}

/** Registered childcare providers (nurseries/childminders) for every outcode this borough is the primary owner of, grouped by outcode. */
export function getBoroughChildcare(citySlug: string, boroughSlug: string): BoroughChildcareGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, providers: data.childcare?.providers ?? [] };
    })
    .filter((g) => g.providers.length > 0)
    .sort((a, b) => a.outcode.localeCompare(b.outcode));
}

export interface BoroughPlacesGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  places: Place[];
}

/**
 * Places (parks, libraries, leisure centres, etc.) for every outcode this borough is the primary owner of, grouped by outcode.
 *
 * Each outcode's own list is "nearest places in the borough", so the same place shows up under
 * several outcodes; here it is kept once, under the outcode it is closest to.
 */
export function getBoroughPlaces(citySlug: string, boroughSlug: string): BoroughPlacesGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  const groups = (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, places: data.places.places };
    })
    .sort((a, b) => a.outcode.localeCompare(b.outcode));

  const placeKey = (p: Place) => `${p.category}|${p.name}|${p.latitude}|${p.longitude}`;
  const closest = new Map<string, { group: string; distanceKm: number }>();
  for (const g of groups) {
    for (const p of g.places) {
      const key = placeKey(p);
      const best = closest.get(key);
      if (!best || p.distanceKm < best.distanceKm) closest.set(key, { group: g.outcode, distanceKm: p.distanceKm });
    }
  }
  return groups
    .map((g) => ({ ...g, places: g.places.filter((p) => closest.get(placeKey(p))?.group === g.outcode) }))
    .filter((g) => g.places.length > 0);
}

export interface BoroughRepresentativesGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  representatives: Representative[];
}

/** MPs and ward councillors for every outcode this borough is the primary owner of, grouped by outcode. */
export function getBoroughRepresentatives(citySlug: string, boroughSlug: string): BoroughRepresentativesGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, representatives: data.representatives.representatives };
    })
    .filter((g) => g.representatives.length > 0)
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
export function hasContent(data: OutcodeData, category: keyof OutcodeData | "statistics"): boolean {
  // The Statistics tab covers property sales plus demographics/deprivation.
  if (category === "statistics") return hasContent(data, "property") || data.demographics != null;
  const value = data[category];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.values(value).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  }
  return Boolean(value);
}

/** Parliament member-search link pre-filled with the MP's name, instead of the generic MPs landing page. */
export function mpContactUrl(name: string): string {
  const q = new URLSearchParams({ SearchText: name, PartyId: "", Gender: "Any", ForParliament: "Current", ShowAdvanced: "False" });
  return `https://members.parliament.uk/members/commons?${q.toString()}`;
}

let cachedHpi: HpiData | null | undefined;

// UK HPI per borough + London, written by scripts/ingest/fetch-hpi.ts.
function loadHpi(): HpiData | null {
  if (cachedHpi !== undefined) return cachedHpi;
  const filePath = path.join(REFERENCE_DIR, "house-price-index.json");
  cachedHpi = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as HpiData) : null;
  return cachedHpi;
}

export function getHpi(boroughSlug: string): { borough: HpiSeries; london: HpiSeries; source: string } | null {
  const hpi = loadHpi();
  const borough = hpi?.boroughs[boroughSlug];
  return hpi && borough ? { borough, london: hpi.london, source: hpi.source } : null;
}

let cachedRents: RentsFile | null | undefined;

// ONS Price Index of Private Rents (monthly), written by scripts/ingest/fetch-rents.ts.
function loadRents(): RentsFile | null {
  if (cachedRents !== undefined) return cachedRents;
  const filePath = path.join(REFERENCE_DIR, "rents-current.json");
  cachedRents = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as RentsFile) : null;
  return cachedRents;
}

export function getRents(boroughSlug: string): { borough: AreaRents; london: AreaRents; latestMonth: string; source: string; trend: CityTrendData } | null {
  const rents = loadRents();
  const borough = rents?.boroughs[boroughSlug];
  if (!rents || !borough) return null;
  const name = getBoroughNameBySlug(boroughSlug);
  return {
    borough,
    london: rents.london,
    latestMonth: rents.latestMonth,
    source: rents.source,
    // Both series cover the same months (one PIPR release); the chart reuses the borough-comparison component.
    trend: { months: borough.history.months, boroughs: [{ name, slug: boroughSlug, series: borough.history.price }], average: rents.london.history.price },
  };
}

function getBoroughNameBySlug(slug: string): string {
  for (const city of loadHierarchy().cities) {
    const match = city.boroughs.find((b) => b.slug === slug);
    if (match) return match.name;
  }
  return slug;
}

function medianOf(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface PriceSummary {
  name: string;
  /** Sales in the most recent 12 months of Price Paid data. */
  sales: number;
  median: number | null;
  /** % change of the median vs the preceding period we hold, or null with too few sales to compare. */
  change: number | null;
}

function summarisePrices(name: string, sales: { price: number; date: string }[], cutoff: string): PriceSummary {
  const recent = sales.filter((s) => s.date >= cutoff).map((s) => s.price);
  const prior = sales.filter((s) => s.date < cutoff).map((s) => s.price);
  const median = medianOf(recent);
  const priorMedian = prior.length >= 10 && recent.length >= 10 ? medianOf(prior) : null;
  return { name, sales: recent.length, median, change: median != null && priorMedian ? ((median - priorMedian) / priorMedian) * 100 : null };
}

const cachedCityPrices = new Map<string, { all: { price: number; date: string }[]; cutoff: string; summary: PriceSummary }>();

/**
 * Median sale price per post town within a borough, against the borough as a
 * whole and London, all from Price Paid Data (like-for-like medians) - the
 * official HPI stops at borough level, so post towns can only be compared this way.
 */
export function getBoroughPostTownPrices(citySlug: string, boroughSlug: string): { postTowns: PriceSummary[]; borough: PriceSummary; london: PriceSummary; since: string } | null {
  const city = getCity(citySlug);
  const toSales = (slug: string, outcodes: HierarchyOutcode[]) =>
    outcodes.filter((o) => o.isPrimaryBorough).map((o) => ({ postTown: o.postTown, sales: loadOutcodeData(citySlug, slug, o.slug).property.sales }));

  const cityKey = citySlug;
  let cityPrices = cachedCityPrices.get(cityKey);
  if (!cityPrices) {
    const all = (city?.boroughs ?? []).flatMap((b) => toSales(b.slug, b.outcodes).flatMap((g) => g.sales.map((s) => ({ price: s.price, date: s.dateOfTransfer }))));
    const latest = all.reduce((max, s) => (s.date > max ? s.date : max), "");
    const cutoffDate = new Date(latest || Date.now());
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
    const cutoff = cutoffDate.toISOString().slice(0, 10);
    cityPrices = { all, cutoff, summary: summarisePrices("London", all, cutoff) };
    cachedCityPrices.set(cityKey, cityPrices);
  }
  if (cityPrices.all.length === 0) return null;
  const { cutoff } = cityPrices;

  const borough = getBorough(citySlug, boroughSlug);
  const groups = toSales(boroughSlug, borough?.outcodes ?? []);
  const byPostTown = new Map<string, { price: number; date: string }[]>();
  for (const g of groups) {
    const list = byPostTown.get(g.postTown) ?? [];
    list.push(...g.sales.map((s) => ({ price: s.price, date: s.dateOfTransfer })));
    byPostTown.set(g.postTown, list);
  }
  const boroughSales = [...byPostTown.values()].flat();
  return {
    postTowns: [...byPostTown.entries()].map(([name, sales]) => summarisePrices(name, sales, cutoff)).filter((p) => p.sales > 0).sort((a, b) => a.name.localeCompare(b.name)),
    borough: summarisePrices(borough?.name ?? boroughSlug, boroughSales, cutoff),
    london: cityPrices.summary,
    since: cutoff,
  };
}

let cachedBroadband: BroadbandFile | null | undefined;

// Ofcom fixed broadband availability, written by scripts/ingest/fetch-broadband.ts.
function loadBroadband(): BroadbandFile | null {
  if (cachedBroadband !== undefined) return cachedBroadband;
  const filePath = path.join(PROCESSED_DIR, "broadband.json");
  cachedBroadband = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as BroadbandFile) : null;
  return cachedBroadband;
}

export function getBroadband(outcode: string, boroughSlug: string): { outcode: BroadbandMetrics & { postcodes: number }; borough: BroadbandMetrics | null; london: BroadbandMetrics; period: string; source: string } | null {
  const b = loadBroadband();
  const local = b?.outcodes[outcode];
  return b && local ? { outcode: local, borough: b.boroughs[boroughSlug] ?? null, london: b.london, period: b.period, source: b.source } : null;
}

export function getBoroughBroadband(boroughSlug: string): { borough: BroadbandMetrics; london: BroadbandMetrics; period: string; source: string } | null {
  const b = loadBroadband();
  const borough = b?.boroughs[boroughSlug];
  return b && borough ? { borough, london: b.london, period: b.period, source: b.source } : null;
}

let cachedMobile: MobileCoverageFile | null | undefined;

// Ofcom mobile coverage per borough, written by scripts/ingest/fetch-mobile.ts.
function loadMobile(): MobileCoverageFile | null {
  if (cachedMobile !== undefined) return cachedMobile;
  const filePath = path.join(PROCESSED_DIR, "mobile.json");
  cachedMobile = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as MobileCoverageFile) : null;
  return cachedMobile;
}

export function getMobileCoverage(boroughSlug: string): { borough: MobileCoverageMetrics; london: MobileCoverageMetrics; period: string; source: string } | null {
  const m = loadMobile();
  const borough = m?.boroughs[boroughSlug];
  return m && borough ? { borough, london: m.london, period: m.period, source: m.source } : null;
}

let cachedCouncilServices: CouncilServicesFile | null | undefined;

// Each council's own pages for common tasks (bin days, Council Tax, parking...),
// from GOV.UK's Local Links Manager - see scripts/ingest/fetch-council-services.ts.
function loadCouncilServices(): CouncilServicesFile | null {
  if (cachedCouncilServices !== undefined) return cachedCouncilServices;
  const filePath = path.join(REFERENCE_DIR, "council-services.json");
  cachedCouncilServices = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as CouncilServicesFile) : null;
  return cachedCouncilServices;
}

export function getCouncilServices(boroughSlug: string): CouncilServicesData {
  const file = loadCouncilServices();
  const council = file?.councils[boroughSlug];
  if (!file || !council) return { councilName: "", homepage: "", links: [] };
  return {
    councilName: council.name,
    homepage: council.homepage,
    links: file.services.filter((s) => council.links[s.slug]).map((s) => ({ slug: s.slug, title: s.title, group: s.group, url: council.links[s.slug] })),
  };
}

/** Police + fire stations in a borough (each outcode lists the whole borough's stations, so dedupe across outcodes). */
export function getBoroughSafetyServiceCount(citySlug: string, boroughSlug: string): number {
  const stations = new Set<string>();
  for (const outcode of (getBorough(citySlug, boroughSlug)?.outcodes ?? []).filter((o) => o.isPrimaryBorough)) {
    const { safety } = loadOutcodeData(citySlug, boroughSlug, outcode.slug);
    for (const s of safety.policeStations) stations.add(`police|${s.name}|${s.postcode}`);
    for (const s of safety.fireStations) stations.add(`fire|${s.name}|${s.postcode}`);
  }
  return stations.size;
}

export interface BoroughFoodGroup {
  outcode: string;
  outcodeSlug: string;
  wards: string[];
  postTown: string;
  establishments: FoodEstablishment[];
}

/** Rated food businesses for every outcode this borough is the primary owner of, grouped by outcode. */
export function getBoroughFood(citySlug: string, boroughSlug: string): BoroughFoodGroup[] {
  const borough = getBorough(citySlug, boroughSlug);
  return (borough?.outcodes ?? [])
    .filter((o) => o.isPrimaryBorough)
    .map((o) => {
      const data = loadOutcodeData(citySlug, boroughSlug, o.slug);
      return { outcode: o.outcode, outcodeSlug: o.slug, wards: o.wards, postTown: o.postTown, establishments: data.food.establishments };
    })
    .filter((g) => g.establishments.length > 0)
    .sort((a, b) => a.outcode.localeCompare(b.outcode));
}

let cachedDemographics: DemographicsFile | null | undefined;

// Census 2021 demographics + IMD deprivation, written by scripts/ingest/fetch-demographics.ts.
function loadDemographics(): DemographicsFile | null {
  if (cachedDemographics !== undefined) return cachedDemographics;
  const filePath = path.join(PROCESSED_DIR, "demographics.json");
  cachedDemographics = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as DemographicsFile) : null;
  return cachedDemographics;
}

export function getBoroughDemographics(boroughSlug: string): { borough: DemographicsWithDeprivation; london: DemographicsWithDeprivation; source: string } | null {
  const d = loadDemographics();
  const borough = d?.boroughs[boroughSlug];
  return d && borough ? { borough, london: d.london, source: d.source } : null;
}

export function getLondonDemographics(): { london: DemographicsWithDeprivation; source: string } | null {
  const d = loadDemographics();
  return d ? { london: d.london, source: d.source } : null;
}

let cachedJourneyTimes: JourneyTimesFile | null | undefined;

// TfL Journey Planner times to central London, written by scripts/ingest/fetch-journey-times.ts.
function loadJourneyTimes(): JourneyTimesFile | null {
  if (cachedJourneyTimes !== undefined) return cachedJourneyTimes;
  const filePath = path.join(PROCESSED_DIR, "journey-times.json");
  cachedJourneyTimes = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as JourneyTimesFile) : null;
  return cachedJourneyTimes;
}

/** Fastest journeys from an outcode to each central London destination, quickest first. */
export function getJourneyTimes(outcode: string): { departure: string; source: string; journeys: { id: string; name: string; area: string; minutes: number; modes: string[]; changes: number }[] } | null {
  const file = loadJourneyTimes();
  const times = file?.outcodes[outcode];
  if (!file || !times) return null;
  const journeys = file.destinations
    .filter((d) => times[d.id])
    .map((d) => ({ ...d, ...times[d.id] }))
    .sort((a, b) => a.minutes - b.minutes);
  return journeys.length > 0 ? { departure: file.departure, source: file.source, journeys } : null;
}

/** Recorded crimes by category across a borough's own postcode districts (each within ~1 mile of its centre), largest first. */
export function getBoroughCrimeCategories(citySlug: string, boroughSlug: string): [string, number][] {
  const totals = new Map<string, number>();
  for (const outcode of (getBorough(citySlug, boroughSlug)?.outcodes ?? []).filter((o) => o.isPrimaryBorough)) {
    for (const [category, count] of Object.entries(loadOutcodeData(citySlug, boroughSlug, outcode.slug).safety.categoryBreakdown)) {
      totals.set(category, (totals.get(category) ?? 0) + count);
    }
  }
  return [...totals.entries()].sort(([, a], [, b]) => b - a);
}

// ---- Environment: road noise and green space ----

let cachedNoise: NoiseFile | null | undefined;

// Defra road noise bands per district, written by scripts/ingest/fetch-noise.ts.
function loadNoise(): NoiseFile | null {
  if (cachedNoise !== undefined) return cachedNoise;
  const filePath = path.join(PROCESSED_DIR, "noise.json");
  cachedNoise = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as NoiseFile) : null;
  return cachedNoise;
}

const meanBands = (all: number[][]): number[] | null => {
  if (all.length === 0) return null;
  return all[0].map((_, i) => Math.round((all.reduce((sum, b) => sum + b[i], 0) / all.length) * 10) / 10);
};

/** Share of the area within a mile of a district's centre in each road-noise band, for the district, its borough (mean of its districts) and London. */
export function getNoise(outcode: string, citySlug: string, boroughSlug: string): { outcode: number[] | null; borough: number[] | null; london: number[] | null; labels: string[]; modelled: string; source: string } | null {
  const noise = loadNoise();
  if (!noise) return null;
  const inBorough = (getBorough(citySlug, boroughSlug)?.outcodes ?? []).filter((o) => o.isPrimaryBorough).map((o) => noise.outcodes[o.outcode]?.bands).filter((b): b is number[] => Boolean(b));
  return {
    outcode: noise.outcodes[outcode]?.bands ?? null,
    borough: meanBands(inBorough),
    london: meanBands(Object.values(noise.outcodes).map((o) => o.bands)),
    labels: noise.bandLabels,
    modelled: noise.modelled,
    source: noise.source,
  };
}

let cachedGreenspace: GreenspaceFile | null | undefined;

// ONS green space and garden access, written by scripts/ingest/fetch-greenspace.ts.
function loadGreenspace(): GreenspaceFile | null {
  if (cachedGreenspace !== undefined) return cachedGreenspace;
  const filePath = path.join(PROCESSED_DIR, "greenspace.json");
  cachedGreenspace = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as GreenspaceFile) : null;
  return cachedGreenspace;
}

export function getGreenspace(boroughSlug: string, outcode?: string): { outcode: GreenspaceMetrics | null; borough: GreenspaceMetrics | null; london: GreenspaceMetrics; year: number; source: string } | null {
  const g = loadGreenspace();
  if (!g) return null;
  return { outcode: outcode ? g.outcodes[outcode] ?? null : null, borough: g.boroughs[boroughSlug] ?? null, london: g.london, year: g.year, source: g.source };
}

// ---- Transport: EV charging ----

let cachedEv: EvChargingFile | null | undefined;

// DfT charging device statistics plus OpenStreetMap charge point locations, written by scripts/ingest/fetch-ev.ts.
function loadEv(): EvChargingFile | null {
  if (cachedEv !== undefined) return cachedEv;
  const filePath = path.join(PROCESSED_DIR, "ev-charging.json");
  cachedEv = existsSync(filePath) ? (JSON.parse(readFileSync(filePath, "utf-8")) as EvChargingFile) : null;
  return cachedEv;
}

export interface EvSiteNearby {
  name: string;
  operator: string;
  capacity: number | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

/** Borough charging totals against London, plus the mapped charge points within a radius of a point (nearest first). */
export function getEvCharging(boroughSlug: string, latitude: number, longitude: number, radiusKm = 1.6): { borough: EvBoroughStats | null; london: EvBoroughStats; period: string; source: string; nearby: EvSiteNearby[]; nearbyPoints: number } | null {
  const ev = loadEv();
  if (!ev) return null;
  const nearby = ev.sites
    .map((s) => ({ name: s.name, operator: s.operator, capacity: s.capacity, latitude: s.lat, longitude: s.lon, distanceKm: haversineKm(latitude, longitude, s.lat, s.lon) }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((s) => ({ ...s, distanceKm: Math.round(s.distanceKm * 10) / 10 }));
  return {
    borough: ev.boroughs[boroughSlug] ?? null,
    london: ev.london,
    period: ev.period,
    source: ev.source,
    nearby,
    nearbyPoints: nearby.reduce((sum, s) => sum + (s.capacity ?? 1), 0),
  };
}

/** "2026-08" -> "Aug 2026"; "2026-08-31" -> "31 Aug 2026". */
export function formatDataDate(value: string): string {
  const parts = value.split("-");
  const monthName = (m: string) => new Date(2000, Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "short" });
  if (parts.length === 3) return `${Number(parts[2])} ${monthName(parts[1])} ${parts[0]}`;
  if (parts.length === 2) return `${monthName(parts[1])} ${parts[0]}`;
  return value;
}
