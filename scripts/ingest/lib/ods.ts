import { execFileSync, spawn } from "node:child_process";

// Just enough of an OpenDocument spreadsheet (.ods) reader for the DfT/CQC statistics tables: pulls rows out of
// content.xml, expanding repeated cells, so no spreadsheet library is needed.

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Parses one <table:table-row>...</table:table-row> element's inner XML into its cell values, expanding repeated cells. */
export function parseOdsRow(body: string): (string | number | undefined)[] {
  const row: (string | number | undefined)[] = [];
  for (const cell of body.matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>(.*?)<\/table:(?:covered-)?table-cell>)/gs)) {
    const attrs = cell[1];
    const repeat = Number(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1);
    let value: string | number | undefined;
    if (/office:value-type="(float|percentage|currency)"/.test(attrs)) value = Number(attrs.match(/office:value="([^"]*)"/)?.[1]);
    else if (/office:value-type="date"/.test(attrs)) value = attrs.match(/office:date-value="([^"]*)"/)?.[1];
    else if (/office:value-type="string"/.test(attrs)) value = decodeXml([...(cell[2] ?? "").matchAll(/<text:p[^>]*>(.*?)<\/text:p>/gs)].map((p) => p[1].replace(/<[^>]+>/g, "")).join(" "));
    // Trailing blank cells can repeat thousands of times; only expand ones that carry a value.
    if (value === undefined) {
      row.length += Math.min(repeat, 64);
    } else {
      for (let i = 0; i < repeat; i++) row.push(value);
    }
  }
  return row;
}

/** Reads whole named sheets into memory at once. Fine for workbooks up to a couple hundred MB of XML (e.g. DfT's); for
 * anything bigger, content.xml can exceed Node's maximum string length entirely, so use `streamOdsSheetRows` instead. */
export function readOdsSheets(zip: string, sheetNames: string[]): Record<string, (string | number | undefined)[][]> {
  const xml = execFileSync("unzip", ["-p", zip, "content.xml"], { maxBuffer: 1024 * 1024 * 400 }).toString("utf-8");
  const result: Record<string, (string | number | undefined)[][]> = {};
  const tables = xml.split(/<table:table /).slice(1);
  for (const table of tables) {
    const name = decodeXml(table.match(/^table:name="([^"]*)"/)?.[1] ?? "");
    if (!sheetNames.includes(name)) continue;
    const rows: (string | number | undefined)[][] = [];
    for (const rowMatch of table.matchAll(/<table:table-row\b[^>]*?(?:\/>|>(.*?)<\/table:table-row>)/gs)) {
      rows.push(parseOdsRow(rowMatch[1] ?? ""));
    }
    result[name] = rows;
  }
  return result;
}

/**
 * Streams one named sheet's rows out of a huge .ods workbook (content.xml can be well over a gigabyte, past Node's string
 * length limit, so this never holds more than a small rolling buffer in memory) via `unzip -p`, calling `onRow` for each
 * row as it's parsed and stopping as soon as that sheet's closing tag is seen (the rest of the file is never read).
 */
export function streamOdsSheetRows(zip: string, sheetName: string, onRow: (row: (string | number | undefined)[]) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-p", zip, "content.xml"]);
    const startMarker = `table:name="${sheetName}"`;
    let buffer = "";
    let insideSheet = false;
    let finished = false;

    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      child.stdout.removeAllListeners("data");
      child.kill();
      if (err) reject(err);
      else resolve();
    };

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      if (finished) return;
      buffer += chunk;

      if (!insideSheet) {
        const markerIdx = buffer.indexOf(startMarker);
        if (markerIdx === -1) {
          // Keep a small tail in case the marker is split across this chunk boundary.
          if (buffer.length > 4096) buffer = buffer.slice(-4096);
          return;
        }
        const tableStart = buffer.lastIndexOf("<table:table ", markerIdx);
        buffer = buffer.slice(tableStart === -1 ? markerIdx : tableStart);
        insideSheet = true;
      }

      const sheetEndIdx = buffer.indexOf("</table:table>");
      const scanLimit = sheetEndIdx === -1 ? buffer.length : sheetEndIdx;

      const rowRe = /<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
      let lastConsumed = 0;
      let m: RegExpExecArray | null;
      while ((m = rowRe.exec(buffer.slice(0, scanLimit)))) {
        onRow(parseOdsRow(m[1] ?? ""));
        lastConsumed = rowRe.lastIndex;
      }
      buffer = sheetEndIdx === -1 ? buffer.slice(lastConsumed) : "";

      if (sheetEndIdx !== -1) finish();
    });

    child.on("error", (err) => finish(err));
    child.stdout.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (finished) return;
      if (code === 0) finish();
      else finish(new Error(`unzip exited with code ${code}`));
    });
  });
}
