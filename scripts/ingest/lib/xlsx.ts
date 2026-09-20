import { execFileSync } from "node:child_process";

// Just enough of an .xlsx reader for the ONS/DfT reference tables this pipeline reads: pulls a named sheet's rows out of the raw XML
// with `unzip`, so no spreadsheet library is needed.

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const unzip = (zip: string, entry: string) => execFileSync("unzip", ["-p", zip, entry], { maxBuffer: 1024 * 1024 * 400 }).toString("utf-8");

/** Column letters -> 0-based index ("A" -> 0, "AA" -> 26). */
function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Rows of one sheet as arrays (holes are undefined). Numbers stay numbers; text comes back as strings. */
export function readSheet(zip: string, sheetName: string): (string | number | undefined)[][] {
  const workbook = unzip(zip, "xl/workbook.xml");
  const rels = unzip(zip, "xl/_rels/workbook.xml.rels");
  const sheetTag = [...workbook.matchAll(/<sheet [^>]*\/>/g)].map((m) => m[0]).find((t) => decodeXml(t.match(/name="([^"]*)"/)?.[1] ?? "") === sheetName);
  if (!sheetTag) throw new Error(`Sheet "${sheetName}" not found`);
  const rid = sheetTag.match(/r:id="([^"]*)"/)![1];
  const relTag = [...rels.matchAll(/<Relationship [^>]*\/>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`))!;
  const target = relTag.match(/Target="([^"]*)"/)![1].replace(/^\/?(xl\/)?/, "xl/");

  const shared = [...unzip(zip, "xl/sharedStrings.xml").matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    decodeXml([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""))
  );
  const sheet = unzip(zip, target);
  const rows: (string | number | undefined)[][] = [];
  for (const rowMatch of sheet.matchAll(/<row [^>]*>(.*?)<\/row>/gs)) {
    const row: (string | number | undefined)[] = [];
    for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>([^<]*)<\/v>)?<\/c>)/g)) {
      const [, col, attrs, value] = c;
      if (value === undefined) continue;
      row[columnIndex(col)] = /t="s"/.test(attrs) ? shared[Number(value)] : /t="str"/.test(attrs) ? decodeXml(value) : Number(value);
    }
    rows.push(row);
  }
  return rows;
}
