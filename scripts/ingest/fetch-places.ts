import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";
import { fetchOsmFeatures, type OsmTagFilter } from "./lib/osm-amenities.js";
import type { PlaceCategory } from "../../src/lib/types.js";

const STEP = "places";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../data/raw");

// Order = category precedence when an element matches more than one filter
// (e.g. a venue tagged both leisure=sports_centre and amenity=community_centre
// resolves to whichever of these is listed first). Schools, GPs/dentists/
// pharmacies/hospitals, and police/fire are already covered elsewhere on the
// site - this covers the remaining civic/leisure/everyday-errand gap.
const PLACE_FILTERS: OsmTagFilter[] = [
  { key: "leisure", value: "park", category: "park" satisfies PlaceCategory },
  { key: "amenity", value: "library", category: "library" satisfies PlaceCategory },
  { key: "amenity", value: "community_centre", category: "community-hub" satisfies PlaceCategory },
  { key: "leisure", value: "sports_centre", category: "leisure-centre" satisfies PlaceCategory },
  { key: "leisure", value: "playground", category: "playground" satisfies PlaceCategory },
  { key: "amenity", value: "place_of_worship", category: "place-of-worship" satisfies PlaceCategory },
  { key: "amenity", value: "post_office", category: "post-office" satisfies PlaceCategory },
  { key: "tourism", value: "museum", category: "culture" satisfies PlaceCategory },
  { key: "amenity", value: "arts_centre", category: "culture" satisfies PlaceCategory },
  { key: "amenity", value: "theatre", category: "culture" satisfies PlaceCategory },
  { key: "amenity", value: "cinema", category: "culture" satisfies PlaceCategory },
  { key: "amenity", value: "marketplace", category: "market" satisfies PlaceCategory },
];

// PLACES_CATEGORIES=park,library ... subsets the filter list for a cheap dry
// run; PLACES_LIMIT=500 truncates candidates before reverse-geocoding so a
// dry run doesn't burn through a full postcodes.io pass. Both no-ops unset.
function activeFilters(): OsmTagFilter[] {
  const only = process.env.PLACES_CATEGORIES?.split(",").map((s) => s.trim());
  return only ? PLACE_FILTERS.filter((f) => only.includes(f.category)) : PLACE_FILTERS;
}

async function main() {
  const filters = activeFilters();
  const limit = process.env.PLACES_LIMIT ? Number(process.env.PLACES_LIMIT) : undefined;
  const features = await fetchOsmFeatures(STEP, filters, { requireName: true, limit });

  const places = features.map((f) => ({
    name: f.name,
    category: f.category as PlaceCategory,
    address: f.address,
    postcode: f.postcode,
    latitude: f.latitude,
    longitude: f.longitude,
    website: f.website,
    borough: f.borough,
    distanceKm: 0, // filled in per-outcode at merge time
  }));

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(RAW_DIR, "places.json");
  await writeFile(outPath, JSON.stringify(places, null, 2));
  logStep(STEP, `Wrote ${outPath} (${places.length} places).`);
}

main().catch((err) => {
  console.error(`[${STEP}] FAILED:`, err);
  process.exit(1);
});
