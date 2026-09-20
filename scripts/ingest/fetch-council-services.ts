import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { CouncilServicesFile } from "../../src/lib/types.js";

const STEP = "council-services";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../../data/reference/council-services.json");
const LINKS_API = "https://local-links-manager.publishing.service.gov.uk/api";

// GOV.UK "local transaction" pages, each of which sends a resident to their
// own council's page for that task. Slugs are the GOV.UK paths; the LGSL/LGIL
// codes that identify the service are looked up live from GOV.UK's content API.
const GROUPS: { group: string; slugs: string[] }[] = [
  { group: "Bins & recycling", slugs: ["rubbish-collection-day", "missed-bin-collection", "recycling-collections", "recycling-bin", "collection-large-waste-items", "garden-waste-disposal"] },
  { group: "Council Tax & benefits", slugs: ["pay-council-tax", "apply-council-tax-reduction", "apply-for-council-tax-discount", "apply-housing-benefit-from-council"] },
  { group: "Parking & roads", slugs: ["parking-permit", "pay-parking-fine", "appeal-parking-fine", "blue-badge-scheme-information-council", "apply-dropped-kerb", "report-pothole", "report-problem-street-light"] },
  { group: "Report a problem", slugs: ["report-litter", "report-dog-fouling", "report-graffiti", "report-abandoned-vehicle", "report-noise-pollution-to-council", "report-pest-problem", "report-blocked-drain"] },
  { group: "Housing", slugs: ["apply-for-council-housing", "homelessness-help-from-council", "repair-council-property"] },
  { group: "Schools & families", slugs: ["apply-for-primary-school-place", "apply-for-secondary-school-place", "school-term-holiday-dates", "apply-free-school-meals", "find-free-early-education"] },
  { group: "Community & your council", slugs: ["local-library-services", "find-your-local-councillors", "apply-allotment", "alcohol-licence-your-area", "complain-about-your-council"] },
];

interface ContentResponse {
  title: string;
  details?: { lgsl_code?: number; lgil_code?: number };
}
interface LinkResponse {
  local_authority: { name: string; homepage_url: string; slug: string };
  local_interaction?: { url: string | null; status: string };
}

async function main() {
  const services: CouncilServicesFile["services"] = [];
  for (const { group, slugs } of GROUPS) {
    for (const slug of slugs) {
      const res = await withRetry(() => fetchJson<ContentResponse>(`https://www.gov.uk/api/content/${slug}`)).catch(() => null);
      const { lgsl_code: lgsl, lgil_code: lgil } = res?.details ?? {};
      if (!res || lgsl == null || lgil == null) {
        logStep(STEP, `${slug}: no LGSL/LGIL code, skipped`);
        continue;
      }
      services.push({ slug, title: res.title, group, lgsl, lgil });
    }
  }

  const hierarchy = await loadHierarchy();
  const councils: CouncilServicesFile["councils"] = {};
  for (const borough of hierarchy.cities.flatMap((c) => c.boroughs)) {
    // GOV.UK's authority slugs match ours for every London borough.
    const authority = borough.slug;
    const links: Record<string, string> = {};
    let name = "";
    let homepage = "";
    for (const s of services) {
      try {
        const r = await withRetry(() => fetchJson<LinkResponse>(`${LINKS_API}/link?authority_slug=${authority}&lgsl=${s.lgsl}&lgil=${s.lgil}`));
        name = r.local_authority.name;
        homepage = r.local_authority.homepage_url;
        if (r.local_interaction?.url) links[s.slug] = r.local_interaction.url;
      } catch (err) {
        logStep(STEP, `${borough.slug}/${s.slug}: ${(err as Error).message}`);
      }
      await sleep(60);
    }
    councils[borough.slug] = { name: name || borough.name, homepage, links };
    logStep(STEP, `${borough.name}: ${Object.keys(links).length}/${services.length} service links.`);
  }

  const data: CouncilServicesFile = {
    source: "GOV.UK Local Links Manager (each council's own service pages)",
    fetchedAt: new Date().toISOString().slice(0, 10),
    services,
    councils,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(data, null, 1));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
