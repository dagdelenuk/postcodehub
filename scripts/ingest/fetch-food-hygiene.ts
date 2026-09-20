import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy, loadOutcodeIndex, postcodeToOutcode } from "./lib/geo.js";
import type { FoodEstablishment, FoodHygieneFile } from "../../src/lib/types.js";

const STEP = "food-hygiene";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/processed/food-hygiene.json");
const API = "https://api.ratings.food.gov.uk";
const HEADERS = { "x-api-version": "2", accept: "application/json" };

// Consumer-facing business types only - manufacturers, distributors, schools,
// care homes etc. carry ratings too but aren't places a resident chooses to eat at or shop.
const CONSUMER_TYPES = new Set([
  "Restaurant/Cafe/Canteen",
  "Takeaway/sandwich shop",
  "Pub/bar/nightclub",
  "Hotel/bed & breakfast/guest house",
  "Mobile caterer",
  "Retailers - supermarkets/hypermarkets",
  "Retailers - other",
]);

interface Authority {
  LocalAuthorityId: number;
  Name: string;
}
interface FhrsEstablishment {
  BusinessName: string;
  BusinessType: string;
  AddressLine1: string;
  AddressLine2: string;
  AddressLine3: string;
  PostCode: string;
  RatingValue: string;
  RatingDate: string;
  geocode?: { longitude?: string; latitude?: string };
}

/** "Richmond-Upon-Thames" / "Kensington and Chelsea" / "City of London Corporation" -> comparable key. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(corporation|london borough of|royal borough of)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function main() {
  const hierarchy = await loadHierarchy();
  const outcodeIndex = await loadOutcodeIndex();
  const { authorities } = await withRetry(() => fetchJson<{ authorities: Authority[] }>(`${API}/Authorities/basic`, { headers: HEADERS }));
  const byKey = new Map(authorities.map((a) => [normalise(a.Name), a]));

  const outcodes: Record<string, FoodEstablishment[]> = {};
  const london: Record<string, number> = {};
  for (const borough of hierarchy.cities.flatMap((c) => c.boroughs)) {
    const authority = byKey.get(normalise(borough.name));
    if (!authority) {
      logStep(STEP, `${borough.name}: no FHRS authority match`);
      continue;
    }
    const url = `${API}/Establishments?localAuthorityId=${authority.LocalAuthorityId}&pageSize=0`;
    const res = await withRetry(() => fetchJson<{ establishments: FhrsEstablishment[] }>(url, { headers: HEADERS, signal: AbortSignal.timeout(120000) }));
    let kept = 0;
    for (const e of res.establishments) {
      if (!CONSUMER_TYPES.has(e.BusinessType) || !/^[0-5]$/.test(e.RatingValue)) continue;
      const outcode = postcodeToOutcode(e.PostCode);
      if (!outcode || !outcodeIndex.has(outcode)) continue;
      (outcodes[outcode] ??= []).push({
        name: e.BusinessName,
        type: e.BusinessType,
        address: [e.AddressLine1, e.AddressLine2, e.AddressLine3].filter(Boolean).join(", "),
        postcode: e.PostCode,
        rating: Number(e.RatingValue),
        ratingDate: e.RatingDate.slice(0, 10),
        latitude: Number(e.geocode?.latitude) || null,
        longitude: Number(e.geocode?.longitude) || null,
      });
      london[e.RatingValue] = (london[e.RatingValue] ?? 0) + 1;
      kept++;
    }
    logStep(STEP, `${borough.name}: ${kept} rated establishments.`);
    await sleep(300);
  }

  for (const list of Object.values(outcodes)) list.sort((a, b) => a.name.localeCompare(b.name));
  const data: FoodHygieneFile = {
    source: "Food Standards Agency, Food Hygiene Rating Scheme",
    fetchedAt: new Date().toISOString().slice(0, 10),
    londonCounts: london,
    outcodes,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote ${Object.keys(outcodes).length} outcodes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
