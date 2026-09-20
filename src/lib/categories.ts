import type { CategoryKey } from "./types";

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: string;
  description: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: "health", label: "Health", icon: "🏥", description: "GP surgeries, dentists, and pharmacies" },
  { key: "schools", label: "Schools", icon: "🏫", description: "Local schools and Ofsted ratings" },
  { key: "safety", label: "Safety", icon: "🚨", description: "Crime statistics and trends" },
  { key: "places", label: "Places", icon: "📍", description: "Parks, libraries, leisure centres, and community spaces" },
  { key: "food", label: "Food & Hospitality", icon: "🍽️", description: "Hygiene ratings for local restaurants, cafes, pubs and shops" },
  { key: "property", label: "Statistics", icon: "📊", description: "Recent property sales, rents and house prices" },
  { key: "transport", label: "Transport", icon: "🚌", description: "Live TfL status and transport links" },
  { key: "representatives", label: "Representatives", icon: "🏛️", description: "Your MP and local councillors" },
  { key: "services", label: "Council services", icon: "🗑️", description: "Bin collection days, Council Tax, parking and other council services" },
  { key: "events", label: "Events", icon: "📅", description: "Local events and things to do" },
  { key: "history", label: "History", icon: "📜", description: "Local heritage and history" },
  { key: "planning", label: "Planning", icon: "🏗️", description: "Planning applications" },
];
