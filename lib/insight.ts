import type { AttributionResult, Driver } from "@/lib/attribution/decompose";
import type { LedgerDayRecord } from "@/lib/domain";
import type { EventKind } from "@/lib/scenario-kinds";
import type { Provenance } from "@/lib/datasource";

/**
 * OWNER UNITS
 *
 * The attribution engine speaks in percentage points of baseline, which is the
 * right unit for the maths and the wrong unit for the person paying for this.
 * A shop owner does not think "5.0 points". They think "about 190 customers"
 * and "roughly $1,700 of margin", and they decide with those.
 *
 * This module is the translation, and it is deterministic code for the same
 * reason the engine is: the model never computes a number. Every figure below
 * is arithmetic on the attribution object plus the owner's own basket size and
 * margin, and each one carries the derivation that produced it.
 *
 * Nothing here is new evidence. It is the same finding in units a person can
 * act on.
 */

export type Certainty = "confirmed" | "likely" | "unproven";

export interface DriverInsight {
  eventId: string;
  kind: EventKind;
  label: string;
  /** Percentage points, as the engine reported them. Kept for the drill-down. */
  points: number;
  pointsLow: number;
  pointsHigh: number;
  activeDays: number;

  /** Customers this driver accounts for. Signed: negative means lost. */
  customers: number;
  customersLow: number;
  customersHigh: number;
  revenueUsd: number;
  marginUsd: number;

  certainty: Certainty;
  /** Why it got that grade, in one sentence an owner can check. */
  certaintyReason: string;
  /** One thing to do about it. Empty when the honest answer is "nothing". */
  soWhat: string;
  provenance: Provenance;
  /**
   * The individual events folded into this row, when several of one kind were
   * grouped. Empty for a single event. Kept so the drill-down can still show
   * each one separately — grouping is a display decision, not a loss of data.
   */
  components: Array<{ label: string; points: number; activeDays: number }>;
}

export type VerdictKind =
  | "mostly_the_street"
  | "mostly_you"
  | "split"
  | "cannot_explain"
  | "nothing_happened"
  | "ahead";

export interface Insight {
  /** The straight answer, in four words or so. */
  verdict: VerdictKind;
  verdictHeadline: string;
  /** One sentence expanding it. No hedging that isn't earned. */
  verdictLine: string;

  /** Totals for the window, in owner units. */
  customersDelta: number;
  revenueDeltaUsd: number;
  marginDeltaUsd: number;
  observedTickets: number;
  baselineTickets: number;
  deltaPct: number;

  /** Share of the movement the street accounts for, 0-1. */
  streetShare: number;
  /** Share we cannot account for, 0-1. */
  unknownShare: number;
  unexplainedCustomers: number;
  unexplainedMarginUsd: number;

  drivers: DriverInsight[];
  /** The single most useful thing to do, pulled from the drivers. */
  headlineAction: string | null;

  basketSizeUsd: number;
  grossMarginPct: number;
  windowDays: number;
}

/** What to do about each kind of driver. Written for a shop owner, not a deck. */
const SO_WHAT: Record<EventKind, string> = {
  road_closure:
    "Move ad spend off the blocked side and leave your prices alone — the people who did reach you paid full price.",
  competitor_open:
    "This one does not go away when the weather changes. Watch whether your regulars come less often, not whether the total dips.",
  heat: "Push iced drinks and move staff to the afternoon, when the drop actually lands.",
  rain: "Nothing to do. It rained.",
  event: "Stock up the next time this is on — it brought people in.",
  holiday:
    "Expected. Plan staffing around it rather than reading it as a trend.",
  fuel_price:
    "Fuel moves how far people are willing to drive. Watch your outer ring, not your regulars.",
  news: "Worth knowing about, but not something to price or staff against yet.",
};

function certaintyOf(driver: Driver): { certainty: Certainty; reason: string } {
  if (driver.indistinguishableFromZero) {
    return {
      certainty: "unproven",
      reason: `Only ${driver.activeDays} day${driver.activeDays === 1 ? "" : "s"} of it in this window — not enough to tell its effect apart from an ordinary quiet day.`,
    };
  }

  const width = Math.abs(driver.pointsHigh - driver.pointsLow);
  const size = Math.abs(driver.points);
  // A range narrower than the estimate itself means the effect is solid.
  if (size > 0 && width <= size) {
    return {
      certainty: "confirmed",
      reason: `Consistent across all ${driver.activeDays} day${driver.activeDays === 1 ? "" : "s"} it was active.`,
    };
  }
  return {
    certainty: "likely",
    reason: `Clearly there, but the size is loose — ${driver.activeDays} day${driver.activeDays === 1 ? "" : "s"} is not many to measure against.`,
  };
}

export function buildInsight(
  attribution: AttributionResult,
  ledger: LedgerDayRecord[],
): Insight {
  const inWindow = ledger.filter(
    (d) => d.date >= attribution.windowStart && d.date <= attribution.windowEnd,
  );
  const basketSizeUsd =
    inWindow.length > 0
      ? inWindow.reduce((s, d) => s + d.basketSizeUsd, 0) / inWindow.length
      : 0;
  const grossMarginPct =
    inWindow.length > 0
      ? inWindow.reduce((s, d) => s + d.grossMarginPct, 0) / inWindow.length
      : 0.62;

  const baseline = attribution.baselineTickets;
  const toCustomers = (points: number) => (points / 100) * baseline;

  const drivers: DriverInsight[] = attribution.drivers.map((d) => {
    const { certainty, reason } = certaintyOf(d);
    const customers = toCustomers(d.points);
    return {
      eventId: d.eventId,
      kind: d.kind,
      label: d.label,
      points: d.points,
      pointsLow: d.pointsLow,
      pointsHigh: d.pointsHigh,
      activeDays: d.activeDays,
      customers,
      customersLow: toCustomers(d.pointsLow),
      customersHigh: toCustomers(d.pointsHigh),
      revenueUsd: customers * basketSizeUsd,
      marginUsd: customers * basketSizeUsd * grossMarginPct,
      certainty,
      certaintyReason: reason,
      // An unproven driver gets no instruction. Telling someone to act on an
      // effect we could not measure is the exact failure this product exists
      // to avoid.
      soWhat: certainty === "unproven" ? "" : (SO_WHAT[d.kind] ?? ""),
      provenance: d.provenance,
      components: [],
    };
  });

  const grouped = groupByKind(
    drivers,
    toCustomers,
    basketSizeUsd,
    grossMarginPct,
  );

  const customersDelta = attribution.observedTickets - baseline;
  const revenueDeltaUsd = customersDelta * basketSizeUsd;
  const marginDeltaUsd = revenueDeltaUsd * grossMarginPct;

  // Only drivers we could actually measure count toward "the street". An
  // unproven driver is not evidence, and folding it in would inflate our own
  // explanatory power.
  const explainedPoints = grouped
    .filter((d) => d.certainty !== "unproven")
    .reduce((s, d) => s + Math.abs(d.points), 0);
  const totalMovement = Math.abs(attribution.deltaPct);
  const streetShare =
    totalMovement > 0 ? Math.min(1, explainedPoints / totalMovement) : 0;
  const unknownShare =
    totalMovement > 0
      ? Math.min(1, Math.abs(attribution.unexplainedPoints) / totalMovement)
      : 0;

  const biggest = grouped.find((d) => d.certainty !== "unproven");

  const { verdict, verdictHeadline, verdictLine } = decideVerdict({
    attribution,
    streetShare,
    unknownShare,
    biggest,
    customersDelta,
    marginDeltaUsd,
    driverCount: grouped.length,
    windowDaysLabel: `${attribution.windowDays} days`,
  });

  return {
    verdict,
    verdictHeadline,
    verdictLine,
    customersDelta,
    revenueDeltaUsd,
    marginDeltaUsd,
    observedTickets: attribution.observedTickets,
    baselineTickets: baseline,
    deltaPct: attribution.deltaPct,
    streetShare,
    unknownShare,
    unexplainedCustomers: toCustomers(attribution.unexplainedPoints),
    unexplainedMarginUsd:
      toCustomers(attribution.unexplainedPoints) *
      basketSizeUsd *
      grossMarginPct,
    drivers: grouped,
    headlineAction: biggest?.soWhat || null,
    basketSizeUsd,
    grossMarginPct,
    windowDays: attribution.windowDays,
  };
}

/**
 * Folds several events of one kind into a single row.
 *
 * Three separate rain cards, each saying "we could not measure this", is noise
 * dressed as rigour — an owner reads it as the product repeating itself. One
 * row saying "rain, 3 days, about 47 customers, unproven" is the same
 * information and an actual sentence.
 *
 * The individual events survive in `components` for the drill-down. Grouping
 * is a display decision; nothing is discarded, and the arithmetic is a sum, so
 * the total is unchanged.
 */
function groupByKind(
  drivers: DriverInsight[],
  toCustomers: (points: number) => number,
  basketSizeUsd: number,
  grossMarginPct: number,
): DriverInsight[] {
  const byKind = new Map<string, DriverInsight[]>();
  for (const driver of drivers) {
    byKind.set(driver.kind, [...(byKind.get(driver.kind) ?? []), driver]);
  }

  const out: DriverInsight[] = [];
  for (const [, group] of byKind) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    const points = group.reduce((s, d) => s + d.points, 0);
    const activeDays = group.reduce((s, d) => s + d.activeDays, 0);
    const customers = toCustomers(points);
    // A group is only as certain as its best-evidenced member. If every one of
    // them was unproven individually, the group is unproven too — summing weak
    // estimates does not make a strong one.
    const certainty: Certainty = group.some((d) => d.certainty === "confirmed")
      ? "confirmed"
      : group.some((d) => d.certainty === "likely")
        ? "likely"
        : "unproven";

    const kind = group[0].kind;
    out.push({
      eventId: `${kind}-group`,
      kind,
      label: `${group.length} spells of ${(EVENT_LABEL[kind] ?? kind).toLowerCase()}`,
      points,
      pointsLow: group.reduce((s, d) => s + d.pointsLow, 0),
      pointsHigh: group.reduce((s, d) => s + d.pointsHigh, 0),
      activeDays,
      customers,
      customersLow: toCustomers(group.reduce((s, d) => s + d.pointsLow, 0)),
      customersHigh: toCustomers(group.reduce((s, d) => s + d.pointsHigh, 0)),
      revenueUsd: customers * basketSizeUsd,
      marginUsd: customers * basketSizeUsd * grossMarginPct,
      certainty,
      certaintyReason:
        certainty === "unproven"
          ? `Spread over ${activeDays} separate day${activeDays === 1 ? "" : "s"}, none of which moved things enough to tell apart from an ordinary quiet day.`
          : `Across ${activeDays} day${activeDays === 1 ? "" : "s"} in this window.`,
      soWhat: certainty === "unproven" ? "" : group[0].soWhat,
      provenance: group[0].provenance,
      components: group.map((d) => ({
        label: d.label,
        points: d.points,
        activeDays: d.activeDays,
      })),
    });
  }

  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

const EVENT_LABEL: Record<string, string> = {
  rain: "Rain",
  heat: "Heat",
  road_closure: "Road closure",
  competitor_open: "New competitor",
  event: "Local event",
  holiday: "Holiday",
  fuel_price: "Fuel price",
  news: "Local news",
};

function decideVerdict(input: {
  attribution: AttributionResult;
  streetShare: number;
  unknownShare: number;
  biggest?: DriverInsight;
  customersDelta: number;
  marginDeltaUsd: number;
  driverCount: number;
  windowDaysLabel: string;
}): { verdict: VerdictKind; verdictHeadline: string; verdictLine: string } {
  const {
    attribution: a,
    streetShare,
    unknownShare,
    biggest,
    customersDelta,
  } = input;
  const magnitude = Math.abs(a.deltaPct);
  const customers = Math.round(Math.abs(customersDelta));

  // Nothing worth explaining. Say so rather than manufacturing a story.
  if (magnitude < 4 && input.driverCount === 0) {
    return {
      verdict: "nothing_happened",
      verdictHeadline: "Nothing to report",
      verdictLine: `You moved ${magnitude.toFixed(1)}% against normal, which is inside your ordinary week-to-week wobble. Nothing was happening on your street, and we are not going to invent a reason.`,
    };
  }

  if (a.deltaPct > 0 && streetShare >= 0.5 && biggest) {
    return {
      verdict: "ahead",
      verdictHeadline: "You ran ahead, and it wasn't luck",
      verdictLine: `About ${customers} more customers than a normal ${input.windowDaysLabel}, and ${biggest.label} accounts for most of it.`,
    };
  }

  if (input.driverCount === 0 || (!biggest && unknownShare > 0.5)) {
    return {
      verdict: "cannot_explain",
      verdictHeadline: "We can't explain this one",
      verdictLine: `You were ${customers} customers ${customersDelta < 0 ? "short" : "up"} on normal, and nothing on your street accounts for it. No closure, no permit, no weather worth the name. Whatever moved this is something we don't have a feed for — which usually means it happened inside the shop.`,
    };
  }

  if (unknownShare > 0.45) {
    return {
      verdict: "split",
      verdictHeadline: "Part street, part something we can't see",
      verdictLine: `${biggest ? `${biggest.label} accounts for some of it` : "The street accounts for some of it"}, but ${Math.round(unknownShare * 100)}% of the drop has no source we hold. That share is worth checking inside the shop.`,
    };
  }

  if (streetShare >= 0.6 && biggest) {
    return {
      verdict: "mostly_the_street",
      verdictHeadline: "This wasn't you. It was the street.",
      verdictLine: `You were ${customers} customers short of a normal ${input.windowDaysLabel}, and ${biggest.label} accounts for most of that on its own.`,
    };
  }

  return {
    verdict: "split",
    verdictHeadline: "Some of this was the street",
    verdictLine: `${customers} customers ${customersDelta < 0 ? "short" : "up"} on normal. The street explains about ${Math.round(streetShare * 100)}% of it; the rest we cannot pin down.`,
  };
}

export const VERDICT_TONE: Record<
  VerdictKind,
  { chip: string; accent: "survey" | "signal" | "stone" | "ultra" }
> = {
  mostly_the_street: { chip: "Not your fault", accent: "survey" },
  ahead: { chip: "Ahead of normal", accent: "survey" },
  split: { chip: "Partly explained", accent: "signal" },
  cannot_explain: { chip: "Unexplained", accent: "stone" },
  mostly_you: { chip: "Inside the shop", accent: "signal" },
  nothing_happened: { chip: "Normal week", accent: "stone" },
};
