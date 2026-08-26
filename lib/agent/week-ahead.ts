import type { AttributionResult } from "@/lib/attribution/decompose";
import type { Insight } from "@/lib/insight";
import type { LedgerDayRecord, SiteRecord, WorldEventRecord } from "@/lib/domain";
import { complete } from "@/lib/agent/llm";

/**
 * THE WEEK AHEAD
 *
 * Everything else in this product looks backwards. It is very good at telling
 * an owner what already happened to them, which is worth something on a
 * Monday morning and worth nothing by Friday - the money is already gone.
 *
 * This looks forward, and it does so without a forecasting model, because it
 * does not need one. The attribution engine has already measured how THIS till
 * responds to the things around it: what a closure costs, what a competitor
 * takes, how the week is shaped. Two facts turn that into a forecast:
 *
 *   1. Some drivers have not stopped. A competitor that opened last month is
 *      still open. A closure with a reopening date is still shut until then.
 *      Their measured daily effect keeps applying until they end.
 *   2. The baseline already knows the shape of the week, because it was
 *      estimated per day of the week from quiet days.
 *
 * So the projection is arithmetic on numbers the engine produced, not a new
 * claim. The model's only job is to say it in a sentence an owner can act on -
 * the same rule the narrator follows.
 *
 * Honesty constraints, which is where most "AI forecasts" fail:
 *   - A driver the engine could not measure gets NO projection. Unproven means
 *     unproven forwards as well as backwards.
 *   - Every projection carries the same confidence band the estimate had. A
 *     range that crosses zero is reported as "may do nothing".
 *   - Nothing is projected past a driver's known end date.
 */

export interface PersistingDriver {
  label: string;
  kind: string;
  /** Customers per day, signed. Derived from the measured effect. */
  customersPerDay: number;
  perDayLow: number;
  perDayHigh: number;
  marginPerDayUsd: number;
  /** Days from the end of the data until this driver stops, or null if open-ended. */
  daysRemaining: number | null;
  endsOn: string | null;
  certainty: "confirmed" | "likely";
  /** Projected over the horizon below. */
  projectedCustomers: number;
  projectedMarginUsd: number;
}

export interface DayShape {
  /** 0 = Sunday. */
  dow: number;
  label: string;
  typicalTickets: number;
  /** Share of the week's tickets, 0-1. */
  share: number;
}

export interface WeekAhead {
  /** Days projected forward. */
  horizonDays: number;
  /** The last day of till data - "today" for anything forward-looking. */
  asOf: string;
  persisting: PersistingDriver[];
  /** Total projected effect of everything still running. */
  projectedCustomers: number;
  projectedMarginUsd: number;
  busiest: DayShape | null;
  quietest: DayShape | null;
  weekShape: DayShape[];
  /** Model-written prep notes. Empty when no model is configured. */
  prep: string[];
  /** Set when prep could not be generated, so the surface can say why. */
  prepUnavailable?: string;
}

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * The deterministic half. No model involved, and no number here that the
 * attribution engine did not already produce.
 */
export function projectWeekAhead(
  attribution: AttributionResult,
  insight: Insight,
  ledger: LedgerDayRecord[],
  events: WorldEventRecord[],
  horizonDays = 28,
): WeekAhead {
  const sorted = [...ledger].sort((a, b) => a.date.localeCompare(b.date));
  const asOf = sorted.at(-1)?.date ?? attribution.windowEnd;

  const inWindow = sorted.filter(
    (d) => d.date >= attribution.windowStart && d.date <= attribution.windowEnd,
  );
  const basket =
    inWindow.length > 0
      ? inWindow.reduce((s, d) => s + d.basketSizeUsd, 0) / inWindow.length
      : 0;
  const margin =
    inWindow.length > 0
      ? inWindow.reduce((s, d) => s + d.grossMarginPct, 0) / inWindow.length
      : 0.62;

  // --- What is still running -----------------------------------------------
  const persisting: PersistingDriver[] = [];
  for (const driver of attribution.drivers) {
    // An effect we could not distinguish from zero does not get a forecast.
    // Projecting one forward would turn "we could not measure this" into a
    // number on a plan, which is the exact failure this product refuses.
    if (driver.indistinguishableFromZero) continue;
    if (driver.activeDays <= 0) continue;

    const event = events.find((e) => e.id === driver.eventId);
    if (!event) continue;
    if (event.endDate < asOf) continue; // finished; nothing to project

    const daysRemaining = daysBetween(asOf, event.endDate);
    // Everything the engine reported is a TOTAL over the days the driver was
    // active. Per-day is what a forecast needs.
    const totalCustomers = (driver.points / 100) * attribution.baselineTickets;
    const customersPerDay = totalCustomers / driver.activeDays;
    const perDayLow = ((driver.pointsLow / 100) * attribution.baselineTickets) / driver.activeDays;
    const perDayHigh = ((driver.pointsHigh / 100) * attribution.baselineTickets) / driver.activeDays;

    // Never project past a known end date.
    const applicableDays =
      daysRemaining > 0 ? Math.min(horizonDays, daysRemaining) : horizonDays;

    const width = Math.abs(driver.pointsHigh - driver.pointsLow);
    persisting.push({
      label: event.label,
      kind: driver.kind,
      customersPerDay,
      perDayLow: Math.min(perDayLow, perDayHigh),
      perDayHigh: Math.max(perDayLow, perDayHigh),
      marginPerDayUsd: customersPerDay * basket * margin,
      daysRemaining: daysRemaining > 0 ? daysRemaining : null,
      endsOn: daysRemaining > 0 ? event.endDate : null,
      certainty: width <= Math.abs(driver.points) ? "confirmed" : "likely",
      projectedCustomers: customersPerDay * applicableDays,
      projectedMarginUsd: customersPerDay * basket * margin * applicableDays,
    });
  }
  persisting.sort((a, b) => Math.abs(b.projectedCustomers) - Math.abs(a.projectedCustomers));

  // --- The shape of a normal week ------------------------------------------
  // Taken from the fitted baseline rather than from raw takings, so a week
  // that happened to contain a closure does not deform the picture of normal.
  const byDow = new Map<number, number[]>();
  for (const point of attribution.series) {
    if (point.warmup) continue;
    const dow = dayOfWeek(point.date);
    const list = byDow.get(dow) ?? [];
    list.push(point.baseline);
    byDow.set(dow, list);
  }
  const weekShape: DayShape[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const values = byDow.get(dow) ?? [];
    if (values.length === 0) continue;
    weekShape.push({
      dow,
      label: DOW_LABELS[dow],
      typicalTickets: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
      share: 0,
    });
  }
  const weekTotal = weekShape.reduce((s, d) => s + d.typicalTickets, 0);
  for (const d of weekShape) d.share = weekTotal > 0 ? d.typicalTickets / weekTotal : 0;

  const ordered = [...weekShape].sort((a, b) => b.typicalTickets - a.typicalTickets);

  return {
    horizonDays,
    asOf,
    persisting,
    projectedCustomers: persisting.reduce((s, p) => s + p.projectedCustomers, 0),
    projectedMarginUsd: persisting.reduce((s, p) => s + p.projectedMarginUsd, 0),
    busiest: ordered[0] ?? null,
    quietest: ordered.at(-1) ?? null,
    weekShape,
    prep: [],
  };
}

const PREP_SYSTEM = [
  "You are Groundwork, advising the owner of one small business on the next few weeks.",
  "",
  "You are given a projection built entirely from that business's own till data. Your job is to turn it into concrete preparation.",
  "",
  "HARD RULES:",
  "1. Never state a number that is not in the input. Do not recompute, round differently, or extrapolate.",
  "2. Everything in the projection is already measured. Do not hedge what is confirmed, and do not firm up what is marked likely.",
  "3. Advice must be physical and specific to running a shop: staffing a shift, ordering stock, opening hours, signage, where to put a person. Not marketing theory, not 'engage your community'.",
  "4. If a driver has an end date, say what changes on that date.",
  "5. No headings, no bullets characters, no preamble. Return 2 to 4 short standalone sentences, one per line.",
].join("\n");

/**
 * The written half. Adds no facts - it phrases the projection above.
 */
export async function writePrepNotes(
  site: SiteRecord,
  plan: WeekAhead,
): Promise<WeekAhead> {
  if (plan.persisting.length === 0 && plan.weekShape.length === 0) return plan;

  const result = await complete({
    agent: "brief",
    siteId: site.id,
    cheap: true,
    temperature: 0.35,
    maxTokens: 400,
    system: PREP_SYSTEM,
    user: JSON.stringify(
      {
        business: site.label,
        asOf: plan.asOf,
        horizonDays: plan.horizonDays,
        stillRunning: plan.persisting.map((p) => ({
          what: p.label,
          customersPerDay: Number(p.customersPerDay.toFixed(1)),
          marginPerDayUsd: Number(p.marginPerDayUsd.toFixed(0)),
          overNextDays: plan.horizonDays,
          projectedCustomers: Math.round(p.projectedCustomers),
          projectedMarginUsd: Math.round(p.projectedMarginUsd),
          endsOn: p.endsOn,
          certainty: p.certainty,
        })),
        typicalWeek: plan.weekShape.map((d) => ({
          day: d.label,
          tickets: d.typicalTickets,
        })),
        busiestDay: plan.busiest?.label,
        quietestDay: plan.quietest?.label,
      },
      null,
      2,
    ),
  });

  if (!result.ok) {
    return {
      ...plan,
      prepUnavailable:
        result.reason === "no_key"
          ? `No model configured (${result.detail}). The projection above is complete and was computed without one.`
          : "The prep writer was unavailable for this run.",
    };
  }

  return {
    ...plan,
    prep: result.text
      .split("\n")
      .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 4),
  };
}
