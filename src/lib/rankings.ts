// Ranked lists of London's postcode districts and boroughs, built from the same numbers as the Compare page.
import { buildCompareData, type CompareMetrics } from "./compare";

export interface Column {
  label: string;
  get: (m: CompareMetrics) => number | null;
  format: (n: number) => string;
}

export interface RankingDef {
  slug: string;
  /** Short name for links and cards. */
  name: string;
  title: string;
  description: string;
  emoji: string;
  /** Districts are ranked individually; borough rankings list whole boroughs. */
  scope: "district" | "borough";
  /** The figure the list is ordered by. */
  primary: Column;
  /** true = the highest value is best. */
  higherIsBetter: boolean;
  /** Extra columns for context. */
  extra: Column[];
  /** Districts without this many figures are left out (e.g. fewer than 20 rated food businesses). */
  eligible?: (m: CompareMetrics) => boolean;
  caveat: string;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-GB");
const pct = (n: number) => `${n.toFixed(1)}%`;
const mins = (n: number) => `${n} min`;

const price: Column = { label: "Median sale price", get: (m) => m.medianPrice, format: (n) => gbp.format(n) };
const journey: Column = { label: "Avg journey to central London", get: (m) => m.avgJourney, format: mins };
const noise: Column = { label: "Area at 55 dB or more", get: (m) => m.noise55, format: pct };
const park: Column = { label: "Postcodes within 300 m of a park", get: (m) => m.within300m, format: pct };
const garden: Column = { label: "Homes with a private garden", get: (m) => m.gardenShare, format: pct };
const greenScore: Column = {
  label: "Green space score",
  get: (m) => (m.within300m !== null && m.gardenShare !== null ? Math.round(((m.within300m + m.gardenShare) / 2) * 10) / 10 : null),
  format: (n) => `${n.toFixed(1)}/100`,
};
const crime: Column = { label: "Recorded crimes (12 months)", get: (m) => m.crimes12mo, format: (n) => num.format(n) };
const gigabit: Column = { label: "Gigabit broadband", get: (m) => m.gigabit, format: pct };

export const RANKINGS: RankingDef[] = [
  {
    slug: "quietest-areas",
    name: "Quietest areas",
    title: "Quietest areas in London",
    description: "London's postcode districts ranked by how little of the area is exposed to loud road traffic noise, from Defra's official noise maps.",
    emoji: "🤫",
    scope: "district",
    primary: noise,
    higherIsBetter: false,
    extra: [{ label: "Area under 45 dB (quiet)", get: (m) => m.noiseQuiet, format: pct }, price, journey],
    caveat: "Road noise only: rail and aircraft noise are not included. Noise is modelled by Defra for 2022 and averaged over the area within a mile of each district's centre.",
  },
  {
    slug: "greenest-areas",
    name: "Greenest areas",
    title: "Greenest areas in London",
    description: "London's postcode districts ranked on green space: how close homes are to a park, public garden or playing field, and how many have a private garden. From ONS and Ordnance Survey data.",
    emoji: "🌳",
    scope: "district",
    primary: greenScore,
    higherIsBetter: true,
    extra: [park, garden, { label: "Parks within 1 km", get: (m) => m.parksWithin1km, format: (n) => n.toFixed(1) }],
    caveat: "The score is the average of the share of postcodes within 300 m of a park and the share of homes with a private garden (2020 data), so places with both rank highest. Sites labelled playing fields may be private.",
  },
  {
    slug: "best-broadband",
    name: "Best broadband",
    title: "London areas with the best broadband",
    description: "London's postcode districts ranked by the share of homes that can get gigabit broadband, from Ofcom's Connected Nations data.",
    emoji: "📶",
    scope: "district",
    primary: gigabit,
    higherIsBetter: true,
    extra: [{ label: "Superfast (30+ Mbit/s)", get: (m) => m.superfast, format: pct }, price],
    caveat: "This is what is available to order at homes in the district, not the speed people actually get. Check an exact address before you sign a contract.",
  },
  {
    slug: "shortest-commute",
    name: "Shortest commute to central London",
    title: "Shortest commutes to central London",
    description: "London's postcode districts ranked by average journey time to Bank, Canary Wharf, King's Cross, Oxford Circus and Victoria on a weekday morning.",
    emoji: "🚇",
    scope: "district",
    primary: journey,
    higherIsBetter: false,
    extra: [price, noise],
    eligible: (m) => m.avgJourney !== null,
    caveat: "Fastest public transport journey planned by TfL for 08:30 on one weekday, door to door from the centre of the district. Your own commute will depend on where you work.",
  },
  {
    slug: "cheapest-to-buy",
    name: "Cheapest areas to buy",
    title: "Cheapest areas to buy in London",
    description: "London's postcode districts ranked by median sale price over the last two years, from HM Land Registry Price Paid Data.",
    emoji: "🏠",
    scope: "district",
    primary: price,
    higherIsBetter: false,
    extra: [{ label: "Sales in two years", get: (m) => m.salesCount, format: (n) => num.format(n) }, journey, noise],
    eligible: (m) => (m.salesCount ?? 0) >= 30,
    caveat: "Median of homes sold in the district over roughly two years. Districts with fewer than 30 sales are left out. Prices vary a lot by property type and street.",
  },
  {
    slug: "lowest-recorded-crime",
    name: "Lowest recorded crime",
    title: "London areas with the lowest recorded crime",
    description: "London's postcode districts ranked by police-recorded crime in the last 12 months, from data.police.uk.",
    emoji: "🛡️",
    scope: "district",
    primary: crime,
    higherIsBetter: false,
    extra: [price, journey],
    eligible: (m) => (m.crimes12mo ?? 0) > 0,
    caveat:
      "These are counts of crimes recorded within about a mile of each district's centre, not crime rates per resident, so busy central areas with lots of visitors appear high. Use them as a rough guide and read the crime section on each district's Statistics page.",
  },
  {
    slug: "best-for-food",
    name: "Best for eating out",
    title: "London areas with the best-rated places to eat",
    description: "London's postcode districts ranked by the share of restaurants, cafes, takeaways, pubs and food shops rated 5 for food hygiene.",
    emoji: "🍽️",
    scope: "district",
    primary: { label: "Rated 5 for food hygiene", get: (m) => m.foodRated5, format: pct },
    higherIsBetter: true,
    extra: [{ label: "Rated food businesses", get: (m) => m.foodBusinesses, format: (n) => num.format(n) }, price],
    eligible: (m) => (m.foodBusinesses ?? 0) >= 40,
    caveat: "Food hygiene rating is about kitchen cleanliness and safety, not taste. Only businesses rated 3 or above are counted, and districts with fewer than 40 rated businesses are left out.",
  },
  {
    slug: "cheapest-boroughs-to-rent",
    name: "Cheapest boroughs to rent",
    title: "Cheapest boroughs to rent in London",
    description: "London's boroughs ranked by average monthly private rent, from the ONS Price Index of Private Rents.",
    emoji: "🔑",
    scope: "borough",
    primary: { label: "Average rent per month", get: (m) => m.boroughRent, format: (n) => gbp.format(n) },
    higherIsBetter: false,
    extra: [{ label: "2-bedroom rent", get: (m) => m.boroughRent2Bed, format: (n) => gbp.format(n) }, { label: "Band D Council Tax", get: (m) => m.boroughBandD, format: (n) => gbp.format(n) }, journey],
    eligible: (m) => m.boroughRent !== null,
    caveat: "Average rent across all private tenancies in the borough (August 2026), not just new lets. City of London has no published figure.",
  },
];

export interface RankedRow {
  rank: number;
  code: string;
  /** For a district, its code and place name ("TW11 Teddington"); for a borough, just the name. */
  name: string;
  subtitle: string;
  href: string;
  primary: string;
  extra: string[];
}

export function getRanking(slug: string): { def: RankingDef; rows: RankedRow[] } | null {
  const def = RANKINGS.find((r) => r.slug === slug);
  if (!def) return null;
  const data = buildCompareData();
  const items =
    def.scope === "district"
      ? data.districts
          // Districts that mostly sit outside London (e.g. Westerham, in Kent) would rank on a sliver of London, so leave them out.
          .filter((d) => d.sharePercent >= 50)
          .map((d) => ({ code: d.code, name: `${d.code} ${d.name}`, subtitle: d.borough, href: `/${d.citySlug}/${d.boroughSlug}/${d.slug}/statistics/`, m: d.m }))
      : data.boroughs.map((b) => ({ code: b.code, name: b.name, subtitle: "Whole borough", href: `/${b.citySlug}/statistics/?highlight=${b.slug}`, m: b.m }));

  const rows = items
    .filter((i) => def.primary.get(i.m) !== null && (def.eligible ? def.eligible(i.m) : true))
    .sort((a, b) => {
      const diff = def.primary.get(a.m)! - def.primary.get(b.m)!;
      return def.higherIsBetter ? -diff : diff;
    })
    .map((i, index) => ({
      rank: index + 1,
      code: i.code,
      name: i.name,
      subtitle: i.subtitle,
      href: i.href,
      primary: def.primary.format(def.primary.get(i.m)!),
      extra: def.extra.map((c) => {
        const v = c.get(i.m);
        return v === null ? "n/a" : c.format(v);
      }),
    }));
  return { def, rows };
}
