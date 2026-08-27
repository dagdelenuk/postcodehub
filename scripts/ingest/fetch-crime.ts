import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadOutcodeIndex } from "./lib/geo.js";
import type { CrimeData, CrimeMonthSummary } from "../../src/lib/types.js";

const STEP = "crime";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const POLICE_BASE = "https://data.police.uk/api";

const VIOLENT_CATEGORIES = new Set(["violent-crime", "robbery", "possession-of-weapons", "public-order"]);
const PROPERTY_CATEGORIES = new Set([
  "burglary",
  "bicycle-theft",
  "criminal-damage-arson",
  "other-theft",
  "shoplifting",
  "theft-from-the-person",
  "vehicle-crime",
]);

interface StreetCrime {
  category: string;
  month: string;
}

async function getLatestAvailableMonth(): Promise<string> {
  const data = await fetchJson<{ date: string }>(`${POLICE_BASE}/crime-last-updated`);
  return data.date.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}

function lastNMonths(latest: string, n: number): string[] {
  const [year, month] = latest.split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months.reverse();
}

async function fetchMonthCrimes(lat: number, lng: number, month: string): Promise<StreetCrime[]> {
  const url = `${POLICE_BASE}/crimes-street/all-crime?lat=${lat}&lng=${lng}&date=${month}`;
  return withRetry(() => fetchJson<StreetCrime[]>(url), { retries: 2 });
}

async function fetchOutcodeCrime(lat: number, lng: number, months: string[]): Promise<CrimeData> {
  const monthlyTrend: CrimeMonthSummary[] = [];
  const categoryBreakdown: Record<string, number> = {};

  for (const month of months) {
    const crimes = await fetchMonthCrimes(lat, lng, month);
    let violent = 0;
    let property = 0;
    for (const crime of crimes) {
      categoryBreakdown[crime.category] = (categoryBreakdown[crime.category] ?? 0) + 1;
      if (VIOLENT_CATEGORIES.has(crime.category)) violent++;
      else if (PROPERTY_CATEGORIES.has(crime.category)) property++;
    }
    monthlyTrend.push({ month, totalCrimes: crimes.length, violentCrimes: violent, propertyCrimes: property });
    await sleep(200); // stay well under any point rate limiting on data.police.uk
  }

  return {
    monthlyTrend,
    categoryBreakdown,
    totalLast12Months: monthlyTrend.reduce((sum, m) => sum + m.totalCrimes, 0),
  };
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const latest = await getLatestAvailableMonth();
  const months = lastNMonths(latest, 12);
  logStep(STEP, `Latest available month: ${latest}. Fetching ${months[0]}..${months[months.length - 1]}.`);

  const byOutcode: Record<string, CrimeData> = {};
  for (const [outcode, entry] of outcodeIndex) {
    const data = await fetchOutcodeCrime(entry.outcode.latitude, entry.outcode.longitude, months);
    byOutcode[outcode] = data;
    logStep(STEP, `${outcode}: ${data.totalLast12Months} crimes over 12 months`);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "crime-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byOutcode, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
