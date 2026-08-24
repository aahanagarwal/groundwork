import type { AttributionResult } from "@/lib/attribution/decompose";
import type { Provenance } from "@/lib/datasource";
import type {
  ProposedActionRecord,
  SiteRecord,
  TradeAreaRecord,
  WorldEventRecord,
  LedgerDayRecord,
} from "@/lib/domain";

/**
 * THE DECISION MODULES — two of them, built properly, rather than six built thin.
 *
 * Both obey the same contract: read the attribution object and the resolved
 * ground facts, propose an action with a cost, an expected value and the
 * citations behind both, and stop at the approval gate. Neither computes a
 * number the attribution engine didn't already produce, and neither calls a
 * live external API — the ad payload is rendered for review, not submitted.
 */

function now(): string {
  return new Date().toISOString();
}

const DERIVED: Provenance = {
  source: "Groundwork decision module — derived",
  fetchedAt: now(),
  confidence: "medium",
  mocked: false,
  note: "Computed from the attribution output and the persisted trade area. Not fetched from anywhere.",
};

/**
 * ADVERTISING
 *
 * The pitch in one line: stop buying a circle. The audience polygon is the
 * measured drive shed, and when a closure has severed part of the approach,
 * the proposal moves budget out of the unreachable side rather than raising
 * spend into a road that is shut.
 */
export function advertisingModule(
  site: SiteRecord,
  attribution: AttributionResult | null,
  tradeArea: TradeAreaRecord | null,
  events: WorldEventRecord[],
  ledger: LedgerDayRecord[],
  scenarioKey: string,
): ProposedActionRecord | null {
  if (!tradeArea || !attribution) return null;

  const closure = events.find(
    (e) => e.kind === "road_closure" && e.endDate >= attribution.windowStart,
  );
  const closureDriver = attribution.drivers.find(
    (d) => d.kind === "road_closure",
  );

  const dailyAdSpend = ledger.at(-1)?.adSpendUsd ?? 0;
  const windowSpend = dailyAdSpend * attribution.windowDays;

  // Share of the polygon the closure took out, as reported by the permit.
  const areaLostPct =
    typeof closure?.meta?.["polygonAreaLostPct"] === "number"
      ? (closure.meta["polygonAreaLostPct"] as number)
      : 0;

  const wastedSpend = Math.round(windowSpend * (areaLostPct / 100));
  // EXPECTED VALUE — and the reasoning matters more than the number.
  //
  // The tempting version divides total tickets by total ad spend and calls the
  // result a return on the redeployed budget. That is wrong, and badly: it
  // credits every walk-in, every regular and every passer-by to the ad
  // account, and produces a twenty-fold return on any budget you care to name.
  // We have no measurement of what share of tickets ads actually drive — no
  // click data, no matched conversions, no holdout — so we cannot state one.
  //
  // What we CAN state is the waste. During the closure, the share of the
  // polygon behind the works cannot reach the door at all, so the budget aimed
  // there buys nothing at any conversion rate. Moving it is not a bet on
  // uplift; it is a bet that zero is worse than whatever the reachable side
  // already returns. So the expected value here is the recovered spend itself,
  // and nothing is claimed beyond it.
  const expectedValueUsd = closure ? wastedSpend : null;

  const title = closure
    ? `Move $${wastedSpend} of ad budget off the closed approach`
    : `Retarget the ad polygon to the measured ${tradeArea.minutes}-minute drive area`;

  const rationale = closure
    ? `${closure.label} has taken ${areaLostPct}% of the ${tradeArea.minutes}-minute drive area out of reach, and it ` +
      `accounts for ${Math.abs(closureDriver?.points ?? 0).toFixed(1)} points of the ${Math.abs(attribution.deltaPct).toFixed(1)}% ticket drop. ` +
      `Ad spend into that side of the polygon is currently reaching people who cannot get to the door. ` +
      `Redeploy it to the reachable side and pause the discount code — basket size held at ` +
      `${attribution.basketSizeDeltaPct >= 0 ? "+" : ""}${attribution.basketSizeDeltaPct.toFixed(1)}%, so price was never the problem. ` +
      `The value here is the $${wastedSpend} you stop wasting. We are not claiming this wins the tickets back — ` +
      `the road is still shut, and we have no measurement of what share of your tickets ads drive at all.`
    : `Your ad audience is currently a ${tradeArea.naiveRadiusMiles}-mile circle covering ` +
      `${tradeArea.naiveAreaSqMi.toFixed(0)} square miles. The area that can actually reach you in ` +
      `${tradeArea.minutes} minutes is ${tradeArea.areaSqMi.toFixed(1)} square miles. Targeting the measured polygon ` +
      `instead removes the share of budget aimed at people who were never going to drive here.`;

  return {
    id: `${site.id}-${scenarioKey}-advertising`,
    siteId: site.id,
    scenarioKey,
    module: "advertising",
    title,
    rationale,
    expectedValueUsd,
    // Retargeting costs nothing to change; the closure case moves money that
    // is already committed, so the "cost" is what is being redirected.
    costUsd: closure ? wastedSpend : 0,
    horizon: `${attribution.windowDays} days`,
    requiresApproval: true,
    status: "pending",
    // Meta-shaped, and deliberately never sent. No ad account is connected in
    // this build and no OAuth flow exists to connect one.
    payload: {
      _warning:
        "DRAFT ONLY. This object is rendered for review and is never submitted to any ad platform. No ad account is connected.",
      platform: "meta.marketing.v21",
      objective: "OUTCOME_TRAFFIC",
      campaign: {
        name: `Groundwork — ${site.label} — reachable audience`,
        status: "PAUSED",
        daily_budget_cents: Math.round(dailyAdSpend * 100),
        spend_cap_cents: Math.round(
          (closure ? wastedSpend : windowSpend) * 100,
        ),
      },
      targeting: {
        geo_locations: {
          custom_locations: [
            {
              // Meta accepts a custom polygon, which is the whole point.
              name: `${tradeArea.minutes}-min drive area, ${site.label}`,
              polygon: tradeArea.polygonGeoJson.coordinates[0].map(
                ([lng, lat]) => ({
                  latitude: Number(lat.toFixed(6)),
                  longitude: Number(lng.toFixed(6)),
                }),
              ),
            },
          ],
        },
        excluded_geo_locations: closure
          ? {
              _note: `Approach severed by ${closure.label}; excluded until reopening.`,
            }
          : undefined,
      },
      creative: {
        headline: closure
          ? "Still open. Here's the way round."
          : `${site.label} — ${tradeArea.minutes} minutes away`,
        body: closure
          ? `${closure.label} is on until ${closure.meta?.["scheduledReopen"] ?? "further notice"}. We're open the whole time — come in from the south side.`
          : `You're inside our ${tradeArea.minutes}-minute drive area.`,
      },
    },
    evidence: [
      ...(closure ? [closure.provenance] : []),
      tradeArea.provenance,
      DERIVED,
    ],
    createdAt: now(),
    decidedAt: null,
  };
}

/**
 * THREAT WATCH
 *
 * Standing check against the polygon-filtered permit and competitor feed.
 * Deliberately the tightest credit ceiling in the system, because it runs
 * unattended and nothing that runs while nobody is watching gets a large
 * budget.
 */
export function threatWatchModule(
  site: SiteRecord,
  events: WorldEventRecord[],
  attribution: AttributionResult | null,
  scenarioKey: string,
): ProposedActionRecord | null {
  const threats = events.filter(
    (e) => e.kind === "competitor_open" || e.kind === "road_closure",
  );
  if (threats.length === 0) return null;

  const competitor = threats.find((t) => t.kind === "competitor_open");
  const subject = competitor ?? threats[0];
  const driver = attribution?.drivers.find((d) => d.eventId === subject.id);
  const distanceM = subject.meta?.["distanceM"];

  const rationale = competitor
    ? `${competitor.label}${typeof distanceM === "number" ? `, ${distanceM}m from your door` : ""}. ` +
      `Certificate of occupancy ${competitor.meta?.["permit"] ?? "on file"}, filed ${competitor.meta?.["filed"] ?? "date not given"}, ` +
      `issued ${competitor.meta?.["issued"] ?? "date not given"}. ` +
      (driver
        ? driver.indistinguishableFromZero
          ? `We cannot yet separate its effect from noise — the range runs ${driver.pointsLow.toFixed(1)} to ${driver.pointsHigh.toFixed(1)} points and includes zero. Worth watching, not yet worth reacting to.`
          : `It currently accounts for ${Math.abs(driver.points).toFixed(1)} points of your ticket movement, and unlike the weather it does not go away.`
        : `Too new to measure against your own series yet.`)
    : `${subject.label} is active inside your ${site.label} trade area.`;

  return {
    id: `${site.id}-${scenarioKey}-threat-watch`,
    siteId: site.id,
    scenarioKey,
    module: "threat_watch",
    title: competitor
      ? `New competitor filed ${typeof distanceM === "number" ? `${distanceM}m away` : "inside your trade area"}`
      : `${subject.label} is active in your trade area`,
    rationale,
    expectedValueUsd: null,
    costUsd: null,
    horizon: "standing watch",
    // An alert is not a spend. It fires without asking anyone.
    requiresApproval: false,
    status: "draft",
    payload: {
      alertType: competitor ? "competitor_opened" : "street_event",
      subject: subject.label,
      distanceM: typeof distanceM === "number" ? distanceM : null,
      permit: subject.meta?.["permit"] ?? null,
      filed: subject.meta?.["filed"] ?? null,
      polygonMembership: subject.polygonMembership,
    },
    evidence: [subject.provenance],
    createdAt: now(),
    decidedAt: null,
  };
}
