import Link from "next/link";
import { buildDashboard } from "@/lib/pipeline";
import { narrate, type Narration } from "@/lib/agent/narrate";
import { researchLocalContext, EMPTY_RESEARCH, type LocalResearch } from "@/lib/agent/researcher";
import { projectWeekAhead, writePrepNotes } from "@/lib/agent/week-ahead";
import { WeekAheadPanel, ResearchPanel, AdCreativePanel } from "@/components/agents";
import { draftAdCreative } from "@/lib/agent/ad-copy";
import { buildInsight, perEventImpact } from "@/lib/insight";
import { advertisingModule, threatWatchModule } from "@/lib/modules";
import { checkins, proposedActions, type ProposedActionRecord } from "@/lib/domain";
import { CitationProvider, Cited } from "@/components/citations";
import { VerdictBlock, DriverCards } from "@/components/verdict";
import { DailyCheckin } from "@/components/checkin";
import { Capabilities } from "@/components/capabilities";
import { MathBreakdown } from "@/components/math-breakdown";
import { RevenueChart } from "@/components/revenue-chart";
import { TradeAreaMap, type MapPin } from "@/components/trade-area-map";
import { ActionCenter } from "@/components/actions";
import { RefusalPanel, InlineRefusal } from "@/components/refusal";
import { EVENT_KIND_META } from "@/lib/scenario-kinds";
import { checkinTagLabel } from "@/lib/checkin-tags";
import { config } from "@/lib/config";
import { GettingStartedBanner } from "@/components/getting-started";
import { DashboardTabs, ScenarioSelector } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

const SITE_CACHE_TTL_MS = 15 * 60 * 1000;
const siteReasoningCache = new Map<
  string,
  {
    research: LocalResearch;
    weekAhead: Awaited<ReturnType<typeof writePrepNotes>> | null;
    adCreative: Awaited<ReturnType<typeof draftAdCreative>> | null;
    narration: Narration | null;
    at: number;
  }
>();

/**
 * THE CONSULTANT SURFACE
 *
 * What a shop owner opens at 7am, ordered by what they need in the time they
 * actually have:
 *
 *   1. THE VERDICT - the answer, in customers and dollars, before any method.
 *   2. WHAT MOVED IT - one card per driver, certainty as a word not a bracket.
 *   3. YOUR TURN - the check-in, aimed squarely at what we could not explain.
 *   4. DO THIS - proposals, each stopping at the approval gate.
 *   5. THE LONG VERSION - the full write-up and the statistical breakdown,
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

  const {
    site,
    scenario,
    scenarios,
    tradeArea,
    events,
    discardedEvents,
    attribution,
    ledger,
    stages,
  } = result.data;

  const insight = attribution ? buildInsight(attribution, ledger) : null;

  // --- The reasoning layer (Cached in-memory for instant 0ms transitions) ----
  const cacheKey = `${site.id}:${scenario.key}`;
  const hit = siteReasoningCache.get(cacheKey);

  let research = hit ? hit.research : EMPTY_RESEARCH;
  let weekAhead = hit ? (hit.weekAhead as Awaited<ReturnType<typeof writePrepNotes>>) : null;
  let adCreative = hit ? (hit.adCreative as Awaited<ReturnType<typeof draftAdCreative>>) : null;
  let narration = hit ? hit.narration : null;

  if (!hit || Date.now() - hit.at > SITE_CACHE_TTL_MS) {
    const [freshResearch, freshWeekAhead, freshAdCreative] = await Promise.all([
      attribution && insight
        ? researchLocalContext({ site, attribution, insight, tradeArea, events })
        : Promise.resolve(EMPTY_RESEARCH),
      attribution && insight
        ? writePrepNotes(site, projectWeekAhead(attribution, insight, ledger, events))
        : Promise.resolve(null),
      attribution && insight
        ? draftAdCreative({ site, attribution, insight, tradeArea, events })
        : Promise.resolve(null),
    ]);

    research = freshResearch;
    weekAhead = freshWeekAhead;
    adCreative = freshAdCreative;

    narration = attribution
      ? await narrate({
          site,
          attribution,
          tradeArea,
          events,
          scenarioName: scenario.name,
          research,
        })
      : null;

    siteReasoningCache.set(cacheKey, {
      research,
      weekAhead,
      adCreative,
      narration,
      at: Date.now(),
    });
  }

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
  // the rest - including, quite possibly, the one that actually explains it.
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
              .join(" - ");
            return `${c.date}: ${body}`;
          })
          .join("  ·  ")
      : null;

  // What the engine concluded about each driver individually. The verdict page
  // groups drivers by kind, which is right there and wrong here: two coffee
  // shops on one street are one row in the verdict and two separate pins on a
  // map, and a pin has to answer for itself.
  const impactByEvent =
    attribution ? perEventImpact(attribution, ledger) : new Map();

  // Drivers the engine could not size at all, with the structural reason why.
  // A pin with no number needs to say which of the two it is: "measured at
  // roughly zero" and "impossible to measure from this data" look identical
  // on a map and mean completely different things.
  const unidentifiableReason = new Map<string, string>(
    (attribution?.unidentifiable ?? []).map((u) => [u.eventId, u.reason]),
  );

  // Rejected drivers are drawn too, hollow. The polygon's argument is "we
  // looked at this and it does not reach you", and that cannot be made with
  // the rejects deleted - which is what the map used to receive.
  const pins: MapPin[] = [...events, ...discardedEvents]
    .map((e): MapPin | null => {
      const at = e.meta?.["at"] as { lat: number; lng: number } | undefined;
      if (!at) return null;
      const kind =
        e.kind === "competitor_open"
          ? "competitor"
          : e.kind === "road_closure"
            ? "closure"
            : e.kind === "event"
              ? "event"
              : "permit";
      const impact = impactByEvent.get(e.id) ?? null;
      return {
        id: e.id,
        lat: at.lat,
        lng: at.lng,
        kind,
        label: e.label,
        insidePolygon: e.polygonMembership.inside,
        membershipReason: e.polygonMembership.reason,
        distanceM: e.polygonMembership.distanceM,
        driveTime: e.driveTime,
        meta: e.meta ?? undefined,
        unidentifiableReason: unidentifiableReason.get(e.id),
        impact: impact
          ? {
              customers: impact.customers,
              customersLow: impact.customersLow,
              customersHigh: impact.customersHigh,
              marginUsd: impact.marginUsd,
              activeDays: impact.activeDays,
              certainty: impact.certainty,
              certaintyReason: impact.certaintyReason,
            }
          : null,
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
              <ScenarioSelector
                scenarios={scenarios}
                currentScenarioKey={scenario.key}
                slug={slug}
              />
            </div>
          </div>
        </header>

        <DashboardTabs
          overview={
            <div className="space-y-10">
              <GettingStartedBanner siteLabel={site.label} />
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
            </div>
          }
          actions={
            <div className="space-y-10">
              {weekAhead ? <WeekAheadPanel plan={weekAhead} /> : null}
              <ActionCenter actions={proposals} />
              {insight ? (
                <ResearchPanel
                  research={research}
                  unexplainedCustomers={insight.unexplainedCustomers}
                />
              ) : null}
            </div>
          }
          advertising={
            <div className="space-y-10">
              <section className="card p-0 overflow-hidden">
                <header className="border-b border-rule px-5 py-4">
                  <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink mb-1">
                    Trade Area Map
                  </h2>
                  <p className="text-[15px] leading-snug text-ink/70">
                    The real 8-minute drive polygon vs a naive 5-mile radius.
                  </p>
                </header>
                <div className="relative h-[560px] border-b-[1.5px] border-ink lg:h-[520px]">
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
                    <div className="flex h-full items-center justify-center p-6 bg-limestone">
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
                  <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 sm:divide-y-0 bg-paper">
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
                          `measurement and the ${tradeArea.minutes}-minute target - the polygon's own error bar.`
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
            
            {adCreative ? <AdCreativePanel creative={adCreative} /> : null}

            {attribution ? (
              <section className="card p-5 mt-10">
                <RevenueChart attribution={attribution} />
              </section>
            ) : null}
            </div>
          }
          threats={
            <div className="space-y-10">
              <section className="card p-0">
                <header className="border-b border-rule px-5 py-4">
                  <h2 className="font-display text-[24px] font-bold uppercase tracking-tight text-ink mb-1">
                    Street Events &middot; {events.length} found
                  </h2>
                  {weatherStage ? (
                    <p className="mt-1.5 text-[14px] leading-snug text-ink/70">
                      {weatherStage.ok
                        ? weatherStage.note
                        : "Live weather unavailable - using the scenario's authored weather instead."}
                    </p>
                  ) : null}
                </header>
                <ul className="divide-y divide-rule overflow-y-auto max-h-[600px] bg-paper">
                  {events.map((event) => (
                    <li key={event.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                        <span className="font-mono text-[11px] uppercase tracking-widest px-2 py-1 bg-ink text-limestone">
                          {EVENT_KIND_META[event.kind]?.label ?? event.kind}
                        </span>
                        <span className="font-mono text-[12px] tabular text-stone">
                          {event.startDate}
                          {event.endDate !== event.startDate ? ` → ${event.endDate}` : ""}
                        </span>
                      </div>
                      <div className="text-[16px] leading-snug">
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

                {discardedEvents.length > 0 ? (
                  <div className="border-t-[1.5px] border-ink bg-limestone/40 px-5 py-4">
                    <h3 className="label mb-2 text-ink/50">
                      Considered, then discarded &middot; {discardedEvents.length}
                    </h3>
                    <p className="mb-3 text-[13px] leading-snug text-ink/60">
                      Found in the feeds for this window, then dropped for
                      falling outside the {tradeArea?.minutes ?? 8}-minute drive
                      polygon. They are listed because a driver you can see was
                      rejected is worth more than one you never hear about.
                    </p>
                    <ul className="space-y-2">
                      {discardedEvents.map((event) => (
                        <li
                          key={event.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[12px] text-ink/55"
                        >
                          <span>{event.label}</span>
                          <span className="tabular">
                            {event.polygonMembership.distanceM
                              ? `${(event.polygonMembership.distanceM / 1609.344).toFixed(1)} mi from the door`
                              : "outside the polygon"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            </div>
          }
          math={
            <div>
              {narration && attribution ? (
                <MathBreakdown
                  narration={narration}
                  attribution={attribution}
                  scenarioName={scenario.name}
                />
              ) : (
                <div className="card-flat p-5">
                  <p className="text-ink/60">Math unavailable for this scenario.</p>
                </div>
              )}
            </div>
          }
        />

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
