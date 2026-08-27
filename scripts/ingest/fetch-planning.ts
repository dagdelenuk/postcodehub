import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { boroughOutcodeKey, loadOutcodeBoroughPairs } from "./lib/geo.js";
import { COUNCIL_CONFIG } from "./lib/councils.js";
import type { PlanningData } from "../../src/lib/types.js";

const STEP = "planning";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

// No London council's planning register exposes a public REST/RSS API we could
// find (each runs a different proprietary system - Idox, Arcus, Agile
// Applications, etc; see scripts/ingest/lib/councils.ts for what was actually
// verified per borough). Rather than fabricate rows, every outcode links out
// to its own council's real, verified live planning search page.
//
// Keyed by (borough, outcode) pair, not plain outcode: a boundary outcode
// shown on two different boroughs' pages should link to each borough's own
// planning portal, not silently share one.
async function main() {
  const pairs = await loadOutcodeBoroughPairs();
  const byKey: Record<string, PlanningData> = {};

  let withUrl = 0;
  for (const entry of pairs) {
    const searchUrl = COUNCIL_CONFIG[entry.borough]?.planningSearchUrl ?? null;
    if (searchUrl) withUrl++;
    byKey[boroughOutcodeKey(entry.boroughSlug, entry.outcode.outcode)] = { applications: [], searchUrl };
  }

  logStep(STEP, `${withUrl}/${pairs.length} outcode pages have a verified planning search link; the rest are an honest gap.`);

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "planning-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byKey, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
