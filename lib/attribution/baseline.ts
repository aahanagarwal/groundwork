/**
 * What the till *should* have done.
 *
 * Trailing level plus day-of-week seasonality, both estimated only from days
 * when nothing was happening on the street. The exclusion is the important
 * part: a baseline fitted through the closure would absorb the closure, and
 * the engine would then confidently report that nothing happened.
 */

export interface BaselineInput {
  date: string;
  tickets: number;
  /** True when any world event was active on this date. */
  contaminated: boolean;
}

export interface BaselinePoint {
  date: string;
  tickets: number;
  baseline: number;
  residual: number;
  contaminated: boolean;
  /** True while the trailing window hasn't filled - excluded from the fit. */
  warmup: boolean;
}

export interface BaselineResult {
  points: BaselinePoint[];
  /** Multiplicative factor per day of week, 0 = Sunday. */
  dowFactors: number[];
  cleanDayCount: number;
  /** Residual standard deviation on clean days - the noise floor. */
  noiseSd: number;
  window: number;
}

const TRAILING_WINDOW_DAYS = 28;
const MIN_CLEAN_DAYS = 14;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function estimateBaseline(rows: BaselineInput[]): BaselineResult {
  const clean = rows.filter((r) => !r.contaminated);
  const overallLevel = median(clean.map((r) => r.tickets));

  // Day-of-week factors from every clean day in the series. Medians, so one
  // freak Saturday doesn't move the shape.
  const dowFactors = Array.from({ length: 7 }, (_, dow) => {
    const sameDow = clean
      .filter((r) => dayOfWeek(r.date) === dow)
      .map((r) => r.tickets);
    if (sameDow.length === 0 || overallLevel === 0) return 1;
    return median(sameDow) / overallLevel;
  });

  const points: BaselinePoint[] = rows.map((row, i) => {
    // Trailing level: clean days only, from the 28 calendar days before this
    // one. Deseasonalised first so the level isn't a function of which days of
    // week happened to survive the exclusion.
    const from = Math.max(0, i - TRAILING_WINDOW_DAYS);
    const trailing = rows
      .slice(from, i)
      .filter((r) => !r.contaminated)
      .map((r) => {
        const f = dowFactors[dayOfWeek(r.date)] || 1;
        return r.tickets / f;
      });

    const warmup = trailing.length < MIN_CLEAN_DAYS;
    const level = warmup ? overallLevel : median(trailing);
    const baseline = level * (dowFactors[dayOfWeek(row.date)] || 1);

    return {
      date: row.date,
      tickets: row.tickets,
      baseline,
      residual: row.tickets - baseline,
      contaminated: row.contaminated,
      warmup,
    };
  });

  const cleanResiduals = points
    .filter((p) => !p.contaminated && !p.warmup)
    .map((p) => p.residual);
  const mean =
    cleanResiduals.reduce((s, v) => s + v, 0) / (cleanResiduals.length || 1);
  const noiseSd = Math.sqrt(
    cleanResiduals.reduce((s, v) => s + (v - mean) ** 2, 0) /
      Math.max(1, cleanResiduals.length - 1),
  );

  return {
    points,
    dowFactors,
    cleanDayCount: cleanResiduals.length,
    noiseSd,
    window: TRAILING_WINDOW_DAYS,
  };
}
