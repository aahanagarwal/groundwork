import type { Provenance } from "@/lib/datasource";
import type { EventKind } from "@/lib/scenarios";
import { collection } from "@/lib/store";

/**
 * The runtime shapes, mirroring prisma/schema.prisma so the file-backed store
 * and Postgres hold the same objects. One definition, both backends.
 */

export interface SiteRecord {
  id: string;
  slug: string;
  label: string;
  inputAddress: string;

  resolved: boolean;
  disposition: "resolved" | "clarify" | "no_match" | null;
  resolvedAddress: string | null;
  lat: number | null;
  lng: number | null;
  confidence: number | null;
  matchMethod: string | null;
  accuracyType: string | null;

  county: string | null;
  countyFips: string | null;
  state: string | null;
  tractGeoid: string | null;
  cbsaName: string | null;
  timezone: string | null;
  elevationM: number | null;
  femaFloodZone: string | null;
  withinFloodplain: boolean | null;

  parcelId: string | null;
  parcelApn: string | null;
  parcelAreaM2: number | null;
  parcelOwner: string | null;
  parcelZoning: string | null;
  parcelGeoJson: GeoJSON.Geometry | null;

  countyMarket: Record<string, number | null> | null;
  /** Selected /v1/fetch fields, each keeping Mireye's own per-field citation. */
  siteFields: Record<string, unknown> | null;

  /** Where each block of the above came from. Powers the citation inspector. */
  provenance: Record<string, Provenance>;
  resolvedAt: string | null;
  /** True when the coordinate is a seeded stand-in, not a Mireye match. */
  approximate: boolean;
}

export interface TradeAreaRecord {
  id: string;
  siteId: string;
  minutes: number;
  mode: "driving";
  /** Which engine drew it: "mireye" or "osrm". */
  engine: string;

  polygonGeoJson: GeoJSON.Polygon;
  naiveCircleGeoJson: GeoJSON.Polygon;
  naiveRadiusMiles: number;

  areaSqMi: number;
  naiveAreaSqMi: number;

  method: string;
  bearings: number;
  probesTested: number;
  paidDrivingCalcs: number;
  creditsEstimated: number;
  creditsActual: number;

  accuracyMeanErrorMinutes: number;
  accuracyMaxErrorMinutes: number;

  laborForce: number | null;
  population: number | null;
  naivePopulation: number | null;

  /** Per-bearing detail, kept for the methodology drawer. */
  detail: unknown;
  provenance: Provenance;
  computedAt: string;
}

export interface WorldEventRecord {
  id: string;
  siteId: string;
  scenarioKey: string;
  kind: EventKind;
  label: string;
  startDate: string;
  endDate: string;
  magnitude: number;
  enabled: boolean;
  source: string;
  sourceUrl: string | null;
  meta: Record<string, unknown> | null;
  /**
   * Fingerprint of the scenario fixture block this row was seeded from.
   *
   * Seeded world events are cached in the store so a page load does not
   * re-derive them. That cache used to be unconditional, which meant editing a
   * scenario JSON - adding a competitor, attaching coordinates - changed
   * nothing on screen: the stale rows still answered, forever. Recording what
   * the fixture looked like at seed time lets the loader notice the fixture
   * moved and re-seed. Null on rows written before this field existed, which
   * is treated as "stale" and re-seeded once.
   */
  fixtureHash: string | null;
  /**
   * How far this driver actually is by road, measured once and kept.
   *
   * Straight-line distance is the wrong unit for this product and always has
   * been: the entire argument the trade-area map makes is that a circle drawn
   * round an address lies about who can reach it. Reporting a competitor as
   * "400m away" repeats that lie at the level of a single pin - 400m across a
   * closed bridge or the wrong side of a divided highway is not 400m.
   *
   * Null when we have no coordinate for the driver, or when no Mireye key is
   * present. Surfaces MUST fall back to straight-line and say which they are
   * showing, rather than passing one off as the other.
   */
  driveTime: {
    minutes: number | null;
    miles: number | null;
    /** "mireye_distance" when routed; "haversine" when it is the fallback. */
    method: "mireye_distance" | "haversine";
    measuredAt: string;
  } | null;
  /**
   * Why this row survived the polygon filter - or that it was not spatially
   * filtered at all. Recorded so the citation drawer can show a reader why a
   * given closure was counted and another was thrown away.
   */
  polygonMembership: {
    filtered: boolean;
    inside: boolean;
    distanceM: number | null;
    reason: string;
  };
  provenance: Provenance;
}

export interface LedgerDayRecord {
  id: string;
  siteId: string;
  scenarioKey: string;
  date: string;
  tickets: number;
  basketSizeUsd: number;
  revenueUsd: number;
  adSpendUsd: number;
  grossMarginPct: number;
  source: string;
}

export interface ProposedActionRecord {
  id: string;
  siteId: string;
  scenarioKey: string;
  module: "advertising" | "threat_watch";
  title: string;
  rationale: string;
  expectedValueUsd: number | null;
  costUsd: number | null;
  horizon: string | null;
  requiresApproval: boolean;
  status: "draft" | "pending" | "approved" | "rejected" | "executed";
  payload: unknown;
  evidence: Provenance[];
  createdAt: string;
  decidedAt: string | null;
}

export interface BriefRecord {
  id: string;
  siteId: string;
  scenarioKey: string;
  periodStart: string;
  periodEnd: string;
  headline: string;
  body: string;
  citations: Provenance[];
  createdAt: string;
  narratedBy: string;
}

/**
 * What the owner told us.
 *
 * This is the other half of the loop. The engine reports what it cannot
 * explain; the owner is the only source that can explain it. A check-in note
 * dated inside an attribution window is shown against the unexplained bar, so
 * the gap stops being a mystery and becomes a record.
 *
 * It is deliberately not fed back into the regression. A free-text note is not
 * a measured driver, and quietly turning one into a coefficient would be
 * exactly the kind of unearned confidence the rest of this system refuses.
 */
export interface CheckinRecord {
  id: string;
  siteId: string;
  /** The day being described, YYYY-MM-DD. */
  date: string;
  /** How trade felt. Owner's own read, not measured. */
  pulse: "busy" | "normal" | "slow" | "dead" | null;
  /** Structured causes, from a fixed list so they are countable later. */
  tags: string[];
  note: string;
  createdAt: string;
}

export const checkins = collection<CheckinRecord>("checkins");

export const sites = collection<SiteRecord>("sites");
export const tradeAreas = collection<TradeAreaRecord>("trade-areas");
export const worldEvents = collection<WorldEventRecord>("world-events");
export const ledgerDays = collection<LedgerDayRecord>("ledger-days");
export const proposedActions = collection<ProposedActionRecord>("proposed-actions");
export const briefs = collection<BriefRecord>("briefs");
