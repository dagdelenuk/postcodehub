export interface HierarchyOutcode {
  outcode: string;
  slug: string;
  latitude: number;
  longitude: number;
  /**
   * Wards actually inside THIS borough's slice of the district (tallied
   * per (outcode, LAD, ward) from NSPL postcode units - wards never cross
   * a LAD boundary, so this is exact, not approximated). For a split
   * district, two boroughs' copies of the same outcode have different
   * ward lists; for a non-split district there's only one slice anyway.
   */
  wards: string[];
  /** Royal Mail post town for this district, e.g. "Teddington" for TW11. */
  postTown: string;
  parliamentaryConstituency: string;
  /**
   * True when this borough has the largest real-postcode share of this
   * outcode (from ONS NSPL, not just "touches it at all") - only
   * primary-borough outcodes get summed into that borough's aggregate
   * totals (getBoroughSummary), so a boundary outcode's stats aren't
   * double-counted or inflate a borough it barely reaches into.
   */
  isPrimaryBorough: boolean;
  /** This borough's share of the district's real small-user postcodes, 0-100, 1dp. */
  sharePercent: number;
  /** Real small-user postcode units of this district inside this borough. */
  unitCount: number;
  /** Units of this district across every LAD it touches - the denominator of sharePercent. */
  districtUnitCount: number;
  /**
   * True when 2+ London boroughs each clear the same threshold that
   * decides whether they get a page at all - i.e. this district has at
   * least one sibling page under another borough today.
   */
  isSplit: boolean;
  /** Non-London local authorities that also clear the threshold for this district - recorded for provenance, no page/link exists for these. */
  outsideLondon?: { name: string; sharePercent: number }[];
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
  /** Geocoded from postcode at merge time - null if the postcode couldn't be resolved. */
  latitude: number | null;
  longitude: number | null;
}

export interface HealthData {
  gpSurgeries: GpSurgery[];
  dentists: GpSurgery[];
  pharmacies: GpSurgery[];
  hospitals: GpSurgery[];
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
  /** Geocoded from postcode at merge time - null if the postcode couldn't be resolved. */
  latitude: number | null;
  longitude: number | null;
}

export interface SchoolsData {
  schools: School[];
}

export interface ChildcareProvider {
  name: string;
  urn: string;
  /** Free text from Ofsted's register, e.g. "Childminder", "Childcare on non-domestic premises". */
  providerType: string;
  ofstedRating: string | null;
  ofstedLastInspection: string | null;
  registeredPlaces: number | null;
  address: string;
  postcode: string;
  /** Geocoded from postcode at merge time - null if the postcode couldn't be resolved. */
  latitude: number | null;
  longitude: number | null;
}

export interface ChildcareData {
  providers: ChildcareProvider[];
}

export interface CrimeMonthSummary {
  month: string;
  totalCrimes: number;
  violentCrimes: number;
  propertyCrimes: number;
}

export interface PoliceStation {
  name: string;
  address: string;
  postcode: string;
  telephone?: string;
  latitude: number;
  longitude: number;
  /** Distance from the outcode this record is attached to, in kilometres. */
  distanceKm: number;
}

/** Same shape as a police station - name, address, and a distance from the outcode/borough it's attached to. */
export type FireStation = PoliceStation;

export interface CrimeData {
  monthlyTrend: CrimeMonthSummary[];
  categoryBreakdown: Record<string, number>;
  totalLast12Months: number;
  policeStations: PoliceStation[];
  fireStations: FireStation[];
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

export interface ElectionCandidateResult {
  name: string;
  party: string;
  votes: number;
  votePercent: number;
  elected: boolean;
}

export interface WardElectionResult {
  ward: string;
  year: number;
  turnoutVotes: number | null;
  turnoutPercent: number | null;
  candidates: ElectionCandidateResult[];
}

export interface LocalElectionData {
  boroughName: string;
  /** Year of the most recent borough-wide election (all council seats up for election). */
  lastElectionYear: number;
  lastElectionTurnoutPercent: number;
  lastElectionTurnoutVotes: number;
  lastElectionRegisteredElectors: number;
  nextElectionYear: number;
  /** Deep link to the council's own published results, for the full ward-by-ward breakdown. */
  resultsUrl: string;
  /** Year the candidate-level `wards` breakdown below is from - may lag
   * `lastElectionYear` when that election's full vote-by-vote figures aren't
   * sourced yet (current ward councillors are still shown separately, from
   * the live councillor scrape, not from here). */
  wardResultsYear: number;
  wards: WardElectionResult[];
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

export type PlaceCategory =
  | "park"
  | "library"
  | "community-hub"
  | "leisure-centre"
  | "playground"
  | "place-of-worship"
  | "post-office"
  | "culture"
  | "market"
  | "pub";

export interface Place {
  name: string;
  category: PlaceCategory;
  address: string;
  postcode: string;
  latitude: number;
  longitude: number;
  /** Distance from the outcode this record is attached to, in kilometres. */
  distanceKm: number;
  website?: string;
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

export interface NearbyStation {
  name: string;
  modes: string[];
  distanceKm: number;
}

export interface TransportData {
  /** Canonical TfL line ids (tube/DLR/overground/Elizabeth line/tram) within walking distance - empty when none serve this outcode. */
  lines: string[];
  /** Nearest rail/metro stations regardless of mode, nearest-first - shown even when `lines` is empty (e.g. a National Rail-only station). */
  nearbyStations: NearbyStation[];
}

export interface OutcodeData {
  outcode: string;
  slug: string;
  city: string;
  borough: string;
  latitude: number;
  longitude: number;
  wards: string[];
  postTown: string;
  health: HealthData;
  schools: SchoolsData;
  childcare: ChildcareData;
  safety: CrimeData;
  transport: TransportData;
  property: PropertyData;
  representatives: RepresentativesData;
  planning: PlanningData;
  places: PlacesData;
  events: EventsData;
  history: HistoryData;
  /** Not stored in the per-outcode JSON - attached by loadOutcodeData() from food-hygiene.json. */
  food: FoodHygieneData;
  /** Not stored in the per-outcode JSON - attached by loadOutcodeData() from council-services.json. */
  services: CouncilServicesData;
  /** Not stored in the per-outcode JSON - attached by loadOutcodeData() from demographics.json. */
  demographics: DemographicsWithDeprivation | null;
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
  "statistics",
  "food",
  "services",
  "history",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface HpiSeries {
  /** "YYYY-MM", ascending. */
  months: string[];
  /** Average price (£) per month, same length as months. */
  averagePrice: number[];
  /** Latest month's annual % change. */
  annualChange: number | null;
  /** Latest month's average price by property type. */
  byType: { flat: number | null; terraced: number | null; semiDetached: number | null; detached: number | null };
}

export interface HpiData {
  source: string;
  latestMonth: string;
  london: HpiSeries;
  boroughs: Record<string, HpiSeries>;
}

export type RentBedroomKey = "all" | "oneBed" | "twoBed" | "threeBed" | "fourPlusBed";

export interface AreaRents {
  /** Average monthly rent (GBP) and 12-month % change in the latest month. */
  byBedrooms: Record<RentBedroomKey, { price: number | null; annualChange: number | null }>;
  /** Average monthly rent across all property sizes, for the trend chart. */
  history: { months: string[]; price: number[] };
}

export interface RentsFile {
  source: string;
  /** "YYYY-MM" of the latest figures. */
  latestMonth: string;
  london: AreaRents;
  boroughs: Record<string, AreaRents>;
}


export interface FoodEstablishment {
  name: string;
  type: string;
  address: string;
  postcode: string;
  /** FHRS rating, 0 (urgent improvement) to 5 (very good). */
  rating: number;
  ratingDate: string;
  latitude: number | null;
  longitude: number | null;
}

export interface FoodHygieneData {
  establishments: FoodEstablishment[];
}

export interface FoodHygieneFile {
  source: string;
  fetchedAt: string;
  /** Rated consumer-facing premises across all London boroughs, by rating "0".."5". */
  londonCounts: Record<string, number>;
  outcodes: Record<string, FoodEstablishment[]>;
}

export interface BroadbandMetrics {
  /** % of residential premises able to get >=30 Mbit/s. */
  superfast: number;
  /** % able to get >=100 Mbit/s. */
  ultrafast: number;
  /** % able to get full fibre - only published per local authority, null per outcode. */
  fullFibre: number | null;
  /** % able to get >=1 Gbit/s. */
  gigabit: number;
  /** % unable to get 30 Mbit/s. */
  below30: number;
  /** % below the Universal Service Obligation (10 Mbit/s down). */
  belowUso: number;
  /** % of premises by the best download speed available. */
  bands: { under10: number; from10to30: number; from30to300: number; over300: number };
}

export interface BroadbandFile {
  source: string;
  period: string;
  london: BroadbandMetrics;
  boroughs: Record<string, BroadbandMetrics>;
  outcodes: Record<string, BroadbandMetrics & { postcodes: number }>;
}

/** % of premises with coverage, from Ofcom's per-network counts (all four networks vs at least one). */
export interface MobileCoverageMetrics {
  fourGOutdoorAll: number;
  fourGOutdoorAny: number;
  fourGIndoorAll: number;
  fourGIndoorAny: number;
  fiveGOutdoorAll: number;
  fiveGOutdoorAny: number;
  voiceIndoorAll: number;
}

export interface MobileCoverageFile {
  source: string;
  period: string;
  london: MobileCoverageMetrics;
  boroughs: Record<string, MobileCoverageMetrics>;
}

export interface CouncilServicesFile {
  source: string;
  fetchedAt: string;
  services: { slug: string; title: string; group: string; lgsl: number; lgil: number }[];
  /** Keyed by borough slug; `links` maps a service slug to the council's own page for it. */
  councils: Record<string, { name: string; homepage: string; links: Record<string, string> }>;
}

export interface CouncilServiceLink {
  slug: string;
  title: string;
  group: string;
  url: string;
}

export interface CouncilServicesData {
  councilName: string;
  homepage: string;
  links: CouncilServiceLink[];
}

export interface DemographicsMetrics {
  population: number;
  /** % of residents. */
  age: { under15: number; age15to24: number; age25to44: number; age45to64: number; age65plus: number };
  /** % of residents, by broad ethnic group. */
  ethnicity: { white: number; asian: number; black: number; mixed: number; other: number };
  /** % of households. */
  tenure: { owned: number; socialRented: number; privateRented: number };
  /** % of residents aged 16+. */
  qualifications: { degreeLevel: number; none: number };
  /** % of residents aged 16+ (each includes full-time students where they fit). */
  economic: { employed: number; unemployed: number; retired: number; student: number; longTermSick: number; other: number };
  /** % of residents. */
  health: { goodOrBetter: number; bad: number };
}

export interface DemographicsWithDeprivation extends DemographicsMetrics {
  /** % of postcodes in each national IMD decile, index 0 = most deprived 10%. */
  imdDeciles: number[];
}

export interface DemographicsFile {
  source: string;
  london: DemographicsWithDeprivation;
  boroughs: Record<string, DemographicsWithDeprivation>;
  outcodes: Record<string, DemographicsWithDeprivation>;
}

export interface JourneyTimesFile {
  source: string;
  /** Human-readable departure the times were planned for, e.g. "Tuesday 22 September 2026, 08:30". */
  departure: string;
  destinations: { id: string; name: string; area: string }[];
  /** Fastest public transport journey per destination id. `modes` excludes walking; `changes` counts interchanges. */
  outcodes: Record<string, Record<string, { minutes: number; modes: string[]; changes: number }>>;
}
