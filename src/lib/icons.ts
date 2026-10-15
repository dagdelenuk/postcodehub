// Tabler outline icons, inlined at build time (no CDN, no webfont). Add an entry here to use a new icon via <Icon name="..." />.
import overview from "@tabler/icons/outline/layout-dashboard.svg?raw";
import health from "@tabler/icons/outline/heartbeat.svg?raw";
import schools from "@tabler/icons/outline/school.svg?raw";
import safety from "@tabler/icons/outline/shield-check.svg?raw";
import places from "@tabler/icons/outline/map-pin.svg?raw";
import food from "@tabler/icons/outline/tools-kitchen-2.svg?raw";
import statistics from "@tabler/icons/outline/chart-bar.svg?raw";
import transport from "@tabler/icons/outline/train.svg?raw";
import representatives from "@tabler/icons/outline/building-bank.svg?raw";
import services from "@tabler/icons/outline/trash.svg?raw";
import events from "@tabler/icons/outline/calendar-event.svg?raw";
import history from "@tabler/icons/outline/history.svg?raw";
import planning from "@tabler/icons/outline/ruler-measure.svg?raw";
import menu from "@tabler/icons/outline/menu-2.svg?raw";
import search from "@tabler/icons/outline/search.svg?raw";
import chevron_right from "@tabler/icons/outline/chevron-right.svg?raw";
import home from "@tabler/icons/outline/home.svg?raw";
import more from "@tabler/icons/outline/dots.svg?raw";

export const ICONS = {
  "overview": overview,
  "health": health,
  "schools": schools,
  "safety": safety,
  "places": places,
  "food": food,
  "statistics": statistics,
  "transport": transport,
  "representatives": representatives,
  "services": services,
  "events": events,
  "history": history,
  "planning": planning,
  "menu": menu,
  "search": search,
  "chevron-right": chevron_right,
  "home": home,
  "more": more,
} as const;

export type IconName = keyof typeof ICONS;
