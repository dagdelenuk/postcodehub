import { fetchText, logStep } from "./fetch-utils.js";

const STEP = "ofcom";
const BASE = "https://www.ofcom.org.uk";

export interface OfcomRelease {
  url: string;
  /** Release tag in the file name, e.g. "202507" (data as at July 2025). */
  tag: string;
  /** Revision in the file name, e.g. "r01". */
  rev: string;
  /** Human-readable period, e.g. "July 2025". */
  period: string;
  /** Connected Nations report year the file belongs to, e.g. 2025. */
  reportYear: number;
}

function periodOf(tag: string): string {
  return new Date(`${tag.slice(0, 4)}-${tag.slice(4, 6)}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * Ofcom publishes each year's Connected Nations data on a "data downloads <year>" page whose URL slug is not fully regular
 * (2024: .../connected-nations-2024/data-downloads-2024, 2025: .../connected-nations-20252/data-downloads-2025), so this
 * probes the likely slugs for this year and last, and picks the newest "<yyyymm>_<name>_r<nn>.zip" link it finds.
 * Returns null when no page has one, so callers can keep the data they already have.
 */
export async function findLatestOfcomRelease(name: "fixed_broadband_coverage" | "mobile_coverage"): Promise<OfcomRelease | null> {
  const thisYear = new Date().getFullYear();
  const found: OfcomRelease[] = [];
  for (const year of [thisYear, thisYear - 1]) {
    for (const suffix of ["", "2", "3"]) {
      const page = `${BASE}/phones-and-broadband/coverage-and-speeds/connected-nations-${year}${suffix}/data-downloads-${year}`;
      let html: string;
      try {
        html = await fetchText(page);
      } catch {
        continue; // this slug doesn't exist
      }
      const pattern = new RegExp(`href="([^"]*/(\\d{6})_${name}_(r\\d+)\\.zip)[^"]*"`, "g");
      for (const m of html.matchAll(pattern)) {
        found.push({ url: new URL(m[1], BASE).toString(), tag: m[2], rev: m[3], period: periodOf(m[2]), reportYear: year });
      }
    }
    if (found.length > 0) break; // a newer year's page wins outright
  }
  found.sort((a, b) => b.tag.localeCompare(a.tag) || b.rev.localeCompare(a.rev));
  if (found.length === 0) logStep(STEP, `No ${name} release found on Ofcom's data downloads pages.`);
  return found[0] ?? null;
}
