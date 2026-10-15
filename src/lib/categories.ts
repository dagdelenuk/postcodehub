import type { CategoryKey } from "./types";
import type { IconName } from "./icons";

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** Emoji, still used by cards and stat tiles. */
  icon: string;
  /** Line icon used by the navigation (rail and mobile tab bar) - see src/lib/icons.ts. */
  tabler: IconName;
  description: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: "health", label: "Health", icon: "🏥", tabler: "health", description: "GP surgeries, dentists, and pharmacies" },
  { key: "schools", label: "Schools", icon: "🏫", tabler: "schools", description: "Local schools and Ofsted ratings" },
  { key: "safety", label: "Safety", icon: "🚨", tabler: "safety", description: "Crime statistics and trends" },
  { key: "places", label: "Places", icon: "📍", tabler: "places", description: "Parks, libraries, leisure centres, and community spaces" },
  { key: "food", label: "Food & Hospitality", icon: "🍽️", tabler: "food", description: "Hygiene ratings for local restaurants, cafes, pubs and shops" },
  { key: "statistics", label: "Statistics", icon: "📊", tabler: "statistics", description: "Recent property sales, rents and house prices" },
  { key: "transport", label: "Transport", icon: "🚌", tabler: "transport", description: "Live TfL status and transport links" },
  { key: "representatives", label: "Representatives", icon: "🏛️", tabler: "representatives", description: "Your MP and local councillors" },
  { key: "services", label: "Council services", icon: "🗑️", tabler: "services", description: "Bin collection days, Council Tax, parking and other council services" },
  { key: "events", label: "Events", icon: "📅", tabler: "events", description: "Local events and things to do" },
  { key: "history", label: "History", icon: "📜", tabler: "history", description: "Local heritage and history" },
  { key: "planning", label: "Planning", icon: "🏗️", tabler: "planning", description: "Planning applications" },
];
