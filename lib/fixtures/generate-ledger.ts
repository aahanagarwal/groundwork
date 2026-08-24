import type { Scenario, ScenarioEvent } from "@/lib/scenarios";
import type { WorldEventRecord } from "@/lib/domain";

/**
 * Turns a scenario's baseline spec plus its world events into a daily till.
 *
 * This is the *data-generating process*. It is deliberately separate from
 * lib/attribution, which is the *estimator* — the estimator never sees this
 * file's effect sizes and has to recover them from the series alone. Keeping
 * the two apart is what makes the demo's attribution output a real result
 * rather than a number read back out of the fixture.
 *
 * Deterministic: same scenario in, same series out, every time.
 */

export interface GeneratedLedgerDay {
  date: string; // YYYY-MM-DD
  tickets: number;
  basketSizeUsd: number;
  revenueUsd: number;
  adSpendUsd: number;
  grossMarginPct: number;
}

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** mulberry32 — small, fast, and reproducible across machines. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, so noise is normal rather than uniform — real tills are. */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function isActiveOn(event: ScenarioEvent, date: string): boolean {
  return date >= event.startDate && date <= event.endDate;
}

/**
 * @param liveWeather real heat/rain drivers from Open-Meteo. Their magnitudes
 *   are observed; the scenario supplies only how hard this business reacts to
 *   a unit of each. Passing them in is what keeps the till and the world layer
 *   telling the same story — a ledger generated from invented rain would leave
 *   the engine regressing against rain that never fell.
 */
export function generateLedger(
  scenario: Scenario,
  liveWeather: WorldEventRecord[] = [],
): GeneratedLedgerDay[] {
  const { baseline, window } = scenario;

  // Real weather driver -> the till effect it had here, scaled by how strong
  // the observed anomaly was.
  const weatherEvents: ScenarioEvent[] = liveWeather.flatMap((w) => {
    const response = scenario.weatherResponse?.[w.kind as "rain" | "heat"];
    if (!response) return [];
    return [
      {
        kind: w.kind,
        label: w.label,
        startDate: w.startDate,
        endDate: w.endDate,
        magnitude: w.magnitude,
        effect: {
          ticketsPct: response.ticketsPct * w.magnitude,
          basketPct: response.basketPct * w.magnitude,
        },
        source: w.source,
        sourceUrl: w.sourceUrl ?? undefined,
      },
    ];
  });

  // Hidden events move the till exactly like visible ones. The only difference
  // is that nothing downstream is ever told they happened.
  const events = [
    ...scenario.events,
    ...weatherEvents,
    ...(scenario.hiddenEvents ?? []),
  ];
  const rng = makeRng(baseline.seed);
  const dates = eachDate(window.start, window.end);
  const startMs = new Date(`${window.start}T00:00:00Z`).getTime();

  return dates.map((date) => {
    const d = new Date(`${date}T00:00:00Z`);
    const dowKey = DOW_KEYS[d.getUTCDay()];
    const base = baseline.dayOfWeekTickets[dowKey];

    // Slow underlying growth, so the series isn't stationary and the
    // estimator's trailing baseline has to actually track something.
    const monthsElapsed =
      (d.getTime() - startMs) / (1000 * 60 * 60 * 24 * 30.44);
    const trend = 1 + (baseline.trendPctPerMonth / 100) * monthsElapsed;

    // Every event active on this date multiplies the day.
    let ticketMultiplier = 1;
    let basketMultiplier = 1;
    for (const event of events) {
      if (!isActiveOn(event, date)) continue;
      ticketMultiplier *= 1 + event.effect.ticketsPct;
      basketMultiplier *= 1 + event.effect.basketPct;
    }

    const noise = 1 + gaussian(rng) * baseline.noisePct;

    const tickets = Math.max(
      0,
      Math.round(base * trend * ticketMultiplier * noise),
    );
    const basketSizeUsd =
      Math.round(
        baseline.basketSizeUsd *
          basketMultiplier *
          (1 + gaussian(rng) * 0.02) *
          100,
      ) / 100;

    return {
      date,
      tickets,
      basketSizeUsd,
      revenueUsd: Math.round(tickets * basketSizeUsd * 100) / 100,
      adSpendUsd: baseline.dailyAdSpendUsd,
      grossMarginPct: baseline.grossMarginPct,
    };
  });
}
