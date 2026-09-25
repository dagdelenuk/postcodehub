import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fetchJson, logStep, sleep, withRetry } from "./lib/fetch-utils.js";
import { haversineKm, loadOutcodeIndex } from "./lib/geo.js";
import { nameSimilarity, normalizeName } from "./lib/text.js";
import type { BannerImage } from "../../src/lib/types.js";

const STEP = "district-images";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw/geograph");
const PROCESSED_DIR = path.resolve(__dirname, "../../data/processed");
const OUT_PATH = path.join(PROCESSED_DIR, "district-images.json");
const MANUAL_OVERRIDES_PATH = path.resolve(__dirname, "../../data/manual/geograph-overrides.json");
const UPLOAD_MANIFEST_PATH = path.join(RAW_DIR, "uploaded-manifest.json");

const API_KEY = process.env.GEOGRAPH_API_KEY;
const BUCKET = "postcodehubuk-bucket";

// R2's S3-compatible API, authenticated with an R2-scoped access key pair (Cloudflare dashboard: R2 > Manage R2 API
// Tokens) - NOT the same thing as a general Cloudflare account API token, which (confirmed live) doesn't reliably carry
// R2 object read/write permission even when its template says "Edit".
const r2Client =
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
      })
    : null;
const IMAGES_PER_DISTRICT = 6;
const MIN_CANDIDATES = 4;
// Escalate outward only as far as needed to find enough candidates - Geograph's own max radius is 20km, but a photo that
// far away rarely still represents a specific small postcode district, so this is intentionally biased tight.
const SEARCH_RADII_KM = [1, 3, 6, 10, 20];
const REQUEST_DELAY_MS = 300;

// Only outcodes a debug run should touch, e.g. `--outcode=TW11,TW9`.
const outcodeFilterArg = process.argv.find((a) => a.startsWith("--outcode="));
const outcodeFilter = outcodeFilterArg ? new Set(outcodeFilterArg.slice("--outcode=".length).split(",").map((o) => o.trim().toUpperCase())) : null;

interface GeographItem {
  title: string;
  link: string;
  author: string;
  guid: string;
  date: number;
  imageTaken?: string;
  tags?: string;
  lat: number;
  long: number;
  thumb: string;
  licence: string;
}

interface GeographResponse {
  items?: GeographItem[];
}

interface OverrideEntry {
  slug: string;
  include?: string[];
  exclude?: string[];
  locked?: boolean;
}

interface Overrides {
  include: Set<string>;
  exclude: Set<string>;
  locked: boolean;
}

async function loadOverrides(): Promise<Map<string, Overrides>> {
  const result = new Map<string, Overrides>();
  let parsed: { overrides?: OverrideEntry[] };
  try {
    parsed = JSON.parse(await readFile(MANUAL_OVERRIDES_PATH, "utf-8")) as { overrides?: OverrideEntry[] };
  } catch {
    return result;
  }
  for (const entry of parsed.overrides ?? []) {
    if (!entry.slug) continue;
    result.set(entry.slug, { include: new Set(entry.include ?? []), exclude: new Set(entry.exclude ?? []), locked: entry.locked ?? false });
  }
  return result;
}

async function loadUploadManifest(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await readFile(UPLOAD_MANIFEST_PATH, "utf-8")) as string[]);
  } catch {
    return new Set();
  }
}

async function searchNearby(lat: number, long: number, distanceKm: number): Promise<GeographItem[]> {
  const url = `https://api.geograph.org.uk/syndicator.php?key=${API_KEY}&location=${lat},${long}&distance=${distanceKm}&format=JSON&perpage=100`;
  const data = await withRetry(() => fetchJson<GeographResponse>(url));
  return data.items ?? [];
}

// Geograph's own topic taxonomy (seen live in the "tags" field, e.g. "subject:road?top:Housing, Dwellings?top:Suburb,
// Urban fringe") - nudges the scoring toward photos that read as a place (streets, buildings, town centres) over ones
// that happen to be nearby but aren't really "of" the district (pure farmland, industrial interiors, aerial shots).
const GOOD_TAG_PATTERN = /housing|suburb|urban|road|street|town|village|shop|retail|church|chapel|school|park|green space|historic|civic|railway station|bus/i;
const WEAK_TAG_PATTERN = /farm|agricultur|industr|pylon|electricity|sewage|aerial|derelict|quarry/i;

function tagScore(tags: string | undefined): number {
  if (!tags) return 0;
  if (GOOD_TAG_PATTERN.test(tags)) return 2;
  if (WEAK_TAG_PATTERN.test(tags)) return -2;
  return 0;
}

function recencyScore(imageTaken: string | undefined): number {
  const year = imageTaken ? Number(imageTaken.slice(0, 4)) : NaN;
  if (Number.isNaN(year)) return 0;
  if (year >= 2025) return 3;
  if (year === 2024) return 2;
  if (year >= 2021) return 1;
  return 0;
}

/** The full-size ("standard resolution") image URL - Geograph's thumb URLs carry an explicit "_120x120" size suffix
 * that, dropped, resolves to the same photo at its normal display size (confirmed live against the API). */
function fullSizeUrl(thumb: string): string {
  return thumb.replace(/_\d+x\d+(?=\.\w+$)/, "");
}

interface ScoredItem {
  item: GeographItem;
  score: number;
  distanceKm: number;
}

function scoreAndRank(items: GeographItem[], lat: number, long: number): ScoredItem[] {
  const scored = items.map((item) => {
    const distanceKm = haversineKm(lat, long, item.lat, item.long);
    const score = recencyScore(item.imageTaken) + tagScore(item.tags) - distanceKm * 0.15;
    return { item, score, distanceKm };
  });

  // Collapse near-duplicate submissions from the same photographer (a burst of near-identical shots from one visit).
  const deduped: ScoredItem[] = [];
  for (const candidate of scored.sort((a, b) => b.score - a.score)) {
    const isDuplicate = deduped.some(
      (kept) => kept.item.author === candidate.item.author && nameSimilarity(normalizeName(kept.item.title), normalizeName(candidate.item.title)) >= 0.6
    );
    if (!isDuplicate) deduped.push(candidate);
  }
  return deduped.sort((a, b) => b.score - a.score);
}

async function findCandidates(lat: number, long: number): Promise<ScoredItem[]> {
  for (const distanceKm of SEARCH_RADII_KM) {
    const items = await searchNearby(lat, long, distanceKm);
    await sleep(REQUEST_DELAY_MS);
    const ranked = scoreAndRank(items, lat, long);
    if (ranked.length >= MIN_CANDIDATES || distanceKm === SEARCH_RADII_KM[SEARCH_RADII_KM.length - 1]) return ranked;
  }
  return [];
}

async function downloadPhoto(item: GeographItem): Promise<Buffer> {
  const cachePath = path.join(RAW_DIR, `${item.guid}.jpg`);
  if (existsSync(cachePath)) return readFile(cachePath);
  const res = await fetch(fullSizeUrl(item.thumb), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GET ${fullSizeUrl(item.thumb)} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cachePath, buf);
  return buf;
}

let r2CredentialsMissingWarned = false;

async function uploadToR2(key: string, filePath: string): Promise<boolean> {
  if (!r2Client) {
    if (!r2CredentialsMissingWarned) {
      logStep(STEP, "WARNING: R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY not set - skipping R2 uploads this run (district-images.json is still written with the URLs the photos WILL be at once uploaded).");
      r2CredentialsMissingWarned = true;
    }
    return false;
  }
  try {
    const body = await readFile(filePath);
    await r2Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "image/webp" }));
    return true;
  } catch (err) {
    logStep(STEP, `WARNING: R2 upload failed for ${key}: ${(err as Error).message}`);
    return false;
  }
}

async function processPhoto(item: GeographItem, outcodeSlug: string, uploaded: Set<string>): Promise<BannerImage | null> {
  const key = `geograph/${outcodeSlug}/${item.guid}.webp`;
  const publicSrc = `/images/${key}`;
  const webpPath = path.join(RAW_DIR, `${item.guid}_${outcodeSlug}.webp`);

  let width: number;
  let height: number;
  try {
    if (!existsSync(webpPath)) {
      const original = await downloadPhoto(item);
      const resized = sharp(original).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 });
      await resized.toFile(webpPath);
    }
    const meta = await sharp(webpPath).metadata();
    width = meta.width ?? 640;
    height = meta.height ?? 480;
  } catch (err) {
    logStep(STEP, `WARNING: could not process photo ${item.guid}: ${(err as Error).message}`);
    return null;
  }

  if (!uploaded.has(key)) {
    if (await uploadToR2(key, webpPath)) uploaded.add(key);
  }

  return {
    src: publicSrc,
    width,
    height,
    credit: `${item.author} · CC BY-SA 2.0 · Geograph`,
    creditUrl: `https://www.geograph.org.uk/photo/${item.guid}`,
    license: "CC BY-SA 2.0",
  };
}

async function main() {
  if (!API_KEY) {
    // Optional data source: a full `npm run ingest` shouldn't fail for everyone just because this one key isn't set
    // yet (same spirit as fetch-schools.ts/fetch-health.ts proceeding without Ofsted/CQC data when their source is
    // unreachable) - district/borough pages just keep whatever's already in district-images.json (or fall back to
    // the Wikipedia banner, or show nothing).
    logStep(STEP, "WARNING: GEOGRAPH_API_KEY is not set - skipping (existing data/processed/district-images.json, if any, is left untouched).");
    return;
  }

  const outcodeIndex = await loadOutcodeIndex();
  const overrides = await loadOverrides();
  const uploaded = await loadUploadManifest();

  let existing: Record<string, BannerImage[]> = {};
  try {
    existing = JSON.parse(await readFile(OUT_PATH, "utf-8")) as Record<string, BannerImage[]>;
  } catch {
    // first run
  }

  const result: Record<string, BannerImage[]> = { ...existing };

  for (const [outcode, entry] of outcodeIndex) {
    if (outcodeFilter && !outcodeFilter.has(outcode)) continue;
    const slug = entry.outcode.slug;
    const override = overrides.get(slug);
    if (override?.locked) {
      logStep(STEP, `${outcode}: locked via geograph-overrides.json - leaving as-is.`);
      continue;
    }

    const ranked = await findCandidates(entry.outcode.latitude, entry.outcode.longitude);
    let chosen = ranked.filter((r) => !override?.exclude.has(r.item.guid)).slice(0, IMAGES_PER_DISTRICT);

    // Manually included IDs are looked up directly (Details API) and prepended, ahead of the automatic picks.
    if (override?.include.size) {
      const alreadyChosen = new Set(chosen.map((c) => c.item.guid));
      for (const photoId of override.include) {
        if (alreadyChosen.has(photoId)) continue;
        try {
          const detail = await withRetry(() => fetchJson<{ title: string; user: string; img: { src: string; width: number; height: number } }>(`https://api.geograph.org.uk/api/photo/${photoId}/${API_KEY}?format=json`));
          chosen.unshift({
            item: { title: detail.title, link: `https://www.geograph.org.uk/photo/${photoId}`, author: detail.user, guid: photoId, date: 0, lat: entry.outcode.latitude, long: entry.outcode.longitude, thumb: detail.img.src, licence: "CC BY-SA 2.0" },
            score: Infinity,
            distanceKm: 0,
          });
        } catch (err) {
          logStep(STEP, `WARNING: could not look up manually-included photo ${photoId} for ${outcode}: ${(err as Error).message}`);
        }
      }
      chosen = chosen.slice(0, IMAGES_PER_DISTRICT);
    }

    const images: BannerImage[] = [];
    for (const candidate of chosen) {
      const image = await processPhoto(candidate.item, slug, uploaded);
      if (image) images.push(image);
    }

    if (images.length > 0) result[slug] = images;
    logStep(STEP, `${outcode}: ${images.length} photo(s) selected (${ranked.length} candidates considered).`);
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(result, null, 2));
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(UPLOAD_MANIFEST_PATH, JSON.stringify([...uploaded], null, 2));
  logStep(STEP, `Wrote ${OUT_PATH} (${Object.keys(result).length} districts with photos).`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
