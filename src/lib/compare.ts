// The numbers the Compare page shows for each postcode district, gathered once at build time into /compare-data.json.
import {
  displayPlaceName,
  getBoroughBroadband,
  getBoroughDemographics,
  getBoroughFood,
  getBoroughPlaces,
  getBoroughSummary,
  getBroadband,
  getGreenspace,
  getNoise,
  getCouncilTax,
  getHpi,
  getJourneyTimes,
  getRents,
  loadHierarchy,
  loadOutcodeData,
} from "./data";

/** null = we hold no figure for this district. */
export interface CompareMetrics {
  medianPrice: number | null;
  salesCount: number | null;
  boroughRent: number | null;
  boroughRent2Bed: number | null;
  boroughPrice: number | null;
  boroughBandD: number | null;
  population: number | null;
  under15: number | null;
  over65: number | null;
  owned: number | null;
  privateRented: number | null;
  degree: number | null;
  mostDeprived30: number | null;
  crimes12mo: number | null;
  gigabit: number | null;
  superfast: number | null;
  foodBusinesses: number | null;
  foodRated5: number | null;
  healthServices: number | null;
  schools: number | null;
  places: number | null;
  safetyServices: number | null;
  /** % of the area within a mile of the centre at 55 dB or more of road noise, and under 45 dB. */
  noise55: number | null;
  noiseQuiet: number | null;
  parkDistanceM: number | null;
  parksWithin1km: number | null;
  /** % of postcodes within 300 m of a park. */
  within300m: number | null;
  gardenShare: number | null;
  /** Mean of the fastest journeys to the central London destinations, in minutes. */
  avgJourney: number | null;
  /** Fastest journey in minutes, by destination id (see the journey-times data). */
  journeys: Record<string, number>;
}

export interface CompareDistrict {
  /** Postcode district, e.g. "TW11". */
  code: string;
  /** The district's own page slug, e.g. "tw11" - what the favourites store. */
  slug: string;
  name: string;
  citySlug: string;
  boroughSlug: string;
  borough: string;
  /** % of the district that lies inside London (inside the borough that owns most of it). Low for districts that mostly sit outside. */
  sharePercent: number;
  m: CompareMetrics;
}

export interface CompareBorough {
  /** "b:" plus the borough slug, e.g. "b:camden" - kept apart from district codes like "TW11". */
  code: string;
  slug: string;
  name: string;
  citySlug: string;
  m: CompareMetrics;
}

export interface CompareData {
  journeyDestinations: { id: string; name: string }[];
  journeyDeparture: string | null;
  districts: CompareDistrict[];
  boroughs: CompareBorough[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const sumBands = (bands: number[] | null | undefined, from: number, to?: number) => (bands ? round1(bands.slice(from, to).reduce((a, b) => a + b, 0)) : null);
const meanOf = (nums: number[]): number | null => (nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

let cachedCompare: CompareData | undefined;

export function buildCompareData(): CompareData {
  if (cachedCompare) return cachedCompare;
  const districts: CompareDistrict[] = [];
  const seen = new Set<string>();
  let journeyDestinations: CompareData["journeyDestinations"] = [];
  let journeyDeparture: string | null = null;

  for (const city of loadHierarchy().cities) {
    for (const borough of city.boroughs) {
      for (const outcode of borough.outcodes) {
        // A district shared between two boroughs appears under both; compare it once, under the borough that owns most of it.
        if (!outcode.isPrimaryBorough || seen.has(outcode.outcode)) continue;
        seen.add(outcode.outcode);

        const data = loadOutcodeData(city.slug, borough.slug, outcode.slug);
        const hpi = getHpi(borough.slug);
        const rents = getRents(borough.slug);
        const tax = getCouncilTax(borough.slug);
        const broadband = getBroadband(data.outcode, borough.slug);
        const journeys = getJourneyTimes(data.outcode);
        if (journeys && journeyDestinations.length === 0) {
          journeyDestinations = journeys.journeys.map((j) => ({ id: j.id, name: j.name }));
          journeyDeparture = journeys.departure;
        }
        const food = data.food.establishments;
        const demo = data.demographics;
        const noise = getNoise(data.outcode, city.slug, borough.slug)?.outcode;
        const green = getGreenspace(borough.slug, data.outcode)?.outcode;

        districts.push({
          code: data.outcode,
          slug: outcode.slug,
          name: displayPlaceName(data.postTown, data.wards, data.city),
          citySlug: city.slug,
          boroughSlug: borough.slug,
          borough: borough.name,
          sharePercent: outcode.sharePercent,
          m: {
            medianPrice: data.property.medianPrice ?? null,
            salesCount: data.property.sales.length || null,
            boroughRent: rents?.borough.byBedrooms.all.price ?? null,
            boroughRent2Bed: rents?.borough.byBedrooms.twoBed.price ?? null,
            boroughPrice: hpi ? hpi.borough.averagePrice[hpi.borough.averagePrice.length - 1] : null,
            boroughBandD: tax?.bandD ?? null,
            population: demo?.population ?? null,
            under15: demo?.age.under15 ?? null,
            over65: demo?.age.age65plus ?? null,
            owned: demo?.tenure.owned ?? null,
            privateRented: demo?.tenure.privateRented ?? null,
            degree: demo?.qualifications.degreeLevel ?? null,
            mostDeprived30: demo ? round1(demo.imdDeciles.slice(0, 3).reduce((a, b) => a + b, 0)) : null,
            crimes12mo: data.safety.totalLast12Months || null,
            gigabit: broadband?.outcode.gigabit ?? null,
            superfast: broadband?.outcode.superfast ?? null,
            foodBusinesses: food.length || null,
            foodRated5: food.length > 0 ? round1((food.filter((e) => e.rating === 5).length / food.length) * 100) : null,
            healthServices: data.health.gpSurgeries.length,
            schools: data.schools.schools.length,
            places: data.places.places.length,
            safetyServices: data.safety.policeStations.length + data.safety.fireStations.length,
            noise55: sumBands(noise, 4),
            noiseQuiet: sumBands(noise, 0, 2),
            parkDistanceM: green?.parkDistanceM ?? null,
            parksWithin1km: green?.parksWithin1km ?? null,
            within300m: green?.within300m ?? null,
            gardenShare: green?.gardenShare ?? null,
            avgJourney: meanOf(Object.values(journeys?.journeys ?? []).map((j) => j.minutes)),
            journeys: Object.fromEntries((journeys?.journeys ?? []).map((j) => [j.id, j.minutes])),
          },
        });
      }
    }
  }

  districts.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  cachedCompare = { journeyDestinations, journeyDeparture, districts, boroughs: buildBoroughs(districts) };
  return cachedCompare;
}

const medianOf = (nums: number[]): number | null => {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Whole-borough figures on the same rows as a district, so a borough can sit in the same comparison. */
function buildBoroughs(districts: CompareDistrict[]): CompareBorough[] {
  const result: CompareBorough[] = [];
  for (const city of loadHierarchy().cities) {
    for (const borough of city.boroughs) {
      const own = districts.filter((d) => d.boroughSlug === borough.slug);
      const primary = borough.outcodes.filter((o) => o.isPrimaryBorough);
      const summary = getBoroughSummary(city.slug, borough.slug);
      const hpi = getHpi(borough.slug);
      const rents = getRents(borough.slug);
      const tax = getCouncilTax(borough.slug);
      const demo = getBoroughDemographics(borough.slug)?.borough;
      const broadband = getBoroughBroadband(borough.slug)?.borough;
      const food = getBoroughFood(city.slug, borough.slug).flatMap((g) => g.establishments);
      const places = getBoroughPlaces(city.slug, borough.slug).reduce((sum, g) => sum + g.places.length, 0);
      const noise = getNoise("", city.slug, borough.slug)?.borough;
      const green = getGreenspace(borough.slug)?.borough;
      const prices = primary.flatMap((o) => loadOutcodeData(city.slug, borough.slug, o.slug).property.sales.map((s) => s.price));

      // Journey times are per district; a borough's figure is the average of its districts'.
      const journeys: Record<string, number> = {};
      for (const dest of Object.keys(own[0]?.m.journeys ?? {})) {
        const times = own.map((d) => d.m.journeys[dest]).filter((t): t is number => typeof t === "number");
        if (times.length > 0) journeys[dest] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      }

      result.push({
        code: `b:${borough.slug}`,
        slug: borough.slug,
        name: borough.name,
        citySlug: city.slug,
        m: {
          medianPrice: medianOf(prices),
          salesCount: prices.length || null,
          boroughRent: rents?.borough.byBedrooms.all.price ?? null,
          boroughRent2Bed: rents?.borough.byBedrooms.twoBed.price ?? null,
          boroughPrice: hpi ? hpi.borough.averagePrice[hpi.borough.averagePrice.length - 1] : null,
          boroughBandD: tax?.bandD ?? null,
          population: demo?.population ?? null,
          under15: demo?.age.under15 ?? null,
          over65: demo?.age.age65plus ?? null,
          owned: demo?.tenure.owned ?? null,
          privateRented: demo?.tenure.privateRented ?? null,
          degree: demo?.qualifications.degreeLevel ?? null,
          mostDeprived30: demo ? round1(demo.imdDeciles.slice(0, 3).reduce((a, b) => a + b, 0)) : null,
          crimes12mo: summary.crimes12mo || null,
          gigabit: broadband?.gigabit ?? null,
          superfast: broadband?.superfast ?? null,
          foodBusinesses: food.length || null,
          foodRated5: food.length > 0 ? round1((food.filter((e) => e.rating === 5).length / food.length) * 100) : null,
          healthServices: summary.gpSurgeries,
          schools: summary.schools,
          places,
          safetyServices: own[0]?.m.safetyServices ?? null,
          noise55: sumBands(noise, 4),
          noiseQuiet: sumBands(noise, 0, 2),
          parkDistanceM: green?.parkDistanceM ?? null,
          parksWithin1km: green?.parksWithin1km ?? null,
          within300m: green?.within300m ?? null,
          gardenShare: green?.gardenShare ?? null,
          avgJourney: meanOf(Object.values(journeys)),
          journeys,
        },
      });
    }
  }
  return result;
}
