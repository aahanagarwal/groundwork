import type { WeekAhead } from "@/lib/agent/week-ahead";
import type { LocalResearch } from "@/lib/agent/researcher";
import type { AdCreative } from "@/lib/agent/ad-copy";

/**
 * THE AGENT SURFACES
 *
 * Both panels follow the same rule, and it is the reason they are worth
 * having: the part computed from the till renders whether or not a model is
 * configured, and the part a model wrote is clearly separated from it.
 *
 * The previous version of the reasoning layer failed silently. With no key
 * set, the research agent returned an empty string, the narrator fell back to
 * its template, and nothing anywhere on screen said so - the agents looked
 * like they were working because their absence was indistinguishable from
 * their output. These panels state which half you are looking at.
 */

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

function NotConfigured({ reason }: { reason: string }) {
  return (
    <div className="mt-3 border-l-[3px] border-stone bg-limestone/50 px-3 py-2">
      <div className="label mb-0.5 text-stone">Not generated</div>
      <p className="font-mono text-[11.5px] leading-snug text-ink/60">{reason}</p>
    </div>
  );
}

/**
 * WHAT HAPPENS NEXT
 *
 * Every other panel in this product is retrospective. This one carries the
 * measured effect of whatever has not stopped yet forward over four weeks, so
 * the owner sees the bill before it arrives rather than after.
 */
export function WeekAheadPanel({ plan }: { plan: WeekAhead }) {
  const hasProjection = plan.persisting.length > 0;

  return (
    <section className="card p-0">
      <header className="border-b border-rule px-5 py-4">
        <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink">
          The next {plan.horizonDays} days
        </h2>
        <p className="mt-1 text-[15px] leading-snug text-ink/70">
          Not a forecast model - the measured effect of everything that has not
          stopped yet, carried forward from your own till through{" "}
          <span className="font-mono text-[13.5px]">{plan.asOf}</span>.
        </p>
      </header>

      {hasProjection ? (
        <>
          <div className="grid grid-cols-2 divide-x divide-rule border-b border-rule">
            <div className="px-5 py-4">
              <div className="label">Customers at stake</div>
              <div className="mt-1 font-display text-[30px] font-bold leading-none tabular text-ink">
                {Math.round(plan.projectedCustomers)}
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="label">Margin at stake</div>
              <div className="mt-1 font-display text-[30px] font-bold leading-none tabular text-ink">
                {money(plan.projectedMarginUsd)}
              </div>
            </div>
          </div>

          <ul className="divide-y divide-rule">
            {plan.persisting.map((p) => (
              <li key={p.label} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-[16px] font-bold text-ink">
                    {p.label}
                  </span>
                  <span
                    className="font-mono text-[10px] uppercase tracking-widest"
                    style={{ color: p.certainty === "confirmed" ? "#166534" : "#A16207" }}
                  >
                    {p.certainty}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-[13px] tabular text-ink">
                  {p.customersPerDay.toFixed(1)} customers/day &middot;{" "}
                  {money(p.marginPerDayUsd)}/day
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-ink/50">
                  range {p.perDayLow.toFixed(1)} to {p.perDayHigh.toFixed(1)} a day
                  {p.endsOn
                    ? ` · ends ${p.endsOn} (${p.daysRemaining} days)`
                    : " · no end date on record"}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="px-5 py-4 text-[15px] leading-snug text-ink/60">
          Nothing measured in this window is still running, so there is nothing
          to carry forward. That is a good result, not a missing one.
        </p>
      )}

      {plan.weekShape.length > 0 && plan.busiest && plan.quietest ? (
        <div className="border-t border-rule px-5 py-4">
          <div className="label mb-2">A normal week, from your baseline</div>
          <div className="flex items-end gap-1.5">
            {plan.weekShape.map((d) => {
              const max = Math.max(...plan.weekShape.map((x) => x.typicalTickets));
              return (
                <div key={d.dow} className="flex-1 text-center">
                  <div
                    className="mx-auto w-full bg-ink/80"
                    style={{ height: `${Math.max(4, (d.typicalTickets / max) * 56)}px` }}
                    title={`${d.label}: ${d.typicalTickets} tickets`}
                  />
                  <div className="mt-1 font-mono text-[10px] text-ink/50">
                    {d.label.slice(0, 3)}
                  </div>
                  <div className="font-mono text-[10px] tabular text-ink/70">
                    {d.typicalTickets}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 font-mono text-[11.5px] leading-snug text-ink/60">
            {plan.busiest.label} is your biggest day at {plan.busiest.typicalTickets}{" "}
            tickets; {plan.quietest.label} is your quietest at{" "}
            {plan.quietest.typicalTickets}. Measured on quiet days only, so a
            closure week does not distort it.
          </p>
        </div>
      ) : null}

      {plan.prep.length > 0 ? (
        <div className="border-t-[1.5px] border-ink bg-limestone/40 px-5 py-4">
          <div className="label mb-2">What to do about it</div>
          <ul className="space-y-2">
            {plan.prep.map((line, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-snug text-ink">
                <span className="font-mono text-[11px] text-ink/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : plan.prepUnavailable ? (
        <div className="border-t border-rule px-5 pb-4">
          <NotConfigured reason={plan.prepUnavailable} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * THE UNEXPLAINED SHARE, TURNED INTO QUESTIONS
 *
 * The engine reports what it cannot explain as a number. A number is not
 * actionable. These are the leads on that number - explicitly unconfirmed, and
 * aimed at the one source of evidence the engine has no other way to reach:
 * the person who was standing in the shop.
 */
export function ResearchPanel({
  research,
  unexplainedCustomers,
}: {
  research: LocalResearch;
  unexplainedCustomers: number;
}) {
  const hasContent = research.hypotheses.length > 0 || research.questions.length > 0;

  return (
    <section className="card p-0">
      <header className="border-b border-rule px-5 py-4">
        <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink">
          Leads on what we couldn&apos;t explain
        </h2>
        <p className="mt-1 text-[15px] leading-snug text-ink/70">
          {Math.abs(Math.round(unexplainedCustomers))} customers in this window
          match no feed we have. These are guesses to check, not findings -
          nothing here is evidence until you confirm it.
        </p>
      </header>

      {research.unavailable ? (
        <div className="px-5 pb-4 pt-1">
          <NotConfigured reason={research.unavailable} />
        </div>
      ) : null}

      {hasContent ? (
        <>
          {research.hypotheses.length > 0 ? (
            <ul className="divide-y divide-rule">
              {research.hypotheses.map((h, i) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex gap-3">
                    <span className="font-mono text-[11px] text-ink/40">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="text-[16px] leading-snug text-ink">{h.hypothesis}</p>
                      <p className="mt-1.5 font-mono text-[11.5px] leading-snug text-ink/55">
                        How to check: {h.howToCheck}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {research.questions.length > 0 ? (
            <div className="border-t-[1.5px] border-ink bg-limestone/40 px-5 py-4">
              <div className="label mb-2">Answer these in the check-in above</div>
              <ul className="space-y-3">
                {research.questions.map((q, i) => (
                  <li key={i}>
                    <p className="text-[15px] font-semibold leading-snug text-ink">
                      {q.question}
                    </p>
                    <p className="mt-0.5 font-mono text-[11.5px] leading-snug text-ink/55">
                      {q.whyItMatters}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * WHAT THE AD SHOULD SAY
 *
 * The targeting decision belongs to `advertisingModule` and is arithmetic. The
 * message is a read of the same diagnosis, and getting it wrong is expensive
 * in a specific way: a discount aimed at a reach problem gives away margin on
 * the customers who never left. So the diagnosis renders whether or not a
 * model is configured - it is the part that changes what you do.
 */
export function AdCreativePanel({ creative }: { creative: AdCreative }) {
  return (
    <section className="card p-0">
      <header className="border-b border-rule px-5 py-4">
        <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink">
          What the ad should say
        </h2>
        <p className="mt-1 text-[15px] leading-snug text-ink/70">{creative.diagnosis}</p>
      </header>

      {creative.concepts.length > 0 ? (
        <ul className="divide-y divide-rule">
          {creative.concepts.map((c, i) => (
            <li key={i} className="px-5 py-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-ink/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-display text-[15px] font-bold uppercase tracking-wide text-ink">
                  {c.angle}
                </span>
              </div>
              <blockquote className="mt-2 border-l-[3px] border-signal pl-3 text-[17px] leading-snug text-ink">
                {c.body}
              </blockquote>
              <div className="mt-2 inline-block border border-ink px-2 py-1 font-mono text-[11px] uppercase tracking-widest">
                {c.cta}
              </div>
              <dl className="mt-3 space-y-1 font-mono text-[11.5px] leading-snug text-ink/55">
                <div>
                  <dt className="inline text-ink/40">Grounded in: </dt>
                  <dd className="inline">{c.groundedIn}</dd>
                </div>
                <div>
                  <dt className="inline text-ink/40">Audience: </dt>
                  <dd className="inline">{c.audienceNote}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : creative.unavailable ? (
        <div className="px-5 pb-4 pt-1">
          <NotConfigured reason={creative.unavailable} />
        </div>
      ) : null}
    </section>
  );
}
