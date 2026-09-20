import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText, logStep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { AreaRents, RentsFile } from "../../src/lib/types.js";

const STEP = "rents";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/reference/rents-current.json");
const DATASET_PAGE = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";
const HISTORY_MONTHS = 36;
const LONDON_CODE = "E12000007";

// ONS Price Index of Private Rents, monthly. Column letters in "Table 1": A time, B area code, C area name, then for each
// category four columns (index, monthly change, annual change, rental price) - see the sheet's header row.
const CATEGORIES = {
  all: { annual: "G", price: "H" },
  oneBed: { annual: "K", price: "L" },
  twoBed: { annual: "O", price: "P" },
  threeBed: { annual: "S", price: "T" },
  fourPlusBed: { annual: "W", price: "X" },
} as const;

/** The dataset page links each monthly release under a dated URL ("/current/" 404s), newest first. */
async function latestWorkbookUrl(): Promise<string> {
  const html = await fetchText(DATASET_PAGE);
  const link = html.match(/href="(\/file\?uri=[^"]*priceindexofprivaterentsukmonthlypricestatistics[^"]*\.xlsx)"/);
  if (!link) throw new Error("No PIPR workbook link found on the ONS dataset page");
  return `https://www.ons.gov.uk${link[1]}`;
}

async function ensureWorkbook(url: string): Promise<string> {
  const dest = path.join(RAW_DIR, `pipr-${url.split("/").slice(-2, -1)[0]}.xlsx`);
  if (existsSync(dest)) return dest;
  logStep(STEP, `Downloading ${url} (~19MB)...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const unzip = (zip: string, entry: string) => execFileSync("unzip", ["-p", zip, entry], { maxBuffer: 1024 * 1024 * 400 }).toString("utf-8");

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Just enough of an .xlsx reader for this one sheet: streams the rows we want out of the raw sheet XML. */
function readRows(zip: string, wanted: (row: Record<string, string | number>) => boolean): Record<string, string | number>[] {
  const shared = [...unzip(zip, "xl/sharedStrings.xml").matchAll(/<si>(.*?)<\/si>/gs)].map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  // "Table 1" is the fourth sheet in this workbook (cover, contents, notes, table).
  const sheet = unzip(zip, "xl/worksheets/sheet4.xml");
  const rows: Record<string, string | number>[] = [];
  for (const rowMatch of sheet.matchAll(/<row [^>]*>(.*?)<\/row>/gs)) {
    const cells: Record<string, string | number> = {};
    for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>([^<]*)<\/v>)?<\/c>)/g)) {
      const [, col, attrs, value] = c;
      if (value === undefined) continue;
      cells[col] = /t="s"/.test(attrs) ? shared[Number(value)] : /t="str"/.test(attrs) ? decodeXml(value) : Number(value);
    }
    if (wanted(cells)) rows.push(cells);
  }
  return rows;
}

/** Excel serial date (days since 1899-12-30) -> "YYYY-MM". */
function serialToMonth(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 7);
}

const numOrNull = (v: string | number | undefined) => (typeof v === "number" ? v : null);

function buildArea(rows: Record<string, string | number>[]): AreaRents {
  const sorted = [...rows].sort((a, b) => Number(a.A) - Number(b.A));
  const latest = sorted[sorted.length - 1];
  const byBedrooms = Object.fromEntries(
    Object.entries(CATEGORIES).map(([key, cols]) => [key, { price: numOrNull(latest[cols.price]), annualChange: numOrNull(latest[cols.annual]) }])
  ) as AreaRents["byBedrooms"];
  const recent = sorted.slice(-HISTORY_MONTHS).filter((r) => typeof r.H === "number");
  return { byBedrooms, history: { months: recent.map((r) => serialToMonth(Number(r.A))), price: recent.map((r) => Number(r.H)) } };
}

async function main() {
  const url = await latestWorkbookUrl();
  const zip = await ensureWorkbook(url);
  const hierarchy = await loadHierarchy();
  const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);
  const names = new Map(boroughs.map((b) => [b.name, b.slug]));

  const rows = readRows(zip, (r) => typeof r.A === "number" && (r.B === LONDON_CODE || names.has(String(r.C)) && String(r.B).startsWith("E09")));
  const byArea = new Map<string, Record<string, string | number>[]>();
  for (const r of rows) {
    const key = r.B === LONDON_CODE ? "london" : names.get(String(r.C))!;
    (byArea.get(key) ?? byArea.set(key, []).get(key)!).push(r);
  }

  const london = byArea.get("london");
  if (!london) throw new Error("No London rows in the PIPR workbook");
  const boroughData: RentsFile["boroughs"] = {};
  for (const b of boroughs) {
    const areaRows = byArea.get(b.slug);
    if (areaRows) boroughData[b.slug] = buildArea(areaRows);
    else logStep(STEP, `${b.name}: no PIPR rows`);
  }
  const londonArea = buildArea(london);
  const data: RentsFile = {
    source: "ONS, Price Index of Private Rents (monthly price statistics)",
    latestMonth: londonArea.history.months[londonArea.history.months.length - 1],
    london: londonArea,
    boroughs: boroughData,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote ${Object.keys(boroughData).length} boroughs + London, latest ${data.latestMonth}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
