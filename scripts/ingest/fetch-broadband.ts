import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy, loadOutcodeIndex } from "./lib/geo.js";
import type { BroadbandFile, BroadbandMetrics } from "../../src/lib/types.js";

const STEP = "broadband";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/broadband.json");

// Ofcom Connected Nations 2025 (data as at July 2025). Ofcom publishes a new
// release each year under a new folder/filename, so bump these when refreshing.
const PERIOD = "July 2025";
const ZIP_URL =
  "https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/infrastructure-research/connected-nations-2025/202507_fixed_broadband_coverage_r01.zip";
const ZIP_PATH = path.join(RAW_DIR, "ofcom-fixed-coverage-2025.zip");

type Row = Record<string, string>;

const COL = {
  superfast: "SFBB availability (% premises)",
  ultrafast: "UFBB availability (% premises)",
  fullFibre: "Full Fibre availability (% premises)",
  gigabit: "Gigabit availability (% premises)",
  below30: "% of premises unable to receive 30Mbit/s",
  belowUso: "% of premises below the USO",
  b0_2: "% of premises with 0<2Mbit/s download speed",
  b2_5: "% of premises with 2<5Mbit/s download speed",
  b5_10: "% of premises with 5<10Mbit/s download speed",
  b10_30: "% of premises with 10<30Mbit/s download speed",
  b30_300: "% of premises with 30<300Mbit/s download speed",
  b300: "% of premises with >=300Mbit/s download speed",
};

const num = (row: Row, col: string): number => Number(row[col]) || 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

function metricsFrom(row: Row, fullFibre: number | null): BroadbandMetrics {
  return {
    superfast: round1(num(row, COL.superfast)),
    ultrafast: round1(num(row, COL.ultrafast)),
    fullFibre,
    gigabit: round1(num(row, COL.gigabit)),
    below30: round1(num(row, COL.below30)),
    belowUso: round1(num(row, COL.belowUso)),
    bands: {
      under10: round1(num(row, COL.b0_2) + num(row, COL.b2_5) + num(row, COL.b5_10)),
      from10to30: round1(num(row, COL.b10_30)),
      from30to300: round1(num(row, COL.b30_300)),
      over300: round1(num(row, COL.b300)),
    },
  };
}

/** Postcode files give % of premises per postcode but no premises counts, so an outcode is the plain mean across its postcodes. */
function meanMetrics(rows: Row[]): BroadbandMetrics {
  const avg = (col: string) => rows.reduce((s, r) => s + num(r, col), 0) / rows.length;
  const synthetic: Row = {};
  for (const col of Object.values(COL)) synthetic[col] = String(avg(col));
  return metricsFrom(synthetic, null);
}

async function ensureZip() {
  if (existsSync(ZIP_PATH)) {
    logStep(STEP, `Using cached ${ZIP_PATH}`);
    return;
  }
  logStep(STEP, `Downloading ${ZIP_URL} (~35MB)...`);
  const res = await fetch(ZIP_URL, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GET ${ZIP_URL} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(ZIP_PATH, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  await ensureZip();
  const tmp = path.join(os.tmpdir(), `ofcom-broadband-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  try {
    execFileSync("unzip", ["-oq", ZIP_PATH, "-d", tmp]);
    const root = path.join(tmp, "202507_fixed_coverage_r01");
    execFileSync("unzip", ["-oq", path.join(root, "202507_fixed_pc_coverage_r01.zip"), "-d", tmp]);
    const pcDir = path.join(tmp, "202507_fixed_pc_coverage_r01", "postcode_res_files");

    const hierarchy = await loadHierarchy();
    const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);

    // Borough + London: local-authority file carries premises counts, so London is premises-weighted.
    const laRows = parse(await readFile(path.join(root, "202507_fixed_laua_res_coverage_r01.csv"), "utf-8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[];
    const boroughMetrics: Record<string, BroadbandMetrics> = {};
    const londonRows: Row[] = [];
    for (const b of boroughs) {
      const row = laRows.find((r) => r.laua_name === b.name);
      if (!row) {
        logStep(STEP, `${b.name}: no local-authority row`);
        continue;
      }
      boroughMetrics[b.slug] = metricsFrom(row, round1(num(row, COL.fullFibre)));
      londonRows.push(row);
    }
    const totalPremises = londonRows.reduce((s, r) => s + num(r, "All Matched Premises"), 0);
    const weighted = (col: string) => londonRows.reduce((s, r) => s + num(r, col) * num(r, "All Matched Premises"), 0) / totalPremises;
    const londonRow: Row = {};
    for (const col of Object.values(COL)) londonRow[col] = String(weighted(col));
    const london = metricsFrom(londonRow, round1(weighted(COL.fullFibre)));

    // Outcodes: read only the postcode-area files our outcodes fall in.
    const outcodeIndex = await loadOutcodeIndex();
    const wanted = new Set(outcodeIndex.keys());
    const areas = new Set([...wanted].map((o) => o.match(/^[A-Z]+/)![0]));
    const byOutcode = new Map<string, Row[]>();
    for (const area of areas) {
      const file = path.join(pcDir, `202507_fixed_pc_coverage_res_r01_${area}.csv`);
      if (!existsSync(file)) continue;
      const rows = parse(await readFile(file, "utf-8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[];
      for (const r of rows) {
        const outcode = r.postcode_space?.split(" ")[0];
        if (!outcode || !wanted.has(outcode)) continue;
        const list = byOutcode.get(outcode) ?? [];
        list.push(r);
        byOutcode.set(outcode, list);
      }
    }
    const outcodes: Record<string, BroadbandMetrics & { postcodes: number }> = {};
    for (const [outcode, rows] of byOutcode) outcodes[outcode] = { ...meanMetrics(rows), postcodes: rows.length };

    const data: BroadbandFile = {
      source: "Ofcom, Connected Nations 2025 - fixed broadband coverage (residential premises)",
      period: PERIOD,
      london,
      boroughs: boroughMetrics,
      outcodes,
    };
    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify(data));
    logStep(STEP, `Wrote ${Object.keys(outcodes).length} outcodes, ${Object.keys(boroughMetrics).length} boroughs + London.`);
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
