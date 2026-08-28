import { parse } from "csv-parse/sync";
import { fetchText } from "./fetch-utils.js";

// ONS mid-year population estimates, small area (2021 census-based), served
// via Nomis since ONS stopped publishing its own ward-level page directly -
// "current, being actively updated" per the dataset's own metadata (unlike
// hardcoding one dated ONS spreadsheet release).
const NOMIS_DATASET = "NM_2014_1";
// Nomis's "type" code for the current (2023) ward boundary set, discovered
// live via GET .../geography/{ladCode}.def.sdmx.json, which lists
// "{ladCode}TYPE174" as "2023 wards within <borough>".
const WARDS_2023_TYPE = "TYPE174";

/**
 * Mid-year population estimate per ward, for one London borough (by ONS LAD
 * code, e.g. "E09000027" for Richmond upon Thames). Nomis disambiguates
 * ward names that collide with another ward elsewhere with a "(Borough
 * Name)" suffix (e.g. "Barnes (Richmond upon Thames)") - stripped here so
 * names line up with postcodes.io's own plain ward names.
 */
export async function fetchWardPopulations(ladCode: string): Promise<Map<string, number>> {
  const url = `https://www.nomisweb.co.uk/api/v01/dataset/${NOMIS_DATASET}.data.csv?geography=${ladCode}${WARDS_2023_TYPE}&date=latest&gender=0&c_age=200&measures=20100`;
  const csvText = await fetchText(url);
  const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });

  const map = new Map<string, number>();
  for (const row of rows) {
    const rawName = row["GEOGRAPHY_NAME"];
    const value = Number(row["OBS_VALUE"]);
    if (!rawName || Number.isNaN(value)) continue;
    const name = rawName.replace(/\s*\([^)]*\)\s*$/, "").trim();
    map.set(name, value);
  }
  return map;
}
