// Per-section "key figures" summaries for a Statistics page: a sentence with the area's own numbers, and where it ranks
// among its peers - other postcode districts in the same borough for a district page, other London boroughs for a borough
// page. Built on the same buildCompareData() pool as src/lib/glance.ts, but stating the figures plainly rather than just
// an adjective.
import { buildCompareData, type CompareMetrics } from "./compare";

export type SummarySection = "housing" | "demographics" | "crime" | "connectivity" | "environment";

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(1)}%`;

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Where `value` ranks in `pool` (1 = best), and the pool size. Ties share the better rank. */
function rankAmong(pool: number[], value: number, higherIsBetter: boolean): { rank: number; total: number } {
  const better = pool.filter((v) => (higherIsBetter ? v > value : v < value)).length;
  return { rank: better + 1, total: pool.length };
}

/** "the Nth highest/lowest of <total> <peers>" - null when there's nothing to compare against. */
function rankPhrase(pool: number[], value: number, higherIsBetter: boolean, peers: string): string | null {
  if (pool.length < 3) return null;
  const { rank, total } = rankAmong(pool, value, higherIsBetter);
  const word = higherIsBetter ? "highest" : "lowest";
  return `the ${ordinal(rank)} ${word} of ${total} ${peers}`;
}

function values(pool: CompareMetrics[], get: (m: CompareMetrics) => number | null): number[] {
  return pool.map(get).filter((v): v is number => v !== null);
}

function build(section: SummarySection, m: CompareMetrics, pool: CompareMetrics[], place: string, peers: string): string | null {
  switch (section) {
    case "housing": {
      const parts: string[] = [];
      if (m.medianPrice !== null) {
        const phrase = rankPhrase(values(pool, (x) => x.medianPrice), m.medianPrice, true, peers);
        parts.push(`${place}'s median sale price is ${gbp.format(m.medianPrice)}${phrase ? `, ${phrase}` : ""}`);
      }
      if (m.boroughRent !== null) parts.push(`rent averages ${gbp.format(m.boroughRent)} a month`);
      return parts.length > 0 ? `${parts.join("; ")}.` : null;
    }
    case "demographics": {
      const parts: string[] = [];
      if (m.population !== null) parts.push(`${place} has a population of around ${m.population.toLocaleString()}`);
      if (m.under15 !== null) parts.push(`${pct(m.under15)} are under 15`);
      if (m.over65 !== null) parts.push(`${pct(m.over65)} are 65 or over`);
      if (m.mostDeprived30 !== null) {
        const phrase = rankPhrase(values(pool, (x) => x.mostDeprived30), m.mostDeprived30, true, peers);
        parts.push(`${pct(m.mostDeprived30)} of the area falls in England's most deprived 30%${phrase ? `, ${phrase}` : ""}`);
      }
      return parts.length > 0 ? `${parts.join("; ")}.` : null;
    }
    case "crime": {
      if (m.crimes12mo === null) return null;
      const phrase = rankPhrase(values(pool, (x) => x.crimes12mo), m.crimes12mo, false, peers);
      return `${m.crimes12mo.toLocaleString()} crimes were recorded in the last 12 months${phrase ? `, ${phrase} for recorded crime (lowest first)` : ""}.`;
    }
    case "connectivity": {
      if (m.gigabit === null) return null;
      const phrase = rankPhrase(values(pool, (x) => x.gigabit), m.gigabit, true, peers);
      return `Gigabit broadband reaches ${pct(m.gigabit)} of homes${phrase ? `, ${phrase}` : ""}.`;
    }
    case "environment": {
      const parts: string[] = [];
      if (m.noise55 !== null) {
        const phrase = rankPhrase(values(pool, (x) => x.noise55), m.noise55, false, peers);
        parts.push(`${pct(m.noise55)} of the area is exposed to 55 dB or more of road noise${phrase ? `, ${phrase} for road noise (quietest first)` : ""}`);
      }
      if (m.within300m !== null) parts.push(`${pct(m.within300m)} of postcodes are within 300 m of a park`);
      return parts.length > 0 ? `${parts.join("; ")}.` : null;
    }
    default:
      return null;
  }
}

/** A borough's key-figures summary for one section, ranked against every other London borough. */
export function boroughSectionSummary(section: SummarySection, boroughSlug: string): string | null {
  const data = buildCompareData();
  const own = data.boroughs.find((b) => b.slug === boroughSlug);
  if (!own) return null;
  const pool = data.boroughs.filter((b) => b.slug !== boroughSlug).map((b) => b.m);
  return build(section, own.m, pool, own.name, "other London boroughs");
}

/** A district's key-figures summary for one section, ranked against the other postcode districts in its own borough. */
export function districtSectionSummary(section: SummarySection, code: string): string | null {
  const data = buildCompareData();
  const own = data.districts.find((d) => d.code === code);
  if (!own) return null;
  const siblings = data.districts.filter((d) => d.boroughSlug === own.boroughSlug);
  const pool = siblings.filter((d) => d.code !== code).map((d) => d.m);
  return build(section, own.m, pool, own.code, `postcode districts in ${own.borough}`);
}
