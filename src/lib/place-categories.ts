import type { PlaceCategory } from "./types";

export interface PlaceCategoryDef {
  key: PlaceCategory;
  label: string;
  emoji: string;
  colorClass: string;
}

// Order here is display order on the places page (filter pills and section
// order), independent of fetch-places.ts's OSM-filter precedence order.
export const PLACE_CATEGORIES: PlaceCategoryDef[] = [
  { key: "park", label: "Parks", emoji: "🌳", colorClass: "text-emerald-700" },
  { key: "library", label: "Libraries", emoji: "📚", colorClass: "text-amber-700" },
  { key: "community-hub", label: "Community hubs", emoji: "🏛️", colorClass: "text-indigo-700" },
  { key: "leisure-centre", label: "Leisure centres", emoji: "🏊", colorClass: "text-sky-700" },
  { key: "playground", label: "Playgrounds", emoji: "🛝", colorClass: "text-orange-700" },
  { key: "place-of-worship", label: "Places of worship", emoji: "⛪", colorClass: "text-violet-700" },
  { key: "post-office", label: "Post offices", emoji: "✉️", colorClass: "text-red-700" },
  { key: "culture", label: "Culture", emoji: "🎭", colorClass: "text-rose-700" },
  { key: "pub", label: "Pubs", emoji: "🍺", colorClass: "text-yellow-700" },
  { key: "market", label: "Markets", emoji: "🛒", colorClass: "text-teal-700" },
];

export const PLACE_CATEGORY_MAP: Record<PlaceCategory, PlaceCategoryDef> = Object.fromEntries(
  PLACE_CATEGORIES.map((c) => [c.key, c])
) as Record<PlaceCategory, PlaceCategoryDef>;
