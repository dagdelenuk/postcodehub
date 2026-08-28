export interface HierarchyOutcode {
  outcode: string;
  slug: string;
  latitude: number;
  longitude: number;
  wards: string[];
  parliamentaryConstituency: string;
  /**
   * True when this borough has the largest real-postcode share of this
   * outcode (from ONS NSPL, not just "touches it at all") - only
   * primary-borough outcodes get summed into that borough's aggregate
   * totals (getBoroughSummary), so a boundary outcode's stats aren't
   * double-counted or inflate a borough it barely reaches into.
   */
  isPrimaryBorough: boolean;
}

export interface HierarchyBorough {
  name: string;
  slug: string;
  outcodes: HierarchyOutcode[];
}

export interface HierarchyCity {
  name: string;
  slug: string;
  boroughs: HierarchyBorough[];
}

export interface Hierarchy {
  cities: HierarchyCity[];
}

export interface BannerImage {
  src: string;
  width: number;
  height: number;
  credit: string;
  creditUrl: string;
  license: string;
}

export type Banners = Record<string, BannerImage[]>;

export interface GpSurgery {
  name: string;
  odsCode: string;
  address: string;
  postcode: string;
  telephone?: string;
}

export interface HealthData {
  gpSurgeries: GpSurgery[];
  dentists: GpSurgery[];
  pharmacies: GpSurgery[];
}

export interface School {
  name: string;
  urn: string;
  phaseOfEducation: string;
  ofstedRating: string | null;
  ofstedLastInspection: string | null;
  /** True when Ofsted inspected and graded every individual area under its
   * post-Sept-2024 framework but deliberately publishes no single combined
   * grade - distinct from a school with no current inspection data at all. */
  ofstedNotJudgedUnderNewFramework: boolean;
  /** True when ofstedRating isn't Ofsted's own composite label but was
   * derived because every core area happened to land on the same grade. */
  ofstedRatingDerivedFromAreaGrades: boolean;
  address: string;
  postcode: string;
  numberOfPupils: number | null;
  schoolCapacity: number | null;
}

export interface SchoolsData {
  schools: School[];
}

export interface CrimeMonthSummary {
  month: string;
  totalCrimes: number;
  violentCrimes: number;
  propertyCrimes: number;
}

export interface CrimeData {
  monthlyTrend: CrimeMonthSummary[];
  categoryBreakdown: Record<string, number>;
  totalLast12Months: number;
}

export interface PropertySale {
  address: string;
  postcode: string;
  price: number;
  dateOfTransfer: string;
  propertyType: string;
  newBuild: boolean;
}

export interface PropertyData {
  sales: PropertySale[];
  averagePrice: number | null;
  medianPrice: number | null;
}

export interface Representative {
  role: "MP" | "Councillor";
  name: string;
  party: string;
  ward?: string;
  constituency?: string;
  contactUrl?: string;
}

export interface RepresentativesData {
  representatives: Representative[];
}

export interface PlanningApplication {
  reference: string;
  address: string;
  description: string;
  status: string;
  dateReceived: string;
  url?: string;
}

export interface PlanningData {
  applications: PlanningApplication[];
  /** Deep link to the council's live planning register, when we couldn't source structured rows. */
  searchUrl: string | null;
}

export interface Place {
  name: string;
  category: "library" | "park" | "leisure-centre" | "community-hub";
  address: string;
  description: string;
}

export interface PlacesData {
  places: Place[];
}

export interface CommunityEvent {
  name: string;
  date: string;
  location: string;
  description: string;
}

export interface EventsData {
  events: CommunityEvent[];
  /** Deep link to a live community events listing, when we don't have curated dated events. */
  listingUrl: string | null;
}

export interface HistoryData {
  summary: string;
  keyFacts: string[];
}

export interface OutcodeData {
  outcode: string;
  slug: string;
  city: string;
  borough: string;
  latitude: number;
  longitude: number;
  wards: string[];
  health: HealthData;
  schools: SchoolsData;
  safety: CrimeData;
  property: PropertyData;
  representatives: RepresentativesData;
  planning: PlanningData;
  places: PlacesData;
  events: EventsData;
  history: HistoryData;
}

export const CATEGORY_KEYS = [
  "health",
  "schools",
  "safety",
  "transport",
  "planning",
  "representatives",
  "places",
  "events",
  "property",
  "history",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];
