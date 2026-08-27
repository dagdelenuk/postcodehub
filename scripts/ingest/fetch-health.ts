import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { loadOutcodeIndex, postcodeToOutcode } from "./lib/geo.js";
import type { GpSurgery, HealthData } from "../../src/lib/types.js";

const STEP = "health";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");
const ORD_BASE = "https://directory.spineservices.nhs.uk/ORD/2-0-0";

// NHS ODS role codes, confirmed live against /ORD/2-0-0/roles.
const ROLES = {
  gpSurgeries: "RO177", // GP practice (prescribing cost centre)
  dentists: "RO110", // General dental practice
  pharmacies: "RO182", // Pharmacy
} as const;

interface OrgListItem {
  Name: string;
  OrgId: string;
  Status: string;
  PostCode: string;
}

interface OrgListResponse {
  Organisations: OrgListItem[];
}

interface OrgDetailResponse {
  Organisation: {
    GeoLoc?: { Location?: { AddrLn1?: string; AddrLn2?: string; Town?: string; PostCode?: string } };
    Contacts?: { Contact?: { type: string; value: string }[] };
  };
}

async function listActiveOrgs(outcode: string, roleId: string): Promise<OrgListItem[]> {
  const url = `${ORD_BASE}/organisations?PostCode=${encodeURIComponent(outcode)}&Roles=${roleId}&Status=Active&Limit=1000`;
  const data = await withRetry(() => fetchJson<OrgListResponse>(url));
  const orgs = data.Organisations ?? [];
  // The ODS API matches PostCode as a plain string prefix, so a query for "KT1"
  // also returns KT10-KT19 etc. Re-filter to the exact outcode client-side.
  return orgs.filter((org) => postcodeToOutcode(org.PostCode) === outcode);
}

async function getOrgDetail(orgId: string): Promise<GpSurgery> {
  const data = await withRetry(() => fetchJson<OrgDetailResponse>(`${ORD_BASE}/organisations/${orgId}`));
  const loc = data.Organisation.GeoLoc?.Location;
  const tel = data.Organisation.Contacts?.Contact?.find((c) => c.type === "tel")?.value;
  return {
    name: "", // filled in by caller from the list item (detail omits it in some records)
    odsCode: orgId,
    address: [loc?.AddrLn1, loc?.AddrLn2, loc?.Town].filter(Boolean).join(", "),
    postcode: loc?.PostCode ?? "",
    telephone: tel,
  };
}

async function fetchCategory(outcode: string, roleId: string): Promise<GpSurgery[]> {
  const orgs = await listActiveOrgs(outcode, roleId);
  const results: GpSurgery[] = [];
  // Small concurrency + delay: ODS has no published rate limit, but this is a
  // shared public NHS service, so stay polite rather than firing everything at once.
  const CONCURRENCY = 5;
  for (let i = 0; i < orgs.length; i += CONCURRENCY) {
    const batch = orgs.slice(i, i + CONCURRENCY);
    const detailed = await Promise.all(
      batch.map(async (org) => {
        const detail = await getOrgDetail(org.OrgId);
        return { ...detail, name: org.Name };
      })
    );
    results.push(...detailed);
    await sleep(150);
  }
  return results;
}

async function main() {
  const outcodeIndex = await loadOutcodeIndex();
  const byOutcode: Record<string, HealthData> = {};

  for (const outcode of outcodeIndex.keys()) {
    const [gpSurgeries, dentists, pharmacies] = await Promise.all([
      fetchCategory(outcode, ROLES.gpSurgeries),
      fetchCategory(outcode, ROLES.dentists),
      fetchCategory(outcode, ROLES.pharmacies),
    ]);
    byOutcode[outcode] = { gpSurgeries, dentists, pharmacies };
    logStep(
      STEP,
      `${outcode}: ${gpSurgeries.length} GPs, ${dentists.length} dentists, ${pharmacies.length} pharmacies`
    );
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "health-by-outcode.json");
  await writeFile(outPath, JSON.stringify(byOutcode, null, 2));
  logStep(STEP, `Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
