import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { MobileCoverageFile, MobileCoverageMetrics } from "../../src/lib/types.js";

const STEP = "mobile";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/mobile.json");

// Ofcom Connected Nations 2025 (data as at July 2025). Ofcom publishes a new
// release each year under a new folder/filename, so bump these when refreshing.
const PERIOD = "July 2025";
const ZIP_URL =
  "https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/infrastructure-research/connected-nations-2025/202507_mobile_coverage_r01.zip";
const ZIP_PATH = path.join(RAW_DIR, "ofcom-mobile-coverage-2025.zip");

type Row = Record<string, string>;

const num = (row: Row, col: string): number => Number(row[col]) || 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Ofcom's columns are "<tech>_prem_<out|in>_<n>": % of premises with coverage
// (outdoors / indoors) from exactly n of the four mobile networks.
const all4 = (row: Row, prefix: string) => num(row, `${prefix}_4`);
const atLeast1 = (row: Row, prefix: string) => 100 - num(row, `${prefix}_0`);

function metricsFrom(row: Row): MobileCoverageMetrics {
  return {
    fourGOutdoorAll: round1(all4(row, "4G_prem_out")),
    fourGOutdoorAny: round1(atLeast1(row, "4G_prem_out")),
    fourGIndoorAll: round1(all4(row, "4G_prem_in")),
    fourGIndoorAny: round1(atLeast1(row, "4G_prem_in")),
    fiveGOutdoorAll: round1(all4(row, "5G_high_confidence_prem_out")),
    fiveGOutdoorAny: round1(atLeast1(row, "5G_high_confidence_prem_out")),
    voiceIndoorAll: round1(all4(row, "Voice_prem_in")),
  };
}

const COLUMNS = [
  "4G_prem_out_0", "4G_prem_out_4", "4G_prem_in_0", "4G_prem_in_4",
  "5G_high_confidence_prem_out_0", "5G_high_confidence_prem_out_4", "Voice_prem_in_4",
];

async function ensureZip() {
  if (existsSync(ZIP_PATH)) {
    logStep(STEP, `Using cached ${ZIP_PATH}`);
    return;
  }
  logStep(STEP, `Downloading ${ZIP_URL} (~0.3MB)...`);
  const res = await fetch(ZIP_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`GET ${ZIP_URL} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(ZIP_PATH, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  await ensureZip();
  const tmp = path.join(os.tmpdir(), `ofcom-mobile-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  try {
    execFileSync("unzip", ["-oq", ZIP_PATH, "-d", tmp]);
    const file = path.join(tmp, "202507_mobile_coverage_r01", "202507_mobile_coverage_laua_r01.csv");
    const rows = parse(await readFile(file, "utf-8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[];

    const hierarchy = await loadHierarchy();
    const boroughs: Record<string, MobileCoverageMetrics> = {};
    const londonRows: Row[] = [];
    for (const b of hierarchy.cities.flatMap((c) => c.boroughs)) {
      const row = rows.find((r) => r.laua_name === b.name);
      if (!row) {
        logStep(STEP, `${b.name}: no local-authority row`);
        continue;
      }
      boroughs[b.slug] = metricsFrom(row);
      londonRows.push(row);
    }

    // Premises-weighted London figure.
    const totalPremises = londonRows.reduce((s, r) => s + num(r, "prem_count"), 0);
    const londonRow: Row = {};
    for (const col of COLUMNS) londonRow[col] = String(londonRows.reduce((s, r) => s + num(r, col) * num(r, "prem_count"), 0) / totalPremises);
    const data: MobileCoverageFile = {
      source: "Ofcom, Connected Nations 2025 - mobile coverage (premises)",
      period: PERIOD,
      london: metricsFrom(londonRow),
      boroughs,
    };
    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify(data));
    logStep(STEP, `Wrote ${Object.keys(boroughs).length} boroughs + London.`);
  } finally {
    // Ofcom's zips extract with read-only directories.
    execFileSync("chmod", ["-R", "u+w", tmp]);
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
