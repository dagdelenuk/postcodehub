import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import { readOdsSheets } from "./lib/ods.js";
import type { EvChargingFile, EvBoroughStats } from "../../src/lib/types.js";

const STEP = "ev";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const OUT_FILE = path.resolve(__dirname, "../../data/processed/ev-charging.json");
const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const BBOX = "51.28,-0.51,51.70,0.33"; // Greater London
const EVCI_PAGE = "https://www.gov.uk/api/content/government/statistical-data-sets/electric-vehicle-charging-infrastructure-statistics-data-tables-evci";

/** DfT's quarterly table of public charging devices by local authority (from Zapmap and operators); the file name carries the release. */
async function findDftWorkbook(): Promise<string> {
  const page = JSON.stringify(await fetchJson<unknown>(EVCI_PAGE));
  const match = page.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"\\ ]*evci9001_[^"\\ ]*\.ods/);
  if (!match) throw new Error("Could not find the DfT public charging devices workbook (evci9001) on the data tables page");
  return match[0];
}

async function ensureDownload(url: string): Promise<string> {
  const dest = path.join(RAW_DIR, path.basename(url));
  if (existsSync(dest)) return dest;
  logStep(STEP, `Downloading ${url}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** The sheets run one column per quarter; the last numeric column is the latest. Returns name -> latest value, and the latest column's heading. */
function latestByName(rows: (string | number | undefined)[][]): { values: Map<string, number>; heading: string } {
  const headerIndex = rows.findIndex((r) => typeof r[0] === "string" && /^Local authority/i.test(String(r[0])));
  const header = rows[headerIndex];
  let lastCol = header.length - 1;
  while (lastCol > 1 && header[lastCol] === undefined) lastCol--;
  const values = new Map<string, number>();
  for (const r of rows.slice(headerIndex + 1)) {
    const name = r[1];
    const value = r[lastCol];
    if (typeof name === "string" && typeof value === "number") values.set(name.replace(/\s*\[[^\]]*\]/g, "").trim(), value);
  }
  return { values, heading: String(header[lastCol]).replace(/\s*\(.*$|\s*\[.*$/g, "").trim() };
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function main() {
  const hierarchy = await loadHierarchy();
  const boroughs = hierarchy.cities.flatMap((c) => c.boroughs);

  // Borough totals from the DfT release.
  const dftUrl = await findDftWorkbook();
  const sheets = readOdsSheets(await ensureDownload(dftUrl), ["1a", "1b", "2a", "2b"]);
  const all = latestByName(sheets["1a"]);
  const rapid = latestByName(sheets["1b"]);
  const perAll = latestByName(sheets["2a"]);
  const perRapid = latestByName(sheets["2b"]);
  const stats = (name: string): EvBoroughStats | null => {
    const devices = all.values.get(name);
    return devices === undefined
      ? null
      : {
          devices,
          rapidDevices: rapid.values.get(name) ?? 0,
          devicesPer100k: Math.round(perAll.values.get(name) ?? 0),
          rapidPer100k: Math.round((perRapid.values.get(name) ?? 0) * 10) / 10,
        };
  };
  const boroughData: EvChargingFile["boroughs"] = {};
  for (const b of boroughs) {
    const s = stats(b.name);
    if (s) boroughData[b.slug] = s;
    else logStep(STEP, `${b.name}: no DfT row`);
  }
  const london = stats("London");
  if (!london) throw new Error("No London row in the DfT table");

  // Individual sites from OpenStreetMap, for the map and "nearby" list.
  const query = `[out:json][timeout:120];(node["amenity"="charging_station"](${BBOX});way["amenity"="charging_station"](${BBOX}););out center tags;`;
  const osm = await withRetry(
    () =>
      fetchJson<{ elements: OverpassElement[] }>(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "postcodehub.uk ingest (https://postcodehub.uk)" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(180000),
      }),
    { retries: 4, baseDelayMs: 5000 }
  );
  const sites: EvChargingFile["sites"] = [];
  for (const e of osm.elements) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const t = e.tags ?? {};
    const capacity = Number(t.capacity);
    const operator = t.operator || t.brand || "";
    sites.push({
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      name: t.name || operator || "Charge point",
      operator,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    });
  }

  const data: EvChargingFile = {
    source: "DfT public charging device statistics (from Zapmap and operators); charge point locations from OpenStreetMap contributors",
    period: all.heading,
    london,
    boroughs: boroughData,
    sites,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data));
  logStep(STEP, `Wrote ${Object.keys(boroughData).length} boroughs + London (${all.heading}) and ${sites.length} mapped sites.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
