import { buildCompareData } from "../lib/compare";

// Static endpoint: written to /compare-data.json at build time and read by the Compare page in the browser.
export function GET() {
  return new Response(JSON.stringify(buildCompareData()), { headers: { "Content-Type": "application/json" } });
}
