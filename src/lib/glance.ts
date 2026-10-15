// "At a glance": a few plain sentences about a district or borough, written from its own numbers set against the rest of London.
import { buildCompareData, type CompareMetrics } from "./compare";

type Getter = (m: CompareMetrics) => number | null;

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

/** Where `value` sits among `all`: 0 = lowest, 1 = highest. */
function fraction(all: number[], value: number): number {
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return (below + equal / 2) / all.length;
}

interface Pool {
  values: (get: Getter) => number[];
}

function poolOf(metrics: CompareMetrics[]): Pool {
  return { values: (get) => metrics.map(get).filter((v): v is number => v !== null) };
}

/** The share a value has of the pool, or null if there is nothing to compare against. */
function rank(pool: Pool, get: Getter, m: CompareMetrics): number | null {
  const v = get(m);
  const all = pool.values(get);
  return v === null || all.length < 10 ? null : fraction(all, v);
}

const noise55: Getter = (m) => m.noise55;
const price: Getter = (m) => m.medianPrice;
const journey: Getter = (m) => m.avgJourney;
const crime: Getter = (m) => m.crimes12mo;
const green: Getter = (m) => (m.within300m !== null && m.gardenShare !== null ? (m.within300m + m.gardenShare) / 2 : null);
const gigabit: Getter = (m) => m.gigabit;

export interface Glance {
  /** One or two sentences: the short version, also used as the page description. */
  summary: string;
  /** Extra sentences for the visible card. */
  detail: string[];
}

function build(m: CompareMetrics, pool: Pool, scope: { place: string; peers: string; central: boolean }): Glance | null {
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  // Sentence 1: what the place is like. Only say what the numbers plainly show.
  const adjectives: string[] = [];
  const rNoise = rank(pool, noise55, m);
  const rGreen = rank(pool, green, m);
  if (rNoise !== null) {
    if (rNoise <= 0.25) adjectives.push("quieter");
    else if (rNoise >= 0.75) adjectives.push("noisier");
  }
  if (rGreen !== null) {
    if (rGreen >= 0.75) adjectives.push("greener");
    else if (rGreen <= 0.25) adjectives.push("more built-up");
  }
  const predicates: string[] = [];
  if (adjectives.length > 0) predicates.push(`${adjectives.join(" and ")} than most ${scope.peers}`);
  if (m.owned !== null && m.privateRented !== null) {
    if (m.owned >= 60) predicates.push("mostly owner-occupied");
    else if (m.privateRented >= 40) predicates.push("mostly private renters");
  }
  const family = m.under15 !== null && m.under15 >= 20 ? "lots of children" : m.over65 !== null && m.over65 >= 18 ? "an older-than-average population" : null;
  let first = "";
  if (predicates.length > 0) first = `${scope.place} is ${predicates.join(" and ")}${family ? `, with ${family}` : ""}.`;
  else if (family) first = `${scope.place} has ${family}.`;

  // Sentence 2: what it costs and how far it is.
  const cost: string[] = [];
  const rPrice = rank(pool, price, m);
  if (m.medianPrice !== null && rPrice !== null) {
    const rel =
      rPrice <= 0.2 ? `among the cheapest ${scope.peers} to buy in` : rPrice <= 0.4 ? `cheaper than most ${scope.peers}` : rPrice < 0.6 ? "about typical for London" : rPrice < 0.8 ? `dearer than most ${scope.peers}` : `among the dearest ${scope.peers} to buy in`;
    cost.push(`homes sell for a median of ${gbp.format(m.medianPrice)}, ${rel}`);
  }
  if (m.avgJourney !== null && !scope.central) {
    const rJourney = rank(pool, journey, m);
    const rel = rJourney === null ? "" : rJourney <= 0.33 ? ", closer than most" : rJourney >= 0.67 ? ", further than most" : "";
    cost.push(`journeys to central London average ${m.avgJourney} minutes${rel}`);
  }
  let second = "";
  if (cost.length > 0) second = first ? `${cap(cost.join("; "))}.` : `In ${scope.place}, ${cost.join("; ")}.`;

  // Sentence 3: safety and broadband.
  const other: string[] = [];
  const rCrime = rank(pool, crime, m);
  if (rCrime !== null) {
    if (rCrime <= 0.33) other.push(`police-recorded crime is lower than in most ${scope.peers}`);
    else if (rCrime >= 0.67) other.push(`police-recorded crime is higher than in most ${scope.peers}`);
  }
  const rGig = rank(pool, gigabit, m);
  if (m.gigabit !== null && m.gigabit >= 90 && rGig !== null) other.push(`gigabit broadband reaches ${Math.round(m.gigabit)}% of homes`);
  else if (m.gigabit !== null && m.gigabit < 50) other.push(`gigabit broadband reaches only ${Math.round(m.gigabit)}% of homes`);
  const third = other.length > 0 ? `${cap(other.join("; "))}.` : "";

  const sentences = [first, second, third].filter(Boolean);
  if (sentences.length === 0) return null;
  return { summary: sentences.slice(0, 2).join(" "), detail: sentences };
}

/** At a glance for a postcode district, measured against every other London district. */
export function districtGlance(code: string): Glance | null {
  const data = buildCompareData();
  const own = data.districts.find((d) => d.code === code);
  if (!own) return null;
  // Districts that mostly sit outside London would skew the comparison, so leave them out of the pool.
  const pool = poolOf(data.districts.filter((d) => d.sharePercent >= 50).map((d) => d.m));
  const central = own.m.avgJourney !== null && own.m.avgJourney <= 25;
  return build(own.m, pool, { place: `${own.code} ${own.name}`, peers: "London districts", central });
}

/** At a glance for a borough, measured against London's other boroughs. */
export function boroughGlance(slug: string): Glance | null {
  const data = buildCompareData();
  const own = data.boroughs.find((b) => b.slug === slug);
  if (!own) return null;
  const pool = poolOf(data.boroughs.map((b) => b.m));
  return build(own.m, pool, { place: own.name, peers: "London boroughs", central: false });
}

/** A search-snippet length description: whole sentences up to 155 characters, or the first sentence cut short if even that is too long. */
export function glanceDescription(glance: Glance, max = 155): string {
  let text = "";
  for (const sentence of glance.detail) {
    const next = text ? `${text} ${sentence}` : sentence;
    if (next.length > max) break;
    text = next;
  }
  if (text) return text;
  const first = glance.detail[0];
  return `${first.slice(0, max - 1).trimEnd()}…`;
}

export interface KeyFigure {
  label: string;
  value: string;
  /** One short comparison line, e.g. "36% below London median". */
  note: string | null;
  tone: "good" | "bad" | "neutral";
  /** 0-100, drawn as a thin progress bar when present. */
  bar?: number;
}

function median(values: number[]): number | null {
  if (values.length < 10) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "12% below" / "8% above" / "in line with" against a reference; null if either side is missing. */
function versus(value: number | null, reference: number | null): { text: string; below: boolean } | null {
  if (value === null || reference === null || reference === 0) return null;
  const pct = Math.round(((value - reference) / reference) * 100);
  if (Math.abs(pct) < 3) return { text: "in line with London median", below: false };
  return { text: `${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} London median`, below: pct < 0 };
}

/** Four headline figures for the top of a district page, each set against the median London district. */
export function districtKeyFigures(code: string): KeyFigure[] {
  const data = buildCompareData();
  const own = data.districts.find((d) => d.code === code);
  if (!own) return [];
  const peers = data.districts.filter((d) => d.sharePercent >= 50).map((d) => d.m);
  const med = (get: Getter) => median(peers.map(get).filter((v): v is number => v !== null));
  const figures: KeyFigure[] = [];

  if (own.m.medianPrice !== null) {
    const v = versus(own.m.medianPrice, med(price));
    figures.push({ label: "Median home price", value: gbp.format(own.m.medianPrice), note: v?.text ?? null, tone: "neutral" });
  }
  if (own.m.crimes12mo !== null) {
    const v = versus(own.m.crimes12mo, med(crime));
    figures.push({ label: "Crimes, last 12 months", value: Math.round(own.m.crimes12mo).toLocaleString("en-GB"), note: v?.text ?? null, tone: v ? (v.below ? "good" : "bad") : "neutral" });
  }
  if (own.m.avgJourney !== null) {
    const v = versus(own.m.avgJourney, med(journey));
    figures.push({ label: "To central London", value: `${own.m.avgJourney} min`, note: v?.text ?? null, tone: v ? (v.below ? "good" : "bad") : "neutral" });
  }
  if (own.m.gigabit !== null) {
    figures.push({ label: "Gigabit broadband", value: `${Math.round(own.m.gigabit)}%`, note: "of homes can get it", tone: own.m.gigabit >= 90 ? "good" : "neutral", bar: Math.round(own.m.gigabit) });
  }
  return figures;
}
