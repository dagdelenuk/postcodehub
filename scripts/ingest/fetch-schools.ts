import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { logStep, fetchText } from "./lib/fetch-utils.js";
import { postcodeToOutcode, loadOutcodeIndex } from "./lib/geo.js";
import type { School } from "../../src/lib/types.js";

const STEP = "schools";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

const OFSTED_RATING_LABELS: Record<string, string> = {
  "1": "Outstanding",
  "2": "Good",
  "3": "Requires improvement",
  "4": "Inadequate",
};

/** Ofsted encodes ratings as 1-4; "NULL"/"Not judged" mean no current rating. */
function normaliseOfstedRating(raw: string | undefined): string | null {
  if (!raw) return null;
  return OFSTED_RATING_LABELS[raw] ?? null;
}

/** GIAS publishes a dated CSV daily; try today then walk back a few days. */
async function fetchGiasCsv(): Promise<Record<string, string>[]> {
  for (let daysAgo = 0; daysAgo < 5; daysAgo++) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const url = `https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/edubasealldata${stamp}.csv`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      logStep(STEP, `GIAS CSV fetched for ${stamp} (${(buf.length / 1e6).toFixed(1)} MB)`);
      return parse(buf.toString("latin1"), { columns: true, skip_empty_lines: true });
    } catch {
      // try an earlier date
    }
  }
  throw new Error("Could not find a recent GIAS edubasealldata CSV in the last 5 days.");
}

/**
 * Ofsted publishes "state-funded schools inspections and outcomes" quarterly
 * (as at end of March/August/December). We walk back through recent quarter-end
 * dates, find the live gov.uk stats page, and scrape its CSV asset link rather
 * than hardcoding a versioned asset URL that changes every release.
 */
async function fetchOfstedRatings(): Promise<Map<string, string>> {
  const quarterEnds: { month: string; day: number }[] = [
    { month: "march", day: 31 },
    { month: "august", day: 31 },
    { month: "december", day: 31 },
  ];
  const now = new Date();
  const candidates: string[] = [];
  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const year = now.getFullYear() - yearOffset;
    for (const q of quarterEnds) {
      candidates.push(`https://www.gov.uk/government/statistics/state-funded-schools-inspections-and-outcomes-as-at-31-${q.month}-${year}`);
    }
  }

  for (const pageUrl of candidates) {
    try {
      const html = await fetchText(pageUrl);
      const match = html.match(
        /https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[a-z0-9]+\/State-funded_schools_inspections_and_outcomes_as_at[^"]*\.csv/
      );
      if (!match) continue;
      logStep(STEP, `Found Ofsted ratings CSV via ${pageUrl}`);
      const csvText = await fetchText(match[0]);
      const rows: Record<string, string>[] = parse(csvText, { columns: true, skip_empty_lines: true });
      const ratings = new Map<string, string>();
      for (const row of rows) {
        const urn = row["URN"];
        const rating = normaliseOfstedRating(row["Latest OEIF overall effectiveness"]);
        if (urn && rating) ratings.set(urn, rating);
      }
      logStep(STEP, `Loaded Ofsted ratings for ${ratings.size} schools.`);
      return ratings;
    } catch {
      // try the next candidate quarter
    }
  }
  logStep(STEP, "WARNING: could not locate an Ofsted ratings CSV — proceeding without ratings.");
  return new Map();
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const [giasRows, ofstedRatings] = await Promise.all([fetchGiasCsv(), fetchOfstedRatings()]);

  const byOutcode = new Map<string, School[]>();
  let matched = 0;

  for (const row of giasRows) {
    if (row["EstablishmentStatus (name)"] !== "Open") continue;
    const postcode = row["Postcode"];
    const outcode = postcode ? postcodeToOutcode(postcode) : null;
    if (!outcode || !outcodeIndex.has(outcode)) continue;

    matched++;
    const urn = row["URN"];
    const school: School = {
      name: row["EstablishmentName"],
      urn,
      phaseOfEducation: row["PhaseOfEducation (name)"] || "Unknown",
      ofstedRating: ofstedRatings.get(urn) ?? null,
      ofstedLastInspection: row["DateOfLastInspectionVisit"] || null,
      address: [row["Street"], row["Locality"], row["Town"]].filter(Boolean).join(", "),
      postcode,
      numberOfPupils: row["NumberOfPupils"] ? Number(row["NumberOfPupils"]) : null,
      schoolCapacity: row["SchoolCapacity"] ? Number(row["SchoolCapacity"]) : null,
    };

    const list = byOutcode.get(outcode) ?? [];
    list.push(school);
    byOutcode.set(outcode, list);
  }

  logStep(STEP, `Matched ${matched} open schools across ${byOutcode.size} outcodes.`);

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "schools-by-outcode.json");
  await writeFile(outPath, JSON.stringify(Object.fromEntries(byOutcode), null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
