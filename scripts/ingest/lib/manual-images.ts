import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BannerImage } from "../../../src/lib/types.js";

// district-images/ and place-images/ hold one small JSON file per slug (data/processed/district-images/tw11.json etc.),
// not one big combined file - that's what lets Decap CMS's "folder" collection type give a real per-entry, searchable list
// in /admin (a "files" collection with one huge list field, the earlier approach, has no way to search within the list).

export interface ImageEntry {
  slug: string;
  images: BannerImage[];
}

/** Every entry currently in a photo folder (district-images/ or place-images/), keyed by slug. */
export async function readImageDir(dir: string): Promise<Record<string, BannerImage[]>> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }
  const result: Record<string, BannerImage[]> = {};
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(await readFile(path.join(dir, file), "utf-8")) as Partial<ImageEntry>;
      if (entry.slug && entry.images && entry.images.length > 0) result[entry.slug] = entry.images;
    } catch {
      // skip an unreadable/hand-broken file rather than fail the whole run
    }
  }
  return result;
}

export async function writeImageFile(dir: string, slug: string, images: BannerImage[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  // `image` (the first photo) and `photoCount` are redundant with `images` - they exist purely so Decap CMS's folder
  // collections can show a real thumbnail and a sortable photo count in list/card view (Decap only renders a card
  // thumbnail for a field literally named "image", and has no way to display/sort by a list field's length itself).
  const entry = { slug, image: images[0]?.src ?? "", photoCount: images.length, images };
  await writeFile(path.join(dir, `${slug}.json`), JSON.stringify(entry, null, 2));
}
