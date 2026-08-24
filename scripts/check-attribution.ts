/**
 * Runs the attribution engine against every scenario fixture and prints what
 * it recovered next to what the generator actually did.
 *
 * This is the D7 gate from the dossier, run against synthetic data: if the
 * estimator can't recover an effect it was never told about, the engine is
 * wrong and no amount of narration fixes it.
 *
 *   npx tsx scripts/check-attribution.ts
 */

import { loadScenarios } from "@/lib/scenarios";
import { generateLedger } from "@/lib/fixtures/generate-ledger";
import { attribute, type AttributionEvent } from "@/lib/attribution/decompose";

function pct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

for (const scenario of loadScenarios()) {
  const ledger = generateLedger(scenario);
  const events: AttributionEvent[] = scenario.events.map((e, i) => ({
    id: `${scenario.key}-${i}`,
    kind: e.kind,
    label: e.label,
    startDate: e.startDate,
    endDate: e.endDate,
    magnitude: e.magnitude,
    source: e.source,
    sourceUrl: e.sourceUrl,
    meta: e.meta ?? null,
  }));

  const result = attribute(
    ledger,
    events,
    scenario.analysisWindow.start,
    scenario.analysisWindow.end,
  );

  console.log(`\n${"=".repeat(74)}`);
  console.log(`${scenario.name}  [${scenario.key}]`);
  console.log(
    `window ${result.windowStart} → ${result.windowEnd}  (${result.windowDays} days)`,
  );
  console.log(
    `observed ${result.observedTickets} tickets vs baseline ${result.baselineTickets}  =  ${pct(result.deltaPct)}%`,
  );
  console.log(`basket size ${pct(result.basketSizeDeltaPct)}%`);
  console.log("-".repeat(74));

  for (const d of result.drivers) {
    // What the generator actually did, for comparison only.
    const truth = scenario.events.find((e) => e.label === d.label);
    const truthNote = truth
      ? `   (generator: ${pct(truth.effect.ticketsPct * 100)}% per active day)`
      : "";
    console.log(
      `  ${d.label.slice(0, 42).padEnd(44)} ${pct(d.points).padStart(7)} pts  ` +
        `[${pct(d.pointsLow)} … ${pct(d.pointsHigh)}]` +
        (d.indistinguishableFromZero ? "  ~zero" : "") +
        truthNote,
    );
  }
  console.log(
    `  ${"unexplained".padEnd(44)} ${pct(result.unexplainedPoints).padStart(7)} pts`,
  );
  console.log("-".repeat(74));
  console.log(`confidence: ${result.confidence.toUpperCase()}`);
  for (const r of result.confidenceReasons) console.log(`   · ${r}`);
  console.log(
    `diagnostics: R²=${result.diagnostics.rSquared.toFixed(3)} ` +
      `cond=${result.diagnostics.conditionNumber.toFixed(1)} ` +
      `cleanDays=${result.diagnostics.cleanBaselineDays} ` +
      `noiseSd=${result.diagnostics.noiseSdTickets.toFixed(1)} tickets`,
  );
  console.log(`author expected: ${scenario.expectation}`);
}
