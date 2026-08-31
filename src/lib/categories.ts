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
  { key: "transport", label: "Transport", icon: "🚌", description: "Live TfL status and transport links" },
  { key: "property", label: "Housing", icon: "🏠", description: "Recent property sales" },
  { key: "planning", label: "Planning", icon: "🏗️", description: "Planning applications" },
  { key: "representatives", label: "Representatives", icon: "🏛️", description: "Your MP and local councillors" },
  { key: "places", label: "Places", icon: "📍", description: "Parks, landmarks, and community hubs" },
  { key: "events", label: "Events", icon: "📅", description: "Local events and things to do" },
  { key: "history", label: "History", icon: "📜", description: "Local heritage and history" },
];
