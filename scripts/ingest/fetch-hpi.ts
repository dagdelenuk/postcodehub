import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { HpiSeries, HpiData } from "../../src/lib/types.js";

const STEP = "hpi";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/reference/house-price-index.json");
const MONTHS = 36;

interface HpiItem {
  refMonth: string;
  averagePrice?: number;
  percentageAnnualChange?: number;
  averagePriceFlatMaisonette?: number;
  averagePriceTerraced?: number;
  averagePriceSemiDetached?: number;
  averagePriceDetached?: number;
}

// HM Land Registry's UK HPI linked-data API, one region per request (newest first).
// Land Registry region slugs that differ from ours.
const REGION_SLUG_ALIASES: Record<string, string> = { westminster: "city-of-westminster" };

async function fetchRegion(regionSlug: string): Promise<HpiSeries | null> {
  const url = `https://landregistry.data.gov.uk/data/ukhpi/region/${regionSlug}.json?_pageSize=${MONTHS}&_sort=-refMonth&_view=all`;
  const res = await withRetry(() => fetchJson<{ result: { items: HpiItem[] } }>(url, { signal: AbortSignal.timeout(60000) }));
  const items = res.result.items.filter((i) => i.averagePrice != null).reverse();
  if (items.length === 0) return null;
  const latest = items[items.length - 1];
  return {
    months: items.map((i) => i.refMonth),
    averagePrice: items.map((i) => Math.round(i.averagePrice!)),
    annualChange: latest.percentageAnnualChange ?? null,
    byType: {
      flat: latest.averagePriceFlatMaisonette ? Math.round(latest.averagePriceFlatMaisonette) : null,
      terraced: latest.averagePriceTerraced ? Math.round(latest.averagePriceTerraced) : null,
      semiDetached: latest.averagePriceSemiDetached ? Math.round(latest.averagePriceSemiDetached) : null,
      detached: latest.averagePriceDetached ? Math.round(latest.averagePriceDetached) : null,
    },
  };
}

async function main() {
  const hierarchy = await loadHierarchy();
  const boroughSlugs = hierarchy.cities.flatMap((c) => c.boroughs.map((b) => b.slug));

  const london = await fetchRegion("london");
  if (!london) throw new Error("No HPI data for London");
  const boroughs: Record<string, HpiSeries> = {};
  for (const slug of boroughSlugs) {
    try {
      const series = await fetchRegion(REGION_SLUG_ALIASES[slug] ?? slug);
      if (series) boroughs[slug] = series;
      else logStep(STEP, `${slug}: no data`);
    } catch (err) {
      logStep(STEP, `${slug}: failed (${(err as Error).message})`);
    }
    await sleep(200);
  }

  const data: HpiData = { source: "HM Land Registry UK House Price Index", latestMonth: london.months[london.months.length - 1], london, boroughs };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote HPI for ${Object.keys(boroughs).length} boroughs + London (latest ${data.latestMonth}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
