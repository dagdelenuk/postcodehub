import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import { ensureNsplZip, listZipEntries, readLadNameLookup, readNsplArea } from "./lib/nspl.js";
import type { DemographicsFile, DemographicsMetrics } from "../../src/lib/types.js";

const STEP = "demographics";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/demographics.json");
const NSPL_ZIP_PATH = path.join(RAW_DIR, "nspl.zip");
const IMD_LSOA_COUNT = 32844; // English IMD 2019 ranks LSOAs 1..32,844

// ONS Census 2021 bulk tables from Nomis. Each zip holds the table at every
// geography (oa, lsoa, ltla...) - we read output areas (for postcode districts)
// and local authorities (for boroughs).
const TABLES = { age: "ts007a", ethnicity: "ts021", tenure: "ts054", qualifications: "ts067", health: "ts037", economic: "ts066" } as const;
type TableKey = keyof typeof TABLES;

interface CensusTable {
  headers: string[];
  rows: Map<string, number[]>;
}

async function ensureCensusZip(table: string): Promise<string> {
  const dest = path.join(RAW_DIR, `census2021-${table}.zip`);
  if (existsSync(dest)) return dest;
  const url = `https://www.nomisweb.co.uk/output/census/2021/census2021-${table}.zip`;
  logStep(STEP, `Downloading ${url}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  const { writeFile: write } = await import("node:fs/promises");
  await write(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function readCensus(zip: string, table: string, level: "oa" | "ltla"): CensusTable {
  const text = execFileSync("unzip", ["-p", zip, `census2021-${table}-${level}.csv`], { maxBuffer: 1024 * 1024 * 400 }).toString("utf-8");
  const records: string[][] = parse(text, { columns: false, skip_empty_lines: true, bom: true });
  const headers = records[0].slice(3).map((h) => h.replace(/\s+/g, " ").trim());
  const rows = new Map<string, number[]>();
  for (const rec of records.slice(1)) rows.set(rec[2], rec.slice(3).map(Number));
  return { headers, rows };
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

/** Sums a list of census table rows column by column. */
function addRows(rows: number[][]): number[] {
  const out = new Array(rows[0]?.length ?? 0).fill(0);
  for (const r of rows) r.forEach((v, i) => (out[i] += v));
  return out;
}

function metricsFrom(counts: Record<TableKey, number[]>, headers: Record<TableKey, string[]>): DemographicsMetrics {
  const col = (t: TableKey, matcher: (h: string) => boolean) => {
    const i = headers[t].findIndex(matcher);
    if (i < 0) throw new Error(`Census column not found in ${t}`);
    return counts[t][i];
  };
  // Age bands sit in 5-year steps after the "Total" column; index 1 = "4 and under".
  const ageTotal = counts.age[0];
  const age = counts.age;
  const ethTotal = counts.ethnicity[0];
  const ethBroad = (group: string) => col("ethnicity", (h) => new RegExp(`^Ethnic group: ${group}[^:]*$`).test(h));
  const tenTotal = counts.tenure[0];
  const tenGroup = (name: string) => col("tenure", (h) => h === `Tenure of household: ${name}`);
  const qualTotal = counts.qualifications[0];
  const healthTotal = counts.health[0];
  const econTotal = counts.economic[0];
  const econ = (name: string) => col("economic", (h) => h === `Economic activity status: ${name}`);
  const EA = "Economically active (excluding full-time students)";
  const EAS = "Economically active and a full-time student";
  const EI = "Economically inactive";
  const healthCol = (name: string) => col("health", (h) => h === `General health: ${name}`);

  return {
    population: ageTotal,
    age: {
      under15: pct(sum(age.slice(1, 4)), ageTotal),
      age15to24: pct(sum(age.slice(4, 6)), ageTotal),
      age25to44: pct(sum(age.slice(6, 10)), ageTotal),
      age45to64: pct(sum(age.slice(10, 14)), ageTotal),
      age65plus: pct(sum(age.slice(14)), ageTotal),
    },
    ethnicity: {
      white: pct(ethBroad("White"), ethTotal),
      asian: pct(ethBroad("Asian"), ethTotal),
      black: pct(ethBroad("Black"), ethTotal),
      mixed: pct(ethBroad("Mixed"), ethTotal),
      other: pct(ethBroad("Other"), ethTotal),
    },
    tenure: {
      owned: pct(tenGroup("Owned") + tenGroup("Shared ownership"), tenTotal),
      socialRented: pct(tenGroup("Social rented"), tenTotal),
      privateRented: pct(tenGroup("Private rented") + tenGroup("Lives rent free"), tenTotal),
    },
    qualifications: {
      degreeLevel: pct(col("qualifications", (h) => h.endsWith("Level 4 qualifications and above")), qualTotal),
      none: pct(col("qualifications", (h) => h.endsWith("No qualifications")), qualTotal),
    },
    economic: {
      employed: pct(econ(`${EA}:In employment`) + econ(`${EAS}:In employment`), econTotal),
      unemployed: pct(econ(`${EA}: Unemployed`) + econ(`${EAS}: Unemployed`), econTotal),
      retired: pct(econ(`${EI}: Retired`), econTotal),
      student: pct(econ(EAS) + econ(`${EI}: Student`), econTotal),
      longTermSick: pct(econ(`${EI}: Long-term sick or disabled`), econTotal),
      other: pct(econ(`${EI}: Looking after home or family`) + econ(`${EI}: Other`), econTotal),
    },
    health: {
      goodOrBetter: pct(healthCol("Very good health") + healthCol("Good health"), healthTotal),
      bad: pct(healthCol("Bad health") + healthCol("Very bad health"), healthTotal),
    },
  };
}

function decileShares(ranks: number[]): number[] {
  const counts = new Array(10).fill(0);
  for (const r of ranks) counts[Math.min(9, Math.floor(((r - 1) / IMD_LSOA_COUNT) * 10))]++;
  return counts.map((c) => pct(c, ranks.length));
}

async function main() {
  const hierarchy = await loadHierarchy();
  const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);
  const ourOutcodes = new Set(boroughs.flatMap((b) => b.outcodes.map((o) => o.outcode)));
  const areaPrefixes = new Set([...ourOutcodes].map((o) => o.match(/^[A-Z]+/)![0]));

  await ensureNsplZip(NSPL_ZIP_PATH);
  const entries = listZipEntries(NSPL_ZIP_PATH);
  const ladNames = readLadNameLookup(NSPL_ZIP_PATH, entries);
  const boroughByLad = new Map<string, string>(); // LAD code -> borough slug
  for (const [code, name] of ladNames) {
    const b = boroughs.find((x) => x.name === name);
    if (b) boroughByLad.set(code, b.slug);
  }
  const ladByBorough = new Map([...boroughByLad].map(([code, slug]) => [slug, code]));

  // Postcodes -> outcode/borough/output area, from NSPL. Terminated and large-user postcodes are skipped.
  const oaOutcodeCounts = new Map<string, Map<string, number>>();
  const ranksByOutcode = new Map<string, number[]>();
  const ranksByBorough = new Map<string, number[]>();
  const londonRanks: number[] = [];
  for (const prefix of areaPrefixes) {
    for (const row of readNsplArea(NSPL_ZIP_PATH, entries, prefix)) {
      if (row.terminated || row.largeUser) continue;
      const inOurOutcode = ourOutcodes.has(row.outcode);
      if (inOurOutcode && row.oaCode) {
        const perOa = oaOutcodeCounts.get(row.oaCode) ?? new Map<string, number>();
        perOa.set(row.outcode, (perOa.get(row.outcode) ?? 0) + 1);
        oaOutcodeCounts.set(row.oaCode, perOa);
      }
      if (row.imdRank == null) continue;
      if (inOurOutcode) (ranksByOutcode.get(row.outcode) ?? ranksByOutcode.set(row.outcode, []).get(row.outcode)!).push(row.imdRank);
      const boroughSlug = boroughByLad.get(row.ladCode);
      if (boroughSlug) {
        (ranksByBorough.get(boroughSlug) ?? ranksByBorough.set(boroughSlug, []).get(boroughSlug)!).push(row.imdRank);
        londonRanks.push(row.imdRank);
      }
    }
  }
  // Each output area is small enough to belong to one district: give it to the outcode holding most of its postcodes.
  const oaToOutcode = new Map<string, string>();
  for (const [oa, perOutcode] of oaOutcodeCounts) oaToOutcode.set(oa, [...perOutcode.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  logStep(STEP, `Mapped ${oaToOutcode.size} output areas to ${ourOutcodes.size} outcodes.`);

  const oa = {} as Record<TableKey, CensusTable>;
  const ltla = {} as Record<TableKey, CensusTable>;
  for (const key of Object.keys(TABLES) as TableKey[]) {
    const zip = await ensureCensusZip(TABLES[key]);
    oa[key] = readCensus(zip, TABLES[key], "oa");
    ltla[key] = readCensus(zip, TABLES[key], "ltla");
  }
  const headers = Object.fromEntries((Object.keys(TABLES) as TableKey[]).map((k) => [k, ltla[k].headers])) as Record<TableKey, string[]>;

  // Postcode districts: sum the census counts of the output areas assigned to each.
  const oasByOutcode = new Map<string, string[]>();
  for (const [oaCode, outcode] of oaToOutcode) (oasByOutcode.get(outcode) ?? oasByOutcode.set(outcode, []).get(outcode)!).push(oaCode);
  const outcodes: DemographicsFile["outcodes"] = {};
  for (const outcode of ourOutcodes) {
    const oaCodes = oasByOutcode.get(outcode) ?? [];
    const counts = {} as Record<TableKey, number[]>;
    for (const key of Object.keys(TABLES) as TableKey[]) {
      const rows = oaCodes.map((c) => oa[key].rows.get(c)).filter((r): r is number[] => Boolean(r));
      if (rows.length === 0) break;
      counts[key] = addRows(rows);
    }
    if (Object.keys(counts).length < Object.keys(TABLES).length) continue;
    outcodes[outcode] = { ...metricsFrom(counts, headers), imdDeciles: decileShares(ranksByOutcode.get(outcode) ?? [1]) };
  }

  // Boroughs: read straight from the local-authority tables; London is their sum.
  const boroughData: DemographicsFile["boroughs"] = {};
  const londonCounts = {} as Record<TableKey, number[][]>;
  for (const b of boroughs) {
    const code = ladByBorough.get(b.slug);
    if (!code) continue;
    const counts = {} as Record<TableKey, number[]>;
    for (const key of Object.keys(TABLES) as TableKey[]) {
      const row = ltla[key].rows.get(code);
      if (!row) throw new Error(`No ${key} row for ${b.name} (${code})`);
      counts[key] = row;
      (londonCounts[key] ??= []).push(row);
    }
    boroughData[b.slug] = { ...metricsFrom(counts, headers), imdDeciles: decileShares(ranksByBorough.get(b.slug) ?? [1]) };
  }
  const london = {
    ...metricsFrom(Object.fromEntries((Object.keys(TABLES) as TableKey[]).map((k) => [k, addRows(londonCounts[k])])) as Record<TableKey, number[]>, headers),
    imdDeciles: decileShares(londonRanks),
  };

  const data: DemographicsFile = {
    source: "ONS Census 2021 (via Nomis) and English Indices of Deprivation 2019 (via ONS Postcode Lookup)",
    london,
    boroughs: boroughData,
    outcodes,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote ${Object.keys(outcodes).length} outcodes, ${Object.keys(boroughData).length} boroughs + London.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
