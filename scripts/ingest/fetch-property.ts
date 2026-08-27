import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep } from "./lib/fetch-utils.js";
import { postcodeToOutcode, loadOutcodeIndex } from "./lib/geo.js";
import type { PropertyData, PropertySale } from "../../src/lib/types.js";

const STEP = "property";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const LR_BASE = "https://price-paid-data.publicdata.landregistry.gov.uk";

// Price Paid Data ships as one national CSV per year with no header row.
// Column order (0-indexed) per https://www.gov.uk/guidance/about-the-price-paid-data:
// 0 transactionId, 1 price, 2 dateOfTransfer, 3 postcode, 4 propertyType, 5 newBuild,
// 6 duration, 7 paon, 8 saon, 9 street, 10 locality, 11 town, 12 district, 13 county,
// 14 ppdCategoryType, 15 recordStatus

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  D: "Detached",
  S: "Semi-detached",
  T: "Terraced",
  F: "Flat/Maisonette",
  O: "Other",
};

async function fetchYearSales(year: number, outcodeIndex: Map<string, unknown>): Promise<PropertySale[]> {
  const url = `${LR_BASE}/pp-${year}.csv`;
  logStep(STEP, `Downloading ${url} (whole-year national file, filtering client-side)...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const csvText = await res.text();
  const rows: string[][] = parse(csvText, { columns: false });

  const sales: PropertySale[] = [];
  for (const row of rows) {
    const postcode = row[3];
    if (!postcode) continue;
    const outcode = postcodeToOutcode(postcode);
    if (!outcode || !outcodeIndex.has(outcode)) continue;
    sales.push({
      address: [row[7], row[8], row[9], row[10]].filter(Boolean).join(", "),
      postcode,
      price: Number(row[1]),
      dateOfTransfer: row[2].split(" ")[0],
      propertyType: PROPERTY_TYPE_LABELS[row[4]] ?? "Other",
      newBuild: row[5] === "Y",
    });
  }
  logStep(STEP, `${year}: matched ${sales.length} sales in our outcodes.`);
  return sales;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear()];

  // Group by outcode in a single pass rather than re-filtering the full
  // (potentially 100k+ row) sales list once per outcode.
  const salesByOutcode = new Map<string, PropertySale[]>();
  for (const year of years) {
    for (const sale of await fetchYearSales(year, outcodeIndex)) {
      const outcode = postcodeToOutcode(sale.postcode);
      if (!outcode) continue;
      const list = salesByOutcode.get(outcode);
      if (list) list.push(sale);
      else salesByOutcode.set(outcode, [sale]);
    }
  }

  const byOutcode: Record<string, PropertyData> = {};
  for (const outcode of outcodeIndex.keys()) {
    const sales = (salesByOutcode.get(outcode) ?? []).sort((a, b) => b.dateOfTransfer.localeCompare(a.dateOfTransfer));
    const prices = sales.map((s) => s.price);
    byOutcode[outcode] = {
      sales,
      averagePrice: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
      medianPrice: median(prices),
    };
    logStep(STEP, `${outcode}: ${sales.length} sales, median £${byOutcode[outcode].medianPrice ?? "n/a"}`);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "property-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byOutcode, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
