/**
 * Mireye Earth request/response types.
 *
 * Hand-written against the live OpenAPI spec (https://api.mireye.com/v1/openapi.json,
 * Mireye Earth 0.15.0) and the endpoint docs at https://docs.mireye.ai.
 *
 * The spec types the *requests* precisely but leaves every 200 response as an
 * open object, so response shapes here come from the documented examples. Where
 * the docs and the spec disagree the docs win, and anything uncertain is
 * optional rather than required — a missing field must degrade, never throw.
 */

export type MireyeConfidence = "high" | "medium" | "low";

/** Mireye's standard error envelope: {"detail": {error, message, retryable}}. */
export interface MireyeErrorBody {
  detail?: {
    error?: string;
    message?: string;
    retryable?: boolean;
    caller_guidance?: string;
    errors?: unknown;
  };
}

// --- POST /v1/geocode -------------------------------------------------------

export interface GeocodeRequest {
  /** 1–256 chars. Always include city + state or ZIP; a bare street line is
   *  the single most common cause of a confident match on the wrong town. */
  address: string;
}

/** How the coordinate was derived. `rooftop`/`nearest_rooftop_match` are
 *  parcel-grade; everything else is street-grade or worse. */
export type AccuracyType =
  | "rooftop"
  | "nearest_rooftop_match"
  | "point"
  | "range_interpolation"
  | "intersection"
  | "street_center"
  | "place";

export interface GeocodeResponse {
  lat: number;
  lng: number;
  /** Provider similarity 0–1. Below 0.8 is refused upstream, not returned. */
  accuracy: number | null;
  accuracy_type: AccuracyType | string;
  match_type: string | null;
  normalized_address: string | null;
  /** `geocodio` normally; `census` means we are on the degraded fallback. */
  provider: string;
  /** The authority the coordinate came from, distinct from `provider`. */
  source?: string | null;
}

// --- POST /v1/lookup --------------------------------------------------------

export interface LookupRequest {
  input: string;
  include_parcel?: boolean;
  kind?: "address" | "coord" | "apn" | null;
}

export interface MireyeParcel {
  parcel_id?: string | null;
  apn?: string | null;
  address?: string | null;
  area_m2?: number | null;
  geometry?: unknown;
  geometry_wkt?: string | null;
  owner?: string | null;
  zoning?: string | null;
  land_use?: string | null;
  assessed_value_usd?: number | null;
  last_sale_date?: string | null;
  last_sale_price_usd?: number | null;
  transaction_count?: number | null;
  match_type?: string | null;
  match_distance_m?: number | null;
  match_radius_m?: number | null;
  source?: string | null;
}

export interface CountyMarket {
  population?: number | null;
  population_growth_1yr_pct?: number | null;
  net_domestic_migration?: number | null;
  building_permits_total_annual?: number | null;
  building_permits_sf_annual?: number | null;
  building_permits_yoy_pct?: number | null;
  hpi_yoy_pct?: number | null;
  employment_total?: number | null;
  employment_yoy_pct?: number | null;
  median_household_income_usd?: number | null;
}

export interface LookupResponse {
  /** The typed refusal path, native to the API. Never a silent pick. */
  disposition: "resolved" | "clarify" | "no_match";
  lat?: number;
  lng?: number;
  resolved_address?: string | null;
  resolved_location?: { lat: number; lng: number; source: string };

  county_fips?: string | null;
  county?: string | null;
  state?: string | null;
  state_fips?: string | null;
  tract_geoid?: string | null;
  block_group_geoid?: string | null;
  congressional_district?: string | null;
  cbsa_name?: string | null;
  cbsa_code?: string | null;

  elevation_m?: number | null;
  fema_flood_zone?: string | null;
  within_floodplain?: boolean | null;
  coastal_high_hazard?: boolean | null;

  county_market?: CountyMarket | null;
  in_opportunity_zone?: boolean | null;
  timezone?: string | null;

  parcel?: MireyeParcel | null;
  parcel_unavailable?: boolean;
  parcel_unavailable_reason?: string | null;

  match_method?: string | null;
  confidence?: number | null;

  /** Present only on `clarify`, up to 3. */
  candidates?: Array<{
    resolved_address: string;
    lat: number;
    lng: number;
    confidence?: number;
  }> | null;
  /** Present only on `no_match`. */
  reason?: string | null;
  hint?: string | null;
}

// --- POST /v1/fetch ---------------------------------------------------------

export type FetchPreset =
  | "terrain"
  | "flood_risk"
  | "wildfire_underwrite"
  | "land_cover"
  | "site_selection"
  | "building_lookup"
  | "points_of_interest"
  | "utilities"
  | "boundaries"
  | "natural_hazard";

export interface FetchRequest {
  fields?: string[] | null;
  preset?: FetchPreset | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

/** Every field arrives with its own provenance — this is the shape our
 *  `Provenance` type mirrors, and why citation is cheap here. */
export interface MireyeField {
  value: unknown;
  unit?: string | null;
  source?: string | null;
  source_url?: string | null;
  confidence?: MireyeConfidence | null;
  dataset_vintage?: string | null;
  notes?: string | null;
  status?: string | null;
  ttl_seconds?: number | null;
}

export interface FetchResponse {
  fields: Record<string, MireyeField>;
  status?: string;
  partial_failures?: Array<{ field: string; reason: string }>;
  resolved_location?: { lat: number; lng: number; source: string };
}

// --- POST /v1/proximity -----------------------------------------------------

export interface ResolvedPoint {
  query: string;
  lat: number | null;
  lng: number | null;
  formatted_address?: string | null;
  accuracy_type?: string | null;
  accuracy?: number | null;
  error?:
    | "unresolvable_input"
    | "low_confidence_resolution"
    | "geocoding_failed"
    | null;
}

export interface ScreenOp {
  op: "screen";
  /** 1–500 locators: "lat,lng" strings or full US street addresses. */
  origins: string[];
  /** 1–10 locators. */
  anchors: string[];
  max_minutes: number;
  min_minutes?: number | null;
  /** Refuse the request if it would cost more than this. Checked BEFORE the
   *  driving matrix is charged, so it is a real ceiling, not a warning. */
  max_credits?: number | null;
}

export interface ScreenResponse {
  op: "screen";
  survivors: Array<{
    origin_index: number;
    best_anchor_index: number;
    best_duration_seconds: number;
    best_duration_minutes: number;
  }>;
  /** Non-survivors carry their own best duration — the near miss is what lets
   *  us interpolate a boundary instead of drawing a stairstep. */
  screened_out: Array<{
    origin_index: number;
    best_duration_seconds: number | null;
    best_duration_minutes: number | null;
  }>;
  resolved_origins?: ResolvedPoint[];
  resolved_anchors?: ResolvedPoint[];
  paid_driving_calcs: number;
  notes: string[];
}

export interface LaborShedOp {
  op: "labor_shed";
  origin: string;
  /** 5–90. */
  minutes: number;
  max_credits?: number | null;
  /** Price the shed without running or paying for it. Exact, not a guess. */
  estimate?: boolean;
}

export interface LaborShedResponse {
  op: "labor_shed";
  origin: ResolvedPoint;
  civilian_labor_force: number;
  population: number;
  tracts_counted: number;
  tracts_matrix_queried: number;
  tracts_unreachable: number;
  minutes: number;
  paid_driving_calcs: number;
  notes: string[];
}

export interface DistanceOp {
  op: "distance";
  origins: string[];
  destinations: string[];
  mode?: "driving" | "straightline";
  max_credits?: number | null;
}

export interface DistanceResponse {
  op: "distance";
  legs: Array<{
    origin_index: number;
    destination_index: number;
    distance_miles: number | null;
    distance_km: number | null;
    duration_seconds: number | null;
    duration_minutes: number | null;
    flag?: string | null;
  }>;
  resolved_origins?: ResolvedPoint[];
  resolved_destinations?: ResolvedPoint[];
  paid_driving_calcs: number;
  notes: string[];
}

export type ProximityOp = ScreenOp | LaborShedOp | DistanceOp;

// --- POST /v1/ask -----------------------------------------------------------

export interface AskRequest {
  /** Send lat+lng OR address, never both. */
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  question: string;
  include_trace?: boolean;
}

export interface AskResponse {
  lat: number;
  lng: number;
  question: string;
  answered_at: string;
  answer: string;
  confidence: MireyeConfidence;
  citations: Array<{
    source: string;
    source_url?: string;
    fields?: string[];
    fetched_at: string;
    confidence?: MireyeConfidence;
  }>;
  fields_used?: string[];
  data_gaps?: Array<{ field: string; reason: string }>;
  resolved_location?: { lat: number; lng: number; source: string };
  trace?: unknown;
}
