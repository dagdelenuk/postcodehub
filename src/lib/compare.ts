// The numbers the Compare page shows for each postcode district, gathered once at build time into /compare-data.json.
import {
  displayPlaceName,
  getBroadband,
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
  m: CompareMetrics;
}

export interface CompareData {
  journeyDestinations: { id: string; name: string }[];
  journeyDeparture: string | null;
  districts: CompareDistrict[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildCompareData(): CompareData {
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

        districts.push({
          code: data.outcode,
          slug: outcode.slug,
          name: displayPlaceName(data.postTown, data.wards, data.city),
          citySlug: city.slug,
          boroughSlug: borough.slug,
          borough: borough.name,
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
            journeys: Object.fromEntries((journeys?.journeys ?? []).map((j) => [j.id, j.minutes])),
          },
        });
      }
    }
  }

  districts.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  return { journeyDestinations, journeyDeparture, districts };
}
