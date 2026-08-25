"use client";

import type { AttributionResult } from "@/lib/attribution/decompose";
import type { DriverInsight, Insight } from "@/lib/insight";
import { VERDICT_TONE } from "@/lib/insight";
import { EVENT_KIND_META } from "@/lib/scenario-kinds";
import { Cited } from "./citations";

/**
 * THE VERDICT
 *
 * The first four inches of the page, and the only part most owners will read.
 *
 * Three rules it is built to:
 *   1. Answer first. "This wasn't you, it was the street" before any number.
 *   2. Money and customers, not percentage points. Nobody staffs a shift or
 *      cancels a discount because of "5.0 points of baseline".
 *   3. Certainty as a word, not a bracket. "Unproven" is a thing an owner can
 *      act on - by not acting. "[-2.0 … +0.4]" is not.
 *
 * The underlying figures are unchanged; they are one click away on every value
 * and the full statistical breakdown is still below. This is a different
 * rendering of the same evidence, not a softer one.
 */

function money(n: number): string {
  const abs = Math.abs(n);
  const rounded = abs >= 1000 ? Math.round(abs / 10) * 10 : Math.round(abs);
  return `$${rounded.toLocaleString()}`;
}

function customers(n: number): string {
  return Math.abs(Math.round(n)).toLocaleString();
}

const ACCENT: Record<string, string> = {
  survey: "border-survey",
  signal: "border-signal",
  stone: "border-stone",
  ultra: "border-ultra",
};

export function VerdictBlock({
  insight,
  attribution,
  siteLabel,
}: {
  insight: Insight;
  attribution: AttributionResult;
  siteLabel: string;
}) {
  const tone = VERDICT_TONE[insight.verdict];
  const down = insight.customersDelta < 0;

  const moneyProvenance = {
    source: "Groundwork - attribution converted to your own basket size and margin",
    fetchedAt: attribution.computedAt,
    confidence: attribution.confidence,
    mocked: false,
    note: "Derived arithmetic, not a fetched figure. No language model is involved in producing it.",
  } as const;

  const derivation =
    `${insight.observedTickets.toLocaleString()} customers against an expected ` +
    `${insight.baselineTickets.toLocaleString()}, a shortfall of ${customers(insight.customersDelta)}. ` +
    `Multiplied by your average basket of $${insight.basketSizeUsd.toFixed(2)} over these ` +
    `${insight.windowDays} days, and again by your ${Math.round(insight.grossMarginPct * 100)}% gross margin. ` +
    `The expected figure comes from your own quiet days - a trailing 28-day level and a ` +
    `day-of-week factor fitted only on days when nothing was happening on your street.`;

  return (
    <section className={`card border-l-[5px] ${ACCENT[tone.accent]} p-0`}>
      <div className="px-6 pb-5 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-ink bg-ink px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-limestone">
            {tone.chip}
          </span>
          <span className="font-display text-[15px] font-bold uppercase tracking-widest text-ink ml-1">
            {attribution.windowStart} → {attribution.windowEnd} &middot; {siteLabel}
          </span>
        </div>

        <h1 className="mt-3 max-w-[19ch] font-display text-[clamp(30px,3.8vw,46px)] font-extrabold uppercase leading-[0.96] tracking-[-0.025em]">
          {insight.verdictHeadline}
        </h1>

        <p className="mt-3 max-w-[60ch] text-[18px] leading-[1.45]">
          {insight.verdictLine}
        </p>
      </div>

      {/* What it actually cost, in units a person decides with. */}
      <div className="grid grid-cols-3 divide-x divide-rule border-y-[1.5px] border-ink">
        <Tile
          label={down ? "Customers lost" : "Extra customers"}
          value={
            <Cited
              label={down ? "Customers lost" : "Extra customers"}
              value={customers(insight.customersDelta)}
              derivation={derivation}
              detail={{
                observed: insight.observedTickets,
                expected: insight.baselineTickets,
                deltaPct: insight.deltaPct,
              }}
              provenance={moneyProvenance}
            />
          }
          sub={`vs ${insight.baselineTickets.toLocaleString()} expected`}
        />
        <Tile
          label={down ? "Sales missed" : "Extra sales"}
          value={
            <Cited
              label={down ? "Sales missed" : "Extra sales"}
              value={money(insight.revenueDeltaUsd)}
              derivation={derivation}
              provenance={moneyProvenance}
            />
          }
          sub={`at $${insight.basketSizeUsd.toFixed(2)} a ticket`}
        />
        <Tile
          label={down ? "Margin missed" : "Extra margin"}
          value={
            <Cited
              label={down ? "Margin missed" : "Extra margin"}
              value={money(insight.marginDeltaUsd)}
              derivation={derivation}
              provenance={moneyProvenance}
            />
          }
          sub={`at ${Math.round(insight.grossMarginPct * 100)}% gross margin`}
          emphasis
        />
      </div>

      {insight.headlineAction ? (
        <div className="px-6 py-4">
          <div className="label mb-1.5">Do this</div>
          <p className="max-w-[62ch] text-[16.5px] leading-snug">
            {insight.headlineAction}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  emphasis = false,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`px-5 py-4 ${emphasis ? "bg-signal/25" : ""}`}>
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-[clamp(20px,2.4vw,28px)] leading-none tabular">
        {value}
      </div>
      <div className="mt-1.5 font-mono text-[11px] leading-snug text-ink/55">{sub}</div>
    </div>
  );
}

/**
 * WHAT MOVED IT
 *
 * One card per driver, ordered by size, each answering three questions in the
 * order an owner asks them: what was it, what did it cost me, and how sure are
 * you. The "so what" line is deliberately absent on unproven drivers - telling
 * someone to act on an effect we could not measure is the exact failure this
 * product exists to avoid.
 */
export function DriverCards({
  insight,
  attribution,
  checkinNote,
}: {
  insight: Insight;
  attribution: AttributionResult;
  checkinNote?: string | null;
}) {
  return (
    <section>
      <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink mb-6">
        What moved it
      </h2>

      <div className="space-y-2.5">
        {insight.drivers.map((driver) => (
          <DriverCard key={driver.eventId} driver={driver} insight={insight} />
        ))}

        <UnexplainedCard
          insight={insight}
          attribution={attribution}
          checkinNote={checkinNote}
        />
      </div>
    </section>
  );
}

const CERTAINTY_STYLE: Record<
  DriverInsight["certainty"],
  { label: string; className: string }
> = {
  confirmed: {
    label: "Confirmed",
    className: "border-survey bg-survey text-paper",
  },
  likely: { label: "Likely", className: "border-ink bg-signal text-ink" },
  unproven: { label: "Unproven", className: "border-stone text-stone" },
};

function DriverCard({
  driver,
  insight,
}: {
  driver: DriverInsight;
  insight: Insight;
}) {
  const style = CERTAINTY_STYLE[driver.certainty];
  const negative = driver.customers < 0;
  const share = Math.min(
    100,
    (Math.abs(driver.customers) / Math.max(1, Math.abs(insight.customersDelta))) * 100,
  );

  return (
    <article className="card p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">
              {EVENT_KIND_META[driver.kind]?.label ?? driver.kind}
            </span>
            <span
              className={`border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] ${style.className}`}
            >
              {style.label}
            </span>
            <span className="font-mono text-[11px] text-stone">
              {driver.activeDays} of {insight.windowDays} days
            </span>
          </div>
          <h3 className="mt-1.5 text-[17px] font-semibold leading-snug">
            {driver.label}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <div className="font-mono text-[22px] leading-none tabular">
            <Cited
              label={driver.label}
              value={`${negative ? "−" : "+"}${customers(driver.customers)}`}
              derivation={
                `Estimated at ${driver.points.toFixed(1)} percentage points of the window's expected ` +
                `${insight.baselineTickets.toLocaleString()} customers, with a 95% range of ` +
                `${driver.pointsLow.toFixed(1)} to ${driver.pointsHigh.toFixed(1)} points - so between ` +
                `${customers(driver.customersLow)} and ${customers(driver.customersHigh)} customers. ` +
                `The coefficient is fitted across the whole 90-day series, not just this window, because a ` +
                `driver is only separable from an overlapping one on the days where they differ.`
              }
              detail={{
                points: driver.points,
                band95Points: [driver.pointsLow, driver.pointsHigh],
                customers: Math.round(driver.customers),
                band95Customers: [
                  Math.round(driver.customersLow),
                  Math.round(driver.customersHigh),
                ],
                activeDaysInWindow: driver.activeDays,
                certainty: driver.certainty,
                // Present when several events of one kind were folded into one
                // row. Grouping is a display choice; the parts stay visible.
                ...(driver.components.length > 0
                  ? { groupedFrom: driver.components }
                  : {}),
              }}
              provenance={driver.provenance}
            />
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink/55">
            customers · {money(driver.marginUsd)} margin
          </div>
        </div>
      </div>

      {/* Share of the total movement, as a bar rather than a second number. */}
      <div className="mt-3 px-5">
        <div className="h-1.5 w-full bg-limestone">
          <div
            className={`h-full ${driver.certainty === "unproven" ? "bg-stone" : negative ? "bg-ultra" : "bg-survey"}`}
            style={{ width: `${share}%` }}
          />
        </div>
      </div>

      <div className="px-5 pb-4 pt-2.5">
        <p className="text-[13.5px] leading-snug text-ink/65">
          {driver.certaintyReason}
        </p>
        {driver.components.length > 0 ? (
          <p className="mt-1 font-mono text-[11.5px] leading-snug text-stone">
            {driver.components.map((c) => c.label).join(" · ")}
          </p>
        ) : null}
        {driver.soWhat ? (
          <p className="mt-2 border-l-2 border-signal pl-3 text-[15px] leading-snug">
            {driver.soWhat}
          </p>
        ) : (
          <p className="mt-2 border-l-2 border-stone pl-3 text-[15px] leading-snug text-ink/70">
            We are not going to tell you to do anything about this one. We could not
            measure it, and acting on an effect we could not measure is guessing.
          </p>
        )}
      </div>
    </article>
  );
}

function UnexplainedCard({
  insight,
  attribution,
  checkinNote,
}: {
  insight: Insight;
  attribution: AttributionResult;
  checkinNote?: string | null;
}) {
  const share = Math.min(
    100,
    (Math.abs(insight.unexplainedCustomers) /
      Math.max(1, Math.abs(insight.customersDelta))) *
      100,
  );

  return (
    <article className="card border-dashed p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <span className="label">Not explained</span>
          <h3 className="mt-1.5 text-[17px] font-semibold leading-snug">
            Something we don&rsquo;t have a feed for
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[22px] leading-none tabular">
            <Cited
              label="Unexplained"
              value={`${insight.unexplainedCustomers < 0 ? "−" : "+"}${customers(insight.unexplainedCustomers)}`}
              derivation={
                "What is left once every driver we hold has taken its share. It is never redistributed to " +
                "the others. Driver estimates are deliberately shrunk toward zero in proportion to how little " +
                "independent evidence supports them, and the shrunk-away weight falls through to here rather " +
                "than being claimed by whichever driver happened to be active that week."
              }
              detail={{
                unexplainedPoints: attribution.unexplainedPoints,
                customers: Math.round(insight.unexplainedCustomers),
                shareOfMovement: insight.unknownShare,
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
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink/55">
            customers · {money(insight.unexplainedMarginUsd)} margin
          </div>
        </div>
      </div>

      <div className="mt-3 px-5">
        <div className="h-1.5 w-full bg-limestone">
          <div
            className="h-full bg-[repeating-linear-gradient(45deg,var(--color-signal),var(--color-signal)_4px,transparent_4px,transparent_8px)]"
            style={{ width: `${share}%` }}
          />
        </div>
      </div>

      <div className="px-5 pb-4 pt-2.5">
        <p className="text-[13.5px] leading-snug text-ink/65">
          {Math.round(insight.unknownShare * 100)}% of the movement. No permit,
          forecast or feed we hold covers it.
        </p>
        {checkinNote ? (
          <p className="mt-2 border-l-2 border-survey pl-3 text-[15px] leading-snug">
            <span className="label">You told us</span>
            <br />
            {checkinNote}
          </p>
        ) : (
          <p className="mt-2 border-l-2 border-signal pl-3 text-[15px] leading-snug">
            This is the part you know and we don&rsquo;t. Tell us what was going on
            those days and we&rsquo;ll stop counting it against the street.
          </p>
        )}
      </div>
    </article>
  );
}
