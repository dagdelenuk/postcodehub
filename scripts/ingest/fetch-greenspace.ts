import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import { ensureNsplZip, listZipEntries, readNsplArea } from "./lib/nspl.js";
import { readSheet } from "./lib/xlsx.js";
import type { GreenspaceFile, GreenspaceMetrics } from "../../src/lib/types.js";

const STEP = "greenspace";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/greenspace.json");
const NSPL_ZIP_PATH = path.join(RAW_DIR, "nspl.zip");

// ONS "Access to gardens and public green space in Great Britain" (April 2020), built on Ordnance Survey Open Greenspace and
// OS AddressBase. A fixed release, so the workbooks are cached in data/raw and this only needs re-running if the ONS updates it.
const BASE = "https://www.ons.gov.uk/file?uri=/economy/environmentalaccounts/datasets/accesstogardensandpublicgreenspaceingreatbritain";
const FILES = {
  parks: { url: `${BASE}/accesstopublicparksandplayingfieldsgreatbritainapril2020/ospublicgreenspacereferencetables.xlsx`, file: "ons-public-greenspace-2020.xlsx" },
  gardens: { url: `${BASE}/accesstogardenspacegreatbritainapril2020/osprivateoutdoorspacereferencetables.xlsx`, file: "ons-private-outdoor-space-2020.xlsx" },
};

async function ensure(kind: keyof typeof FILES): Promise<string> {
  const dest = path.join(RAW_DIR, FILES[kind].file);
  if (existsSync(dest)) return dest;
  logStep(STEP, `Downloading ${FILES[kind].url}...`);
  const res = await fetch(FILES[kind].url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GET ${FILES[kind].url} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: string | number | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface LsoaParks {
  ladName: string;
  distance: number | null;
  parksWithin1km: number | null;
  postcodes: number;
  within300: number;
  within900: number;
}
interface MsoaGardens {
  addresses: number;
  withSpace: number;
  avgSize: number | null;
}

/** Weighted mean of (value, weight) pairs, ignoring pairs with a missing value. */
function weightedMean(pairs: { v: number | null; w: number }[]): number | null {
  const usable = pairs.filter((p): p is { v: number; w: number } => p.v !== null && p.w > 0);
  const totalWeight = usable.reduce((s, p) => s + p.w, 0);
  return totalWeight > 0 ? usable.reduce((s, p) => s + p.v * p.w, 0) / totalWeight : null;
}

async function main() {
  const parksZip = await ensure("parks");
  const gardensZip = await ensure("gardens");

  // LSOA-level public green space: columns 8 LSOA code, 5 LAD name, 12 distance to nearest park, 14 parks within 1 km, 16/17/18 postcodes and those within 300 m / 900 m.
  const lsoaParks = new Map<string, LsoaParks>();
  for (const r of readSheet(parksZip, "LSOA Parks and Playing Fields").slice(1)) {
    if (typeof r[8] !== "string" || !String(r[8]).startsWith("E01")) continue;
    lsoaParks.set(r[8] as string, {
      ladName: String(r[5]),
      distance: num(r[12]),
      parksWithin1km: num(r[14]),
      postcodes: num(r[16]) ?? 0,
      within300: num(r[17]) ?? 0,
      within900: num(r[18]) ?? 0,
    });
  }
  // MSOA-level private outdoor space (total column group: 21 addresses, 22 with space, 25 average size).
  const msoaGardens = new Map<string, MsoaGardens>();
  for (const r of readSheet(gardensZip, "MSOA gardens").slice(2)) {
    if (typeof r[6] !== "string" || !String(r[6]).startsWith("E02")) continue;
    msoaGardens.set(r[6] as string, { addresses: num(r[21]) ?? 0, withSpace: num(r[22]) ?? 0, avgSize: num(r[25]) });
  }
  // LAD-level gardens (borough) and the London region row.
  const ladGardens = new Map<string, MsoaGardens>();
  for (const r of readSheet(gardensZip, "LAD gardens").slice(2)) {
    if (typeof r[5] === "string") ladGardens.set(r[5], { addresses: num(r[19]) ?? 0, withSpace: num(r[20]) ?? 0, avgSize: num(r[23]) });
  }
  logStep(STEP, `Read ${lsoaParks.size} LSOAs, ${msoaGardens.size} MSOAs, ${ladGardens.size} local authorities.`);

  const hierarchy = await loadHierarchy();
  const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);
  const ourOutcodes = new Set(boroughs.flatMap((b) => b.outcodes.map((o) => o.outcode)));
  const areaPrefixes = new Set([...ourOutcodes].map((o) => o.match(/^[A-Z]+/)![0]));

  // Postcodes per (district, LSOA) and (district, MSOA) from the ONS Postcode Lookup, used as weights.
  await ensureNsplZip(NSPL_ZIP_PATH);
  const entries = listZipEntries(NSPL_ZIP_PATH);
  const lsoaWeights = new Map<string, Map<string, number>>();
  const msoaWeights = new Map<string, Map<string, number>>();
  const bump = (outer: Map<string, Map<string, number>>, key: string, code: string) => {
    if (!code) return;
    const inner = outer.get(key) ?? outer.set(key, new Map()).get(key)!;
    inner.set(code, (inner.get(code) ?? 0) + 1);
  };
  for (const prefix of areaPrefixes) {
    for (const row of readNsplArea(NSPL_ZIP_PATH, entries, prefix)) {
      if (row.terminated || row.largeUser || !ourOutcodes.has(row.outcode)) continue;
      bump(lsoaWeights, row.outcode, row.lsoaCode);
      bump(msoaWeights, row.outcode, row.msoaCode);
    }
  }

  function parksFor(lsoas: [string, number][]): Omit<GreenspaceMetrics, "gardenShare" | "gardenAvgSizeM2"> {
    const rows = lsoas.map(([code, w]) => ({ p: lsoaParks.get(code), w })).filter((x): x is { p: LsoaParks; w: number } => Boolean(x.p));
    return {
      parkDistanceM: nullRound(weightedMean(rows.map(({ p, w }) => ({ v: p.distance, w }))), 0),
      parksWithin1km: nullRound(weightedMean(rows.map(({ p, w }) => ({ v: p.parksWithin1km, w }))), 1),
      within300m: nullRound(weightedMean(rows.map(({ p, w }) => ({ v: p.postcodes > 0 ? (p.within300 / p.postcodes) * 100 : null, w }))), 1),
      within900m: nullRound(weightedMean(rows.map(({ p, w }) => ({ v: p.postcodes > 0 ? (p.within900 / p.postcodes) * 100 : null, w }))), 1),
    };
  }
  const nullRound = (n: number | null, dp: number) => (n === null ? null : dp === 0 ? Math.round(n) : round1(n));

  // Districts: postcode-weighted across the LSOAs (parks) and MSOAs (gardens) their postcodes fall in. The ONS data uses 2011
  // areas, so the few that were redrawn for 2021 simply drop out of the weighting.
  const outcodes: GreenspaceFile["outcodes"] = {};
  for (const code of ourOutcodes) {
    const lsoas = [...(lsoaWeights.get(code) ?? [])];
    const msoas = [...(msoaWeights.get(code) ?? [])].map(([m, w]) => ({ g: msoaGardens.get(m), w })).filter((x): x is { g: MsoaGardens; w: number } => Boolean(x.g));
    const parks = parksFor(lsoas);
    if (parks.parkDistanceM === null && msoas.length === 0) continue;
    outcodes[code] = {
      ...parks,
      gardenShare: nullRound(weightedMean(msoas.map(({ g, w }) => ({ v: g.addresses > 0 ? (g.withSpace / g.addresses) * 100 : null, w }))), 1),
      gardenAvgSizeM2: nullRound(weightedMean(msoas.map(({ g, w }) => ({ v: g.avgSize, w }))), 0),
    };
  }

  // Boroughs: every LSOA in the borough, weighted by its built-up postcodes; gardens straight from the LAD table.
  const boroughData: GreenspaceFile["boroughs"] = {};
  const londonLsoas: [string, number][] = [];
  let londonAddresses = 0;
  let londonWithSpace = 0;
  for (const b of boroughs) {
    const lsoas: [string, number][] = [...lsoaParks].filter(([, p]) => p.ladName === b.name).map(([code, p]) => [code, p.postcodes]);
    londonLsoas.push(...lsoas);
    const g = ladGardens.get(b.name);
    if (g) {
      londonAddresses += g.addresses;
      londonWithSpace += g.withSpace;
    }
    if (lsoas.length === 0) continue;
    boroughData[b.slug] = { ...parksFor(lsoas), gardenShare: g && g.addresses > 0 ? round1((g.withSpace / g.addresses) * 100) : null, gardenAvgSizeM2: g?.avgSize != null ? Math.round(g.avgSize) : null };
  }
  // London's average garden size is address-weighted across boroughs.
  const londonAvgSize = weightedMean(boroughs.map((b) => ({ v: ladGardens.get(b.name)?.avgSize ?? null, w: ladGardens.get(b.name)?.addresses ?? 0 })));
  const london: GreenspaceMetrics = {
    ...parksFor(londonLsoas),
    gardenShare: londonAddresses > 0 ? round1((londonWithSpace / londonAddresses) * 100) : null,
    gardenAvgSizeM2: londonAvgSize === null ? null : Math.round(londonAvgSize),
  };

  const data: GreenspaceFile = {
    source: "ONS, Access to gardens and public green space in Great Britain (April 2020), from Ordnance Survey Open Greenspace",
    year: 2020,
    london,
    boroughs: boroughData,
    outcodes,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote ${Object.keys(outcodes).length} districts, ${Object.keys(boroughData).length} boroughs + London.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
