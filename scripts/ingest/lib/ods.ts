import { execFileSync } from "node:child_process";

// Just enough of an OpenDocument spreadsheet (.ods) reader for the DfT statistics tables: streams one named sheet's rows out
// of content.xml using `unzip`, expanding repeated cells, so no spreadsheet library is needed.

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function readOdsSheets(zip: string, sheetNames: string[]): Record<string, (string | number | undefined)[][]> {
  const xml = execFileSync("unzip", ["-p", zip, "content.xml"], { maxBuffer: 1024 * 1024 * 400 }).toString("utf-8");
  const result: Record<string, (string | number | undefined)[][]> = {};
  const tables = xml.split(/<table:table /).slice(1);
  for (const table of tables) {
    const name = decodeXml(table.match(/^table:name="([^"]*)"/)?.[1] ?? "");
    if (!sheetNames.includes(name)) continue;
    const rows: (string | number | undefined)[][] = [];
    for (const rowMatch of table.matchAll(/<table:table-row\b[^>]*?(?:\/>|>(.*?)<\/table:table-row>)/gs)) {
      const body = rowMatch[1] ?? "";
      const row: (string | number | undefined)[] = [];
      for (const cell of body.matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>(.*?)<\/table:(?:covered-)?table-cell>)/gs)) {
        const attrs = cell[1];
        const repeat = Number(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1);
        let value: string | number | undefined;
        if (/office:value-type="(float|percentage|currency)"/.test(attrs)) value = Number(attrs.match(/office:value="([^"]*)"/)?.[1]);
        else if (/office:value-type="string"/.test(attrs)) value = decodeXml([...(cell[2] ?? "").matchAll(/<text:p[^>]*>(.*?)<\/text:p>/gs)].map((p) => p[1].replace(/<[^>]+>/g, "")).join(" "));
        // Trailing blank cells can repeat thousands of times; only expand ones that carry a value.
        if (value === undefined) {
          row.length += Math.min(repeat, 64);
        } else {
          for (let i = 0; i < repeat; i++) row.push(value);
        }
      }
      rows.push(row);
    }
    result[name] = rows;
  }
  return result;
}
