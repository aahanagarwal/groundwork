"use client";

import type { AttributionResult, Driver } from "@/lib/attribution/decompose";
import { EVENT_KIND_META } from "@/lib/scenario-kinds";
import { Cited } from "./citations";

/**
 * THE ATTRIBUTION WATERFALL
 *
 * ΔTickets = closure + weather + events + ε, drawn so the honest parts are the
 * legible ones:
 *
 *   · ε is a bar like any other, in the same units, at the same scale. It is
 *     not a footnote and not a rounding line. When it dominates, it looks like
 *     it dominates.
 *   · Every driver carries its 95% band as an error bar. A band that crosses
 *     zero is drawn crossing zero, and labelled - that driver might have done
 *     nothing at all.
 *   · The confidence grade comes with its reasons written out in full, because
 *     "medium" on its own tells an owner nothing they can act on.
 */

function pct(n: number, digits = 1): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export function AttributionWaterfall({
  attribution,
  scenarioName,
}: {
  attribution: AttributionResult;
  scenarioName: string;
}) {
  const rows: Array<{
    key: string;
    label: string;
    sublabel: string;
    points: number;
    low: number;
    high: number;
    driver?: Driver;
    isUnexplained?: boolean;
  }> = [
    ...attribution.drivers.map((d) => ({
      key: d.eventId,
      label: EVENT_KIND_META[d.kind]?.label ?? d.kind,
      sublabel: d.label,
      points: d.points,
      low: d.pointsLow,
      high: d.pointsHigh,
      driver: d,
    })),
    {
      key: "unexplained",
      label: "Unexplained",
      sublabel:
        "Movement no source we hold accounts for. Something happened that no permit, forecast or feed carries.",
      points: attribution.unexplainedPoints,
      low: attribution.unexplainedPoints,
      high: attribution.unexplainedPoints,
      isUnexplained: true,
    },
  ];

  // One shared scale so bar lengths are comparable across drivers and ε.
  const extent = Math.max(
    ...rows.map((r) => Math.max(Math.abs(r.low), Math.abs(r.high), Math.abs(r.points))),
    Math.abs(attribution.deltaPct),
    1,
  );
  const toPct = (v: number) => (v / extent) * 50; // percent of the half-width

  return (
    <section className="card p-0">
      <header className="border-b-[1.5px] border-ink px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="label">Why revenue moved</div>
            <h2 className="mt-1 font-display text-[22px] font-bold uppercase leading-none">
              {pct(attribution.deltaPct)}% tickets
            </h2>
          </div>
          <div className="text-right font-mono text-[12.5px] leading-relaxed text-survey">
            <div>
              {attribution.windowStart} → {attribution.windowEnd}
            </div>
            <div>
              {attribution.windowDays} days · {scenarioName}
            </div>
          </div>
        </div>

        <p className="mt-3 max-w-[62ch] text-[15.5px] leading-snug">
          <Cited
            label="Tickets in the window"
            value={attribution.observedTickets.toLocaleString()}
            provenance={{
              source: "Square Orders API (seeded fixture)",
              fetchedAt: attribution.computedAt,
              confidence: "high",
              mocked: true,
              note: "Daily ticket counts for this address. The POS integration is not connected in this build.",
            }}
          />{" "}
          tickets against an expected{" "}
          <Cited
            label="Expected tickets (baseline)"
            value={attribution.baselineTickets.toLocaleString()}
            derivation={
              `Trailing 28-day level times a day-of-week factor, both estimated only from days when nothing was ` +
              `happening on the street. ${attribution.diagnostics.cleanBaselineDays} such quiet days were available. ` +
              `Excluding the noisy days matters: a baseline fitted through the closure would absorb the closure, and ` +
              `the engine would then report that nothing happened.`
            }
            detail={attribution.diagnostics}
            provenance={{
              source: "Groundwork attribution engine - baseline estimator",
              fetchedAt: attribution.computedAt,
              confidence: attribution.confidence,
              mocked: false,
              note: "Derived, not fetched. Deterministic code - no language model is involved in producing this number.",
            }}
          />
          .
        </p>
      </header>

      <div className="px-5 py-5">
        <div className="space-y-3">
          {rows.map((row) => {
            const width = Math.abs(toPct(row.points));
            const negative = row.points < 0;
            const crossesZero = row.driver?.indistinguishableFromZero;

            return (
              <div key={row.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span
                    className={`font-mono text-[12.5px] uppercase tracking-[0.14em] ${
                      row.isUnexplained ? "text-ink" : "text-survey"
                    }`}
                  >
                    {row.label}
                    {crossesZero ? (
                      <span className="ml-2 normal-case tracking-normal text-stone">
                        may have done nothing
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[13px] tabular">
                    {row.driver ? (
                      <Cited
                        label={row.label}
                        value={`${pct(row.points)} pts`}
                        derivation={
                          `This driver was active on ${row.driver.activeDays} of the window's ${attribution.windowDays} days. ` +
                          `Its coefficient is fitted across the whole 90-day series, not just this window, because a driver ` +
                          `is only separable from an overlapping one on the days where they differ. The band is 95% on that ` +
                          `coefficient, scaled by how much of the driver fell inside the window.`
                        }
                        detail={{
                          points: row.points,
                          band95: [row.low, row.high],
                          activeDaysInWindow: row.driver.activeDays,
                          shareOfExplainedMovement: row.driver.share,
                          couldBeZero: row.driver.indistinguishableFromZero,
                        }}
                        provenance={row.driver.provenance}
                      />
                    ) : (
                      <Cited
                        label="Unexplained"
                        value={`${pct(row.points)} pts`}
                        derivation={
                          `The movement left over once every driver we hold has taken its share. It is never ` +
                          `redistributed to the other drivers. Driver coefficients are deliberately shrunk toward zero ` +
                          `in proportion to how little independent evidence supports them, and the shrunk-away portion ` +
                          `falls through to here rather than being claimed by whichever driver happened to be active.`
                        }
                        detail={{
                          unexplainedPoints: attribution.unexplainedPoints,
                          totalMovementPct: attribution.deltaPct,
                          shrinkagePenalty: attribution.diagnostics.ridge,
                          saturatedWindow: attribution.diagnostics.saturatedWindow,
                        }}
                        provenance={{
                          source: "Groundwork attribution engine - residual",
                          fetchedAt: attribution.computedAt,
                          confidence: attribution.confidence,
                          mocked: false,
                          note: "There is no source for this, by definition. That is what it means.",
                        }}
                      />
                    )}
                  </span>
                </div>

                {/* Bar track, zero at the centre. */}
                <div className="relative h-[22px] border border-rule bg-limestone">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />

                  {/* 95% band, drawn behind the bar. */}
                  {!row.isUnexplained && row.low !== row.high ? (
                    <div
                      className="absolute inset-y-[7px] border-y border-ink/30"
                      style={{
                        left: `${50 + Math.min(toPct(row.low), toPct(row.high))}%`,
                        width: `${Math.abs(toPct(row.high) - toPct(row.low))}%`,
                      }}
                    />
                  ) : null}

                  <div
                    className={`absolute inset-y-[4px] ${
                      row.isUnexplained
                        ? "bg-[repeating-linear-gradient(45deg,var(--color-signal),var(--color-signal)_4px,transparent_4px,transparent_8px)] border border-ink"
                        : negative
                          ? "bg-ultra"
                          : "bg-survey"
                    }`}
                    style={{
                      left: negative ? `${50 - width}%` : "50%",
                      width: `${Math.max(width, 0.4)}%`,
                    }}
                  />
                </div>

                <p className="mt-1 text-[13.5px] leading-snug text-ink/70">{row.sublabel}</p>
              </div>
            );
          })}
        </div>

        {/* Confidence, with its reasons spelled out. */}
        <div
          className={`mt-6 border-l-[3px] pl-4 ${
            attribution.confidence === "high"
              ? "border-survey"
              : attribution.confidence === "medium"
                ? "border-signal"
                : "border-stone"
          }`}
        >
          <div className="label">
            Confidence: {attribution.confidence}
            {attribution.diagnostics.saturatedWindow ? " · saturated window" : ""}
          </div>
          <ul className="mt-2 space-y-1.5 text-[14.5px] leading-snug">
            {attribution.confidenceReasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span aria-hidden className="text-stone">
                  ·
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* The reach-or-price tell. */}
        <div className="mt-5 border-t border-rule pt-4 text-[15px] leading-snug">
          <span className="label">Reach, or price?</span>{" "}
          Basket size moved{" "}
          <Cited
            label="Basket size change"
            value={`${pct(attribution.basketSizeDeltaPct)}%`}
            derivation="Mean basket size inside the window against mean basket size before it."
            provenance={{
              source: "Square Orders API (seeded fixture)",
              fetchedAt: attribution.computedAt,
              confidence: "high",
              mocked: true,
            }}
          />
          .{" "}
          {Math.abs(attribution.basketSizeDeltaPct) < 2
            ? "Flat. People who came in spent what they always spend - so this was about how many people arrived, not what they were willing to pay. Discounting would be solving the wrong problem."
            : attribution.basketSizeDeltaPct > 0
              ? "Up. Fewer people, each spending more - a mix shift, not just lost footfall."
              : "Down. People came and spent less, which points at price or mix rather than reach."}
        </div>
      </div>
    </section>
  );
}
