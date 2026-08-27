import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, logStep, sleep } from "./lib/fetch-utils.js";
import { loadHierarchy } from "./lib/geo.js";
import type { Banners, BannerImage } from "../../src/lib/types.js";

const STEP = "banners";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");
const MANUAL_OVERRIDES_PATH = path.resolve(__dirname, "../../data/manual/banner-overrides.json");

interface ManualOverrideEntry {
  slug: string;
  images: BannerImage[];
}

/**
 * Hand-curated banners (data/manual/ - never touched by ingestion) win over
 * whatever was auto-fetched. Stored on disk as a list (not a Record<slug,...>)
 * because that's what the Decap CMS admin UI's "list" widget edits - a plain
 * map with arbitrary keys doesn't have a good structured-editor equivalent.
 */
async function loadManualOverrides(): Promise<Banners> {
  let entries: ManualOverrideEntry[];
  try {
    entries = JSON.parse(await readFile(MANUAL_OVERRIDES_PATH, "utf-8")) as ManualOverrideEntry[];
  } catch {
    return {};
  }
  const byLocation: Banners = {};
  for (const entry of entries) {
    if (entry.slug && entry.images?.length > 0) byLocation[entry.slug] = entry.images;
  }
  return byLocation;
}

// Wikimedia's API policy requires a descriptive User-Agent identifying the
// app; a generic one gets more aggressively rate-limited (confirmed live).
const HEADERS = { "User-Agent": "PostcodeHubBot/1.0 (https://postcodehub.uk; community data pipeline)" };
const WIKI_DELAY_MS = 350;
const MAX_IMAGES_PER_LOCATION = 4;

// Genuinely free-to-use licenses only - skip anything else rather than guess.
const FREE_LICENSE_PREFIXES = ["cc0", "cc-by", "pd", "public domain"];

// Embedded article images that aren't real photos - logos, flags, maps, icons.
const NON_PHOTO_PATTERN = /logo|coat[_ ]of[_ ]arms|flag[_ ]of|locator|\blocation\b|\bmap\b|icon|symbol|crest|\.svg$|\.ogg$|\.gif$/i;

interface WikiPage {
  title: string;
  original?: { source: string; width: number; height: number };
  images?: { title: string }[];
}

interface WikiQueryResponse {
  query?: { redirects?: { from: string; to: string }[]; pages: Record<string, WikiPage> };
}

interface CommonsImageInfo {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width: number;
  height: number;
  descriptionurl: string;
  extmetadata?: {
    License?: { value: string };
    LicenseShortName?: { value: string };
    Artist?: { value: string };
  };
}

interface CommonsQueryResponse {
  query?: { pages: Record<string, { imageinfo?: CommonsImageInfo[] }> };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

async function fetchWikiArticle(candidateTitles: string[]): Promise<WikiPage | null> {
  for (const title of candidateTitles) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&redirects=1&prop=pageimages|images&piprop=original&imlimit=40&format=json`;
    const data = await fetchJson<WikiQueryResponse>(url, { headers: HEADERS });
    await sleep(WIKI_DELAY_MS);
    const page = data.query ? Object.values(data.query.pages)[0] : undefined;
    if (!page || "missing" in page) continue;
    // A disambiguation/stub page can still have "images" (e.g. a disambig
    // icon, a Wiktionary logo) without a single real photo - only accept a
    // candidate that has a genuine usable original or at least one embedded
    // image that survives the non-photo filter, otherwise keep trying titles.
    if (articleHasPhoto(page)) return page;
  }
  return null;
}

function articleHasPhoto(page: WikiPage): boolean {
  if (page.original && !NON_PHOTO_PATTERN.test(page.original.source)) return true;
  return (page.images ?? []).some((img) => !NON_PHOTO_PATTERN.test(img.title));
}

async function fetchCommonsInfo(fileTitle: string): Promise<CommonsImageInfo | null> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600&format=json`;
  const data = await fetchJson<CommonsQueryResponse>(url, { headers: HEADERS });
  await sleep(WIKI_DELAY_MS);
  const page = data.query ? Object.values(data.query.pages)[0] : undefined;
  return page?.imageinfo?.[0] ?? null;
}

function isFreeLicense(licenseCode: string | undefined): boolean {
  if (!licenseCode) return false;
  const lower = licenseCode.toLowerCase();
  return FREE_LICENSE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

async function buildBannerImage(fileTitle: string): Promise<BannerImage | null> {
  const info = await fetchCommonsInfo(fileTitle);
  if (!info) return null;
  const license = info.extmetadata?.License?.value;
  if (!isFreeLicense(license)) return null;

  const width = info.thumbwidth ?? info.width;
  const height = info.thumbheight ?? info.height;

  const artist = info.extmetadata?.Artist?.value ? stripHtml(info.extmetadata.Artist.value) : "Unknown";
  const licenseShort = info.extmetadata?.LicenseShortName?.value ?? license ?? "";

  return {
    src: info.thumburl ?? info.descriptionurl,
    width,
    height,
    credit: `${artist} · ${licenseShort} · Wikimedia Commons`,
    creditUrl: info.descriptionurl,
    license: licenseShort,
  };
}

async function fetchLocationBanners(name: string, extraTitleCandidates: string[] = []): Promise<BannerImage[]> {
  const candidates = [name, ...extraTitleCandidates];
  const article = await fetchWikiArticle(candidates);
  if (!article) return [];

  const fileTitles: string[] = [];
  if (article.original) {
    // The lead/infobox image doesn't come with a File: title directly, but its
    // filename can be recovered from the source URL for a Commons lookup.
    // Skip it if it's a locator map/logo/etc, same as the embedded images below.
    const match = article.original.source.match(/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
    if (match && !NON_PHOTO_PATTERN.test(decodeURIComponent(match[1]))) {
      fileTitles.push(`File:${decodeURIComponent(match[1])}`);
    }
  }
  for (const img of article.images ?? []) {
    if (fileTitles.length >= MAX_IMAGES_PER_LOCATION * 3) break; // cap candidates we even try
    if (NON_PHOTO_PATTERN.test(img.title)) continue;
    if (!fileTitles.includes(img.title)) fileTitles.push(img.title);
  }

  const images: BannerImage[] = [];
  for (const fileTitle of fileTitles) {
    if (images.length >= MAX_IMAGES_PER_LOCATION) break;
    const banner = await buildBannerImage(fileTitle);
    if (banner) images.push(banner);
  }
  return images;
}

async function main() {
  const hierarchy = await loadHierarchy();
  const banners: Banners = {};

  for (const city of hierarchy.cities) {
    const cityImages = await fetchLocationBanners(city.name);
    banners[city.slug] = cityImages;
    logStep(STEP, `${city.name} (city): ${cityImages.length} banner images`);

    for (const borough of city.boroughs) {
      const boroughImages = await fetchLocationBanners(borough.name, [
        `Royal Borough of ${borough.name}`,
        `London Borough of ${borough.name}`,
      ]);
      banners[borough.slug] = boroughImages;
      logStep(STEP, `${borough.name}: ${boroughImages.length} banner images`);
    }
  }

  const overrides = await loadManualOverrides();
  let overrideCount = 0;
  for (const [slug, images] of Object.entries(overrides)) {
    if (images.length > 0) {
      banners[slug] = images;
      overrideCount++;
    }
  }

  const total = Object.values(banners).reduce((sum, imgs) => sum + imgs.length, 0);
  const empty = Object.entries(banners).filter(([, imgs]) => imgs.length === 0).map(([slug]) => slug);

  await mkdir(PROCESSED_DIR, { recursive: true });
  const outPath = path.join(PROCESSED_DIR, "banners.json");
  await writeFile(outPath, JSON.stringify(banners, null, 2));
  logStep(
    STEP,
    `Wrote ${outPath}: ${total} images across ${Object.keys(banners).length} locations (${overrideCount} from data/manual/banner-overrides.json).`
  );
  if (empty.length > 0) {
    logStep(STEP, `No free-licensed images found for: ${empty.join(", ")} (honest gap, banner just won't render there). Add these to data/manual/banner-overrides.json to fill them in yourself.`);
  }
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
