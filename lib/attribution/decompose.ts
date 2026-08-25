import type { Provenance } from "@/lib/datasource";
import { EVENT_KIND_META, type EventKind } from "@/lib/scenario-kinds";
import { estimateBaseline, type BaselinePoint } from "./baseline";
import { ols } from "./ols";

/**
 * The attribution engine.
 *
 * Takes a daily ticket series and the event matrix of the street, and says how
 * much of a shortfall each driver accounts for - with a band, and with the
 * part it cannot explain named rather than absorbed.
 *
 * Method, in full, because the docs promise it is explainable:
 *
 *   1. Baseline each day from a trailing 28-day level and day-of-week factors,
 *      fitted only on days when nothing was happening (see baseline.ts).
 *   2. Regress the daily residual on one column per driver, where the column
 *      holds that driver's magnitude on days it was active and zero otherwise.
 *      OLS, no intercept, fitted over the WHOLE series - not just the window
 *      being explained - because a driver is only separable from an overlapping
 *      one on the days where they differ.
 *   3. Report each driver's fitted contribution inside the analysis window as
 *      points of the window's baseline, with a 95% band from the coefficient's
 *      standard error.
 *   4. Whatever the fitted drivers do not account for is `unexplained`. It is
 *      never redistributed.
 *
 * The model never runs here. Narration is written from this output, downstream.
 */

export type Confidence = "high" | "medium" | "low";

export interface AttributionEvent {
  id: string;
  kind: EventKind;
  label: string;
  startDate: string;
  endDate: string;
  magnitude: number;
  source: string;
  sourceUrl?: string;
  meta?: Record<string, unknown> | null;
  /**
   * The source's own provenance, carried through rather than rebuilt.
   *
   * The engine used to synthesise one of these with `mocked: true` hardcoded,
   * which badged live Open-Meteo observations as fixtures - precisely the kind
   * of mislabelling the rest of this system exists to prevent. Whoever fetched
   * the data is the only thing that knows whether it was real.
   */
  provenance?: Provenance;
}

export interface LedgerPoint {
  date: string;
  tickets: number;
  basketSizeUsd: number;
  revenueUsd: number;
}

export interface Driver {
  eventId: string;
  kind: EventKind;
  label: string;
  /** Percentage points of the window's baseline tickets. Signed. */
  points: number;
  /** 95% band on `points`, same units. */
  pointsLow: number;
  pointsHigh: number;
  /** Share of the *explained* movement, 0-1. Absolute value basis. */
  share: number;
  /** Days inside the analysis window this driver was active. */
  activeDays: number;
  /** True when the band crosses zero - we could not rule out "no effect". */
  indistinguishableFromZero: boolean;
  provenance: Provenance;
}

export interface AttributionResult {
  /** When this ran. Client components read this instead of calling Date.now()
   *  during render, which would differ between server and client and produce a
   *  hydration mismatch - and would also be a lie about when the data was got. */
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;

  observedTickets: number;
  baselineTickets: number;
  /** Signed percentage change against baseline. -22 means down 22%. */
  deltaPct: number;

  drivers: Driver[];
  /** Points of baseline the drivers do not account for. Signed. */
  unexplainedPoints: number;

  confidence: Confidence;
  /** Plain-language reasons for the confidence grade. Rendered verbatim. */
  confidenceReasons: string[];

  /** Basket size moved or it didn't - the reach-versus-price tell. */
  basketSizeDeltaPct: number;

  diagnostics: {
    rSquared: number;
    conditionNumber: number;
    cleanBaselineDays: number;
    noiseSdTickets: number;
    driversFitted: number;
    seriesDays: number;
    /** Penalty applied to each driver coefficient. See ols.ts. */
    ridge: number;
    /**
     * True when every single day in the window had at least one driver active.
     * The drivers then account for the total almost by construction, and only
     * the split between them is really being estimated. Said out loud rather
     * than left for the reader to notice.
     */
    saturatedWindow: boolean;
  };

  /** Per-day series for the chart, window flagged. */
  series: Array<BaselinePoint & { inWindow: boolean }>;
}

function isActive(event: AttributionEvent, date: string): boolean {
  return date >= event.startDate && date <= event.endDate;
}

export function attribute(
  ledger: LedgerPoint[],
  events: AttributionEvent[],
  windowStart: string,
  windowEnd: string,
): AttributionResult {
  const rows = [...ledger].sort((a, b) => a.date.localeCompare(b.date));

  const baseline = estimateBaseline(
    rows.map((r) => ({
      date: r.date,
      tickets: r.tickets,
      contaminated: events.some((e) => isActive(e, r.date)),
    })),
  );

  const series = baseline.points.map((p) => ({
    ...p,
    inWindow: p.date >= windowStart && p.date <= windowEnd,
  }));

  // --- 2. Fit ---------------------------------------------------------------
  // Only drivers that were actually active somewhere in the fitting sample get
  // a column. An all-zero column is unidentifiable and would poison the SEs.
  const fitRows = series.filter((p) => !p.warmup);
  const candidates = events.filter((e) =>
    fitRows.some((p) => isActive(e, p.date)),
  );

  const X = fitRows.map((p) =>
    candidates.map((e) => (isActive(e, p.date) ? e.magnitude : 0)),
  );
  const y = fitRows.map((p) => p.residual);
  const fit = candidates.length > 0 ? ols(X, y) : null;

  // --- 3. Report over the window -------------------------------------------
  const windowPoints = series.filter((p) => p.inWindow);
  const observedTickets = windowPoints.reduce((s, p) => s + p.tickets, 0);
  const baselineTickets = windowPoints.reduce((s, p) => s + p.baseline, 0);
  const deltaPct =
    baselineTickets > 0
      ? ((observedTickets - baselineTickets) / baselineTickets) * 100
      : 0;

  const drivers: Driver[] = candidates.map((event, k) => {
    const beta = fit?.beta[k] ?? 0;
    const se = fit?.se[k] ?? 0;

    // Exposure = sum of this driver's magnitude over the window's days.
    const exposure = windowPoints.reduce(
      (s, p) => s + (isActive(event, p.date) ? event.magnitude : 0),
      0,
    );
    const activeDays = windowPoints.filter((p) => isActive(event, p.date))
      .length;

    const contribution = beta * exposure;
    const band = 1.96 * se * exposure;

    const toPoints = (v: number) =>
      baselineTickets > 0 ? (v / baselineTickets) * 100 : 0;

    const points = toPoints(contribution);
    const lo = toPoints(contribution - Math.abs(band));
    const hi = toPoints(contribution + Math.abs(band));

    return {
      eventId: event.id,
      kind: event.kind,
      label: event.label,
      points,
      pointsLow: Math.min(lo, hi),
      pointsHigh: Math.max(lo, hi),
      share: 0, // filled below, once the explained total is known
      activeDays,
      indistinguishableFromZero: Math.min(lo, hi) < 0 && Math.max(lo, hi) > 0,
      provenance: event.provenance
        ? {
            ...event.provenance,
            note: [
              event.provenance.note,
              activeDays
                ? `${activeDays} day${activeDays === 1 ? "" : "s"} in this window`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : {
            source: event.source,
            sourceUrl: event.sourceUrl,
            fetchedAt: new Date().toISOString(),
            confidence: "medium",
            // No provenance was supplied, so we cannot claim this is live.
            mocked: true,
            note: EVENT_KIND_META[event.kind]?.label,
          },
    };
  });

  // A driver that was never active inside the window contributes exactly zero.
  // It still belongs in the fit - Independence Day has to be controlled for so
  // it doesn't leak into the closure's coefficient - but reporting it as
  // "0.0 pts" tells the reader nothing.
  const reported = drivers.filter((d) => d.activeDays > 0);

  const explainedPoints = reported.reduce((s, d) => s + d.points, 0);
  const totalAbs = reported.reduce((s, d) => s + Math.abs(d.points), 0);
  for (const d of reported) {
    d.share = totalAbs > 0 ? Math.abs(d.points) / totalAbs : 0;
  }

  const unexplainedPoints = deltaPct - explainedPoints;

  const saturatedWindow =
    windowPoints.length > 0 &&
    windowPoints.every((p) => candidates.some((e) => isActive(e, p.date)));

  // --- 4. Confidence --------------------------------------------------------
  const { confidence, reasons } = gradeConfidence({
    windowDays: windowPoints.length,
    rSquared: fit?.rSquared ?? 0,
    conditionNumber: fit?.conditionNumber ?? Infinity,
    cleanDays: baseline.cleanDayCount,
    unexplainedPoints,
    deltaPct,
    driversFitted: candidates.length,
    // The grade turns on what was active INSIDE the window. A quiet fortnight
    // in the middle of a busy quarter is quiet, however many drivers the
    // regression had to fit elsewhere in the series.
    driversInWindow: reported.length,
    anyBandCrossesZero: reported.some((d) => d.indistinguishableFromZero),
    saturatedWindow,
  });

  // Basket size: reach or price?
  const windowBasket = avg(
    rows.filter((r) => r.date >= windowStart && r.date <= windowEnd).map(
      (r) => r.basketSizeUsd,
    ),
  );
  const priorBasket = avg(
    rows.filter((r) => r.date < windowStart).map((r) => r.basketSizeUsd),
  );
  const basketSizeDeltaPct =
    priorBasket > 0 ? ((windowBasket - priorBasket) / priorBasket) * 100 : 0;

  const computedAt = new Date().toISOString();

  return {
    computedAt,
    windowStart,
    windowEnd,
    windowDays: windowPoints.length,
    observedTickets,
    baselineTickets: Math.round(baselineTickets),
    deltaPct,
    drivers: reported.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    unexplainedPoints,
    confidence,
    confidenceReasons: reasons,
    basketSizeDeltaPct,
    diagnostics: {
      rSquared: fit?.rSquared ?? 0,
      conditionNumber: fit?.conditionNumber ?? 0,
      cleanBaselineDays: baseline.cleanDayCount,
      noiseSdTickets: baseline.noiseSd,
      driversFitted: candidates.length,
      seriesDays: rows.length,
      ridge: fit?.ridge ?? 0,
      saturatedWindow,
    },
    series,
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Confidence is a grade with reasons attached, not a number we invented. Each
 * reason is written to be readable by the shop owner, because the whole point
 * is that they can check the work.
 */
function gradeConfidence(input: {
  windowDays: number;
  rSquared: number;
  conditionNumber: number;
  cleanDays: number;
  unexplainedPoints: number;
  deltaPct: number;
  driversFitted: number;
  driversInWindow: number;
  anyBandCrossesZero: boolean;
  saturatedWindow: boolean;
}): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (input.driversInWindow === 0) {
    return {
      confidence: "low",
      reasons: [
        "Nothing was happening on the street in this window, so there is nothing to attribute the movement to.",
      ],
    };
  }

  if (input.windowDays >= 9) {
    score += 1;
    reasons.push(`${input.windowDays}-day window - long enough to see a pattern.`);
  } else {
    reasons.push(
      `${input.windowDays}-day window - short. A few unusual days move this a lot.`,
    );
  }

  if (input.cleanDays >= 30) {
    score += 1;
    reasons.push(
      `${input.cleanDays} quiet days available to set the baseline against.`,
    );
  } else {
    reasons.push(
      `Only ${input.cleanDays} quiet days to set the baseline against - the expected line is itself uncertain.`,
    );
  }

  if (input.rSquared >= 0.35) {
    score += 1;
    reasons.push(
      `The drivers track the day-to-day movement (R² ${input.rSquared.toFixed(2)}).`,
    );
  } else {
    reasons.push(
      `The drivers explain only part of the day-to-day movement (R² ${input.rSquared.toFixed(2)}).`,
    );
  }

  const unexplainedShare =
    Math.abs(input.deltaPct) > 0
      ? Math.abs(input.unexplainedPoints) / Math.abs(input.deltaPct)
      : 1;
  if (unexplainedShare <= 0.25) {
    score += 1;
    reasons.push(
      `${Math.round(unexplainedShare * 100)}% of the movement is unaccounted for.`,
    );
  } else {
    reasons.push(
      `${Math.round(unexplainedShare * 100)}% of the movement is unaccounted for - something not in our data was also going on.`,
    );
  }

  if (input.conditionNumber > 25) {
    score -= 1;
    reasons.push(
      "Two of these drivers were active on nearly the same days, so the split between them is partly arbitrary.",
    );
  }

  if (input.saturatedWindow) {
    score -= 1;
    reasons.push(
      "Something was happening on every single day of this window, so there are no quiet days inside it to check the drivers against. Treat the total as solid and the split between drivers as an estimate.",
    );
  }

  if (input.anyBandCrossesZero) {
    reasons.push(
      "At least one driver's band crosses zero - we cannot rule out that it did nothing.",
    );
  }

  const confidence: Confidence = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { confidence, reasons };
}
