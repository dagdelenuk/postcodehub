import type { BannerImage } from "../../../src/lib/types.js";

// The on-disk shape both district-images.json and place-images.json use - a named list of {slug, images}, not a bare
// Record<slug, images[]> - because that's what Decap CMS's file-collection + list widget can actually edit (a "files"
// collection's fields map onto named top-level keys in the JSON file; it can't enumerate an object's own dynamic keys).
// Same convention data/manual/banner-overrides.json already established for the Wikimedia banners.
export interface ImageOverrideEntry {
  slug: string;
  images: BannerImage[];
}

export interface ImageOverridesFile {
  overrides: ImageOverrideEntry[];
}

export function toOverridesFile(record: Record<string, BannerImage[]>): ImageOverridesFile {
  return { overrides: Object.entries(record).map(([slug, images]) => ({ slug, images })) };
}

export function fromOverridesFile(parsed: Partial<ImageOverridesFile> | null | undefined): Record<string, BannerImage[]> {
  const result: Record<string, BannerImage[]> = {};
  for (const entry of parsed?.overrides ?? []) {
    if (entry.slug && entry.images?.length > 0) result[entry.slug] = entry.images;
  }
  return result;
}
