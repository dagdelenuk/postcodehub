import { writeFile, readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { fetchJson, logStep } from "./fetch-utils.js";

const STEP = "nspl";
const HEADERS = { "User-Agent": "PostcodeHubBot/1.0 (https://postcodehub.uk; community data pipeline)" };

interface ArcGisSearchResult {
  results: { id: string; name: string; title: string }[];
}

/**
 * ONS publishes a new NSPL release quarterly under a new ArcGIS item id each
 * time, so the id is discovered live rather than hardcoded (same lesson as
 * the GIAS/Ofsted dated-filename handling elsewhere in this pipeline).
 */
export async function findLatestNsplItemId(): Promise<{ id: string; name: string }> {
  const q = 'title:"National Statistics Postcode Lookup (" AND owner:ONSGeography_data AND type:"CSV Collection" -title:"User Guide"';
  const url = `https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&f=json&sortField=created&sortOrder=desc&num=1`;
  const data = await fetchJson<ArcGisSearchResult>(url, { headers: HEADERS });
  const hit = data.results[0];
  if (!hit) throw new Error("Could not find the current NSPL dataset on ArcGIS - search query may need updating.");
  return { id: hit.id, name: hit.name };
}

/** Downloads the NSPL zip (~180MB) to destPath, unless already present. */
export async function ensureNsplZip(destPath: string): Promise<void> {
  try {
    await readFile(destPath);
    logStep(STEP, `Using cached ${destPath}`);
    return;
  } catch {
    // not cached, fall through to download
  }
  const { id, name } = await findLatestNsplItemId();
  logStep(STEP, `Downloading ${name} (item ${id})...`);
  const url = `https://www.arcgis.com/sharing/rest/content/items/${id}/data`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`NSPL download failed: GET ${url} -> ${res.status}`);
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  logStep(STEP, `Saved ${destPath}`);
}

/** Extracts one entry from the NSPL zip without unpacking the whole archive. */
function extractZipEntry(zipPath: string, entryPath: string): string {
  const buf = execFileSync("unzip", ["-p", zipPath, entryPath], { maxBuffer: 1024 * 1024 * 300 });
  return buf.toString("utf-8").replace(/^﻿/, "");
}

/** Lists the zip's entry names once, so callers can find the dated multi_csv filenames without guessing. */
function listZipEntries(zipPath: string): string[] {
  const out = execFileSync("unzip", ["-Z1", zipPath], { maxBuffer: 1024 * 1024 * 10 }).toString("utf-8");
  return out.split("\n").filter(Boolean);
}

export interface NsplRow {
  outcode: string;
  ladCode: string;
  lat: number;
  lon: number;
  terminated: boolean;
  /** "0" = small user (a real residential/small-business address); "1" = large
   * user (a single high-mail-volume organisation gets its own postcode,
   * doesn't represent a neighbourhood). */
  largeUser: boolean;
}

/** Parses one postcode-area CSV (e.g. the "NW" or "HA" file) from the NSPL zip. */
export function readNsplArea(zipPath: string, entries: string[], areaPrefix: string): NsplRow[] {
  const entry = entries.find((e) => e.match(new RegExp(`multi_csv/NSPL_[A-Z0-9_]+_UK_${areaPrefix}\\.csv$`)));
  if (!entry) throw new Error(`No NSPL file found in zip for area "${areaPrefix}"`);
  const csvText = extractZipEntry(zipPath, entry);
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });

  const rows: NsplRow[] = [];
  for (const rec of records) {
    const outcode = rec.pcds?.split(" ")[0];
    const lat = Number(rec.lat);
    const lon = Number(rec.long);
    if (!outcode || !rec.lad25cd || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    rows.push({ outcode, ladCode: rec.lad25cd, lat, lon, terminated: Boolean(rec.doterm), largeUser: rec.usrtypind === "1" });
  }
  return rows;
}

/** Maps LAD25CD -> LAD25NM (e.g. "E09000005" -> "Brent") from the NSPL's bundled lookup doc. */
export function readLadNameLookup(zipPath: string, entries: string[]): Map<string, string> {
  const entry = entries.find((e) => e.includes("LAD25_UK_LU.csv"));
  if (!entry) throw new Error("Could not find the LAD name lookup file in the NSPL zip");
  const csvText = extractZipEntry(zipPath, entry);
  const records: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true });
  const map = new Map<string, string>();
  for (const rec of records) {
    if (rec.LAD25CD && rec.LAD25NM) map.set(rec.LAD25CD, rec.LAD25NM);
  }
  return map;
}

export { listZipEntries };
