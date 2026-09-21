// "Areas like this one": the districts whose numbers sit closest to a district's, and how they differ.
import { buildCompareData, type CompareDistrict, type CompareMetrics } from "./compare";

interface Feature {
  weight: number;
  get: (m: CompareMetrics) => number | null;
}

// What makes two places feel alike to someone choosing where to live: cost, commute, crime, noise, greenery, and who lives there.
const FEATURES: Feature[] = [
  { weight: 1.5, get: (m) => (m.medianPrice ? Math.log(m.medianPrice) : null) },
  { weight: 1.2, get: (m) => m.avgJourney },
  { weight: 1.0, get: (m) => (m.crimes12mo ? Math.log(m.crimes12mo) : null) },
  { weight: 1.0, get: (m) => m.noise55 },
  { weight: 0.8, get: (m) => m.within300m },
  { weight: 0.8, get: (m) => m.gardenShare },
  { weight: 0.8, get: (m) => m.degree },
  { weight: 0.8, get: (m) => m.privateRented },
  { weight: 0.3, get: (m) => m.gigabit },
];

export interface SimilarDistrict {
  district: CompareDistrict;
  /** Short phrases on how it differs from the district we started from, biggest differences first. */
  differences: string[];
}

interface Stats {
  mean: number;
  sd: number;
}

let cachedStats: Stats[] | undefined;

function featureStats(districts: CompareDistrict[]): Stats[] {
  if (cachedStats) return cachedStats;
  cachedStats = FEATURES.map((f) => {
    const values = districts.map((d) => f.get(d.m)).filter((v): v is number => v !== null);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return { mean, sd };
  });
  return cachedStats;
}

/** Standardised feature vector; a missing figure counts as "average" so it neither helps nor hurts. Returns how many real values there were. */
function vector(m: CompareMetrics, stats: Stats[]): { z: number[]; known: number } {
  let known = 0;
  const z = FEATURES.map((f, i) => {
    const v = f.get(m);
    if (v === null) return 0;
    known++;
    return (v - stats[i].mean) / stats[i].sd;
  });
  return { z, known };
}

const nearest5 = (n: number) => Math.round(n / 5) * 5;

function describeDifferences(from: CompareMetrics, to: CompareMetrics): string[] {
  const found: { size: number; text: string }[] = [];
  if (from.medianPrice && to.medianPrice) {
    const pct = (to.medianPrice / from.medianPrice - 1) * 100;
    if (Math.abs(pct) >= 8) found.push({ size: Math.abs(pct) / 25, text: `${nearest5(Math.abs(pct))}% ${pct > 0 ? "dearer" : "cheaper"} to buy` });
  }
  if (from.avgJourney !== null && to.avgJourney !== null) {
    const diff = to.avgJourney - from.avgJourney;
    if (Math.abs(diff) >= 5) found.push({ size: Math.abs(diff) / 20, text: `${Math.abs(diff)} min ${diff > 0 ? "further from" : "closer to"} central London` });
  }
  if (from.crimes12mo && to.crimes12mo) {
    const ratio = to.crimes12mo / from.crimes12mo;
    if (ratio >= 1.25 || ratio <= 0.8) found.push({ size: Math.abs(ratio - 1) / 0.6, text: ratio > 1 ? "more recorded crime" : "less recorded crime" });
  }
  if (from.noise55 !== null && to.noise55 !== null) {
    const diff = to.noise55 - from.noise55;
    if (Math.abs(diff) >= 10) found.push({ size: Math.abs(diff) / 30, text: diff > 0 ? "noisier roads" : "quieter roads" });
  }
  if (from.within300m !== null && to.within300m !== null) {
    const diff = to.within300m - from.within300m;
    if (Math.abs(diff) >= 12) found.push({ size: Math.abs(diff) / 35, text: diff > 0 ? "more parks close by" : "fewer parks close by" });
  }
  if (from.privateRented !== null && to.privateRented !== null) {
    const diff = to.privateRented - from.privateRented;
    if (Math.abs(diff) >= 10) found.push({ size: Math.abs(diff) / 30, text: diff > 0 ? "more renters" : "more owner-occupiers" });
  }
  return found.sort((a, b) => b.size - a.size).slice(0, 3).map((f) => f.text);
}

/** The `count` districts closest to `code` on the measures above, excluding districts with too little data to judge. */
export function getSimilarDistricts(code: string, count = 4): SimilarDistrict[] {
  const districts = buildCompareData().districts;
  const start = districts.find((d) => d.code === code);
  if (!start) return [];
  const stats = featureStats(districts);
  const origin = vector(start.m, stats);
  if (origin.known < 6) return [];
  return districts
    .filter((d) => d.code !== code)
    .map((d) => ({ d, v: vector(d.m, stats) }))
    .filter(({ v }) => v.known >= 6)
    .map(({ d, v }) => ({ d, distance: Math.sqrt(FEATURES.reduce((sum, f, i) => sum + f.weight * (v.z[i] - origin.z[i]) ** 2, 0)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(({ d }) => ({ district: d, differences: describeDifferences(start.m, d.m) }));
}
