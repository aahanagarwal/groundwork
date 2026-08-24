import Link from "next/link";
import { buildDashboard } from "@/lib/pipeline";
import { narrate } from "@/lib/agent/narrate";
import { buildInsight } from "@/lib/insight";
import { advertisingModule, threatWatchModule } from "@/lib/modules";
import { checkins, proposedActions, type ProposedActionRecord } from "@/lib/domain";
import { CitationProvider, Cited } from "@/components/citations";
import { VerdictBlock, DriverCards } from "@/components/verdict";
import { DailyCheckin } from "@/components/checkin";
import { Capabilities } from "@/components/capabilities";
import { AttributionWaterfall } from "@/components/attribution";
import { RevenueChart } from "@/components/revenue-chart";
import { TradeAreaMap, type MapPin } from "@/components/trade-area-map";
import { ActionCenter } from "@/components/actions";
import { RefusalPanel, InlineRefusal } from "@/components/refusal";
import { EVENT_KIND_META } from "@/lib/scenario-kinds";
import { checkinTagLabel } from "@/lib/checkin-tags";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * THE CONSULTANT SURFACE
 *
 * What a shop owner opens at 7am, ordered by what they need in the time they
 * actually have:
 *
 *   1. THE VERDICT — the answer, in customers and dollars, before any method.
 *   2. WHAT MOVED IT — one card per driver, certainty as a word not a bracket.
 *   3. YOUR TURN — the check-in, aimed squarely at what we could not explain.
 *   4. DO THIS — proposals, each stopping at the approval gate.
 *   5. THE LONG VERSION — the full write-up and the statistical breakdown,
 *      folded away but complete. Nothing is removed to make the top readable;
 *      it is moved.
 *
 * The right column is the ground the whole thing stands on: the drive area
 * against the circle, the daily series, and what the street was doing.
 */
export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { slug } = await params;
  const { scenario: scenarioParam } = await searchParams;

  const result = await buildDashboard(slug, scenarioParam ?? config.demo.defaultScenario);

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-7 py-16">
        <Link href="/" className="label mb-6 inline-block underline">
          ← All addresses
        </Link>
        <RefusalPanel refusal={result.refusal} title="We couldn't resolve this address" />
      </main>
    );
  }

  const { site, scenario, scenarios, tradeArea, events, attribution, ledger, stages } =
    result.data;

  const insight = attribution ? buildInsight(attribution, ledger) : null;

  const narration = attribution
    ? await narrate({ site, attribution, tradeArea, events, scenarioName: scenario.name })
    : null;

  // --- Decision modules -----------------------------------------------------
  const proposals: ProposedActionRecord[] = [];
  const ad = advertisingModule(site, attribution, tradeArea, events, ledger, scenario.key);
  const threat = threatWatchModule(site, events, attribution, scenario.key);
  for (const proposal of [ad, threat]) {
    if (!proposal) continue;
    const existing = proposedActions.find((a) => a.id === proposal.id);
    proposals.push(existing?.decidedAt ? existing : proposedActions.put(proposal));
  }

  // --- The owner's own account ---------------------------------------------
  const siteCheckins = checkins
    .filter((c) => c.siteId === site.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Notes dated inside the window are the answer to the unexplained share, so
  // they are surfaced right next to it rather than left in a list.
  //
  // All of them, not just the most recent: several days in one window can each
  // have had something going on, and picking one by date would silently drop
  // the rest — including, quite possibly, the one that actually explains it.
  const windowCheckins = attribution
    ? siteCheckins
        .filter(
          (c) => c.date >= attribution.windowStart && c.date <= attribution.windowEnd,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const windowNote =
    windowCheckins.length > 0
      ? windowCheckins
          .map((c) => {
            const body = [c.note, c.tags.map(checkinTagLabel).join(", ")]
              .filter(Boolean)
              .join(" — ");
            return `${c.date}: ${body}`;
          })
          .join("  ·  ")
      : null;

  const pins: MapPin[] = events
    .map((e): MapPin | null => {
      const at = e.meta?.["at"] as { lat: number; lng: number } | undefined;
      if (!at) return null;
      return {
        id: e.id,
        lat: at.lat,
        lng: at.lng,
        kind: e.kind === "competitor_open" ? "competitor" : "closure",
        label: e.label,
        insidePolygon: e.polygonMembership.inside,
      };
    })
    .filter((p): p is MapPin => p !== null);

  const weatherStage = stages.find((s) => s.stage === "weather");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <CitationProvider>
      <div className="min-h-screen">
        {/* --- Masthead ---------------------------------------------------- */}
        <header className="sticky top-0 z-30 border-b-[1.5px] border-ink bg-paper">
          <div className="mx-auto w-full max-w-[1440px] px-7 py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-baseline gap-4">
                <Link
                  href="/"
                  className="font-display text-[15px] font-extrabold uppercase tracking-tight"
                >
                  Groundwork
                </Link>
                <span className="hidden h-px w-12 bg-rule sm:block" />
                <div>
                  <div className="font-display text-[17px] font-bold uppercase leading-none">
                    {site.label}
                  </div>
                  <div className="mt-1 font-mono text-[11.5px] text-survey">
                    {site.resolvedAddress ?? site.inputAddress}
                    {site.approximate ? (
                      <span className="ml-2 border border-stone px-1 py-px text-stone">
                        approximate coordinate
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <nav className="flex flex-wrap items-center gap-1">
                {scenarios.map((s) => (
                  <Link
                    key={s.key}
                    href={`/site/${slug}?scenario=${s.key}`}
                    title={s.description}
                    className={`border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-widest ${
                      s.key === scenario.key
                        ? "border-ink bg-ink text-limestone"
                        : "border-rule hover:border-ink"
                    }`}
                  >
                    {s.name}
                  </Link>
                ))}
                <Link
                  href="/ops"
                  className="ml-2 border border-rule px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-widest hover:border-ink"
                >
                  Ops
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-[1440px] gap-8 px-7 py-7 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* --- LEFT: the answer ------------------------------------------ */}
          <main className="space-y-7">
            {insight && attribution ? (
              <>
                <VerdictBlock
                  insight={insight}
                  attribution={attribution}
                  siteLabel={site.label}
                />

                <DriverCards
                  insight={insight}
                  attribution={attribution}
                  checkinNote={windowNote}
                />

                <DailyCheckin
                  siteId={site.id}
                  today={today}
                  windowStart={attribution.windowStart}
                  windowEnd={attribution.windowEnd}
                  unexplainedCustomers={insight.unexplainedCustomers}
                  existing={siteCheckins}
                />
              </>
            ) : (
              <InlineRefusal
                refusal={{
                  code: "no_attribution",
                  message:
                    "There is no till data for this address and scenario, so there is nothing to explain yet.",
                  retryable: false,
                  hint: "Run `npm run seed` to generate the demo ledger.",
                }}
              />
            )}

            <ActionCenter actions={proposals} />

            {/* --- The long version, folded away ------------------------- */}
            {narration && attribution ? (
              <details className="card-flat p-0">
                <summary className="cursor-pointer list-none px-5 py-4">
                  <span className="label">The long version</span>
                  <p className="mt-1 text-[15px] leading-snug">
                    The full write-up and the statistical breakdown, with every band
                    and diagnostic. Nothing above is a summary of anything hidden
                    here — it is the same evidence in different units.
                  </p>
                </summary>

                <div className="space-y-5 border-t border-rule px-5 py-5">
                  <div>
                    <div className="label mb-2">Written by {narration.narratedBy}</div>
                    <div className="space-y-3 text-[16px] leading-[1.5]">
                      {narration.body.map((paragraph, i) => (
                        <p key={i} className="max-w-[66ch]">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </div>

                  <AttributionWaterfall
                    attribution={attribution}
                    scenarioName={scenario.name}
                  />
                </div>
              </details>
            ) : null}
          </main>

          {/* --- RIGHT: the ground ---------------------------------------- */}
          <aside className="space-y-6">
            <section className="card p-0">
              <div className="h-[400px] border-b-[1.5px] border-ink">
                {site.lat !== null && site.lng !== null ? (
                  <TradeAreaMap
                    center={{ lat: site.lat, lng: site.lng }}
                    polygon={tradeArea?.polygonGeoJson ?? null}
                    naiveCircle={tradeArea?.naiveCircleGeoJson ?? null}
                    parcel={site.parcelGeoJson}
                    pins={pins}
                    minutes={tradeArea?.minutes ?? 8}
                    naiveRadiusMiles={tradeArea?.naiveRadiusMiles ?? 5}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6">
                    <InlineRefusal
                      refusal={{
                        code: "no_coordinate",
                        message: "No coordinate for this address, so no map.",
                        retryable: false,
                      }}
                    />
                  </div>
                )}
              </div>

              {tradeArea ? (
                <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 sm:divide-y-0">
                  <Stat
                    label="Your drive area"
                    value={
                      <Cited
                        label={`${tradeArea.minutes}-minute drive area`}
                        value={`${tradeArea.areaSqMi.toFixed(1)} mi²`}
                        derivation={tradeArea.method}
                        detail={tradeArea.detail}
                        provenance={tradeArea.provenance}
                      />
                    }
                  />
                  <Stat
                    label="A circle would be"
                    value={`${tradeArea.naiveAreaSqMi.toFixed(0)} mi²`}
                  />
                  <Stat
                    label="Budget misaimed"
                    value={`${((1 - tradeArea.areaSqMi / tradeArea.naiveAreaSqMi) * 100).toFixed(0)}%`}
                  />
                  <Stat
                    label="Boundary error"
                    value={
                      <Cited
                        label="Boundary accuracy"
                        value={`±${tradeArea.accuracyMeanErrorMinutes.toFixed(2)} min`}
                        derivation={
                          "After interpolating each bearing's boundary we re-probe at exactly that point and " +
                          `measure the drive time actually found there. This is the mean gap between that ` +
                          `measurement and the ${tradeArea.minutes}-minute target — the polygon's own error bar.`
                        }
                        detail={{
                          meanErrorMinutes: tradeArea.accuracyMeanErrorMinutes,
                          maxErrorMinutes: tradeArea.accuracyMaxErrorMinutes,
                          probesTested: tradeArea.probesTested,
                          engine: tradeArea.engine,
                        }}
                        provenance={tradeArea.provenance}
                      />
                    }
                  />
                </div>
              ) : null}
            </section>

            {attribution ? (
              <section className="card p-5">
                <RevenueChart attribution={attribution} />
              </section>
            ) : null}

            <section className="card p-0">
              <header className="border-b border-rule px-5 py-4">
                <div className="label">
                  What was happening on your street &middot; {events.length}
                </div>
                {weatherStage ? (
                  <p className="mt-1.5 text-[13.5px] leading-snug text-ink/70">
                    {weatherStage.ok
                      ? weatherStage.note
                      : "Live weather unavailable — using the scenario's authored weather instead."}
                  </p>
                ) : null}
              </header>
              <ul className="max-h-[340px] divide-y divide-rule overflow-y-auto">
                {events.map((event) => (
                  <li key={event.id} className="px-5 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="label">
                        {EVENT_KIND_META[event.kind]?.label ?? event.kind}
                      </span>
                      <span className="font-mono text-[11px] tabular text-stone">
                        {event.startDate}
                        {event.endDate !== event.startDate ? ` → ${event.endDate}` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[14.5px] leading-snug">
                      <Cited
                        label={event.label}
                        value={event.label}
                        derivation={event.polygonMembership.reason}
                        detail={{ magnitude: event.magnitude, ...event.meta }}
                        provenance={event.provenance}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card-flat p-5">
              <div className="label mb-2">What this build does not claim</div>
              <ul className="space-y-1.5 text-[14px] leading-snug">
                <li>
                  No causality from one location. Every figure says &ldquo;accounts
                  for&rdquo;, carries a range, and names what it cannot explain.
                </li>
                <li>No foot-traffic data. None is purchased and none is modelled.</li>
                <li>
                  Till data is seeded. Square, Shopify and QuickBooks are not
                  connected in this build.
                </li>
                <li>No money moves. The ad payload is a draft that is never sent.</li>
              </ul>
            </section>
          </aside>
        </div>

        {/* --- What this can answer, full width -------------------------- */}
        <div className="mx-auto w-full max-w-[1440px] px-7 pb-14">
          <Capabilities
            insight={insight}
            site={site}
            tradeArea={tradeArea}
            events={events}
            hasMireyeKey={Boolean(config.mireye.apiKey)}
          />
        </div>
      </div>
    </CitationProvider>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="label">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] tabular">{value}</div>
    </div>
  );
}
