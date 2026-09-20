import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep } from "./lib/fetch-utils.js";
import { loadHierarchy, loadOutcodeIndex } from "./lib/geo.js";
import { findLatestOfcomRelease, type OfcomRelease } from "./lib/ofcom.js";
import type { BroadbandFile, BroadbandMetrics } from "../../src/lib/types.js";

const STEP = "broadband";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/broadband.json");

// Ofcom Connected Nations fixed broadband coverage. The release is discovered on Ofcom's data downloads pages (see lib/ofcom.ts);
// this is the fallback when discovery finds nothing, which is also the release the committed data came from.
const FALLBACK_RELEASE: OfcomRelease = {
  url: "https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/infrastructure-research/connected-nations-2025/202507_fixed_broadband_coverage_r01.zip",
  tag: "202507",
  rev: "r01",
  period: "July 2025",
  reportYear: 2025,
};

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

async function ensureZip(release: OfcomRelease): Promise<string> {
  const dest = path.join(RAW_DIR, `ofcom-fixed-coverage-${release.tag}-${release.rev}.zip`);
  if (existsSync(dest)) {
    logStep(STEP, `Using cached ${dest}`);
    return dest;
  }
  logStep(STEP, `Downloading ${release.url} (~35MB)...`);
  const res = await fetch(release.url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GET ${release.url} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function main() {
  const release = (await findLatestOfcomRelease("fixed_broadband_coverage")) ?? FALLBACK_RELEASE;
  logStep(STEP, `Using the ${release.period} release (${release.tag}_${release.rev}).`);
  // Scheduled refreshes run this yearly-ish; skip the big download when the committed data is already this release.
  if (!process.env.FORCE && existsSync(OUT_FILE)) {
    const current = JSON.parse(await readFile(OUT_FILE, "utf-8")) as { period?: string };
    if (current.period === release.period) {
      logStep(STEP, `Already up to date (${release.period}); set FORCE=1 to rebuild anyway.`);
      return;
    }
  }
  const zipPath = await ensureZip(release);
  const { tag, rev } = release;
  const tmp = path.join(os.tmpdir(), `ofcom-broadband-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  try {
    execFileSync("unzip", ["-oq", zipPath, "-d", tmp]);
    const root = path.join(tmp, `${tag}_fixed_coverage_${rev}`);
    execFileSync("unzip", ["-oq", path.join(root, `${tag}_fixed_pc_coverage_${rev}.zip`), "-d", tmp]);
    const pcDir = path.join(tmp, `${tag}_fixed_pc_coverage_${rev}`, "postcode_res_files");

    const hierarchy = await loadHierarchy();
    const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);

    // Borough + London: local-authority file carries premises counts, so London is premises-weighted.
    const laRows = parse(await readFile(path.join(root, `${tag}_fixed_laua_res_coverage_${rev}.csv`), "utf-8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[];
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
      const file = path.join(pcDir, `${tag}_fixed_pc_coverage_res_${rev}_${area}.csv`);
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
      source: `Ofcom, Connected Nations ${release.reportYear} - fixed broadband coverage (residential premises)`,
      period: release.period,
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
