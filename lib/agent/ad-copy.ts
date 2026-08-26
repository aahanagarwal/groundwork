import type { AttributionResult } from "@/lib/attribution/decompose";
import type { Insight } from "@/lib/insight";
import type { SiteRecord, TradeAreaRecord, WorldEventRecord } from "@/lib/domain";
import { completeJson } from "@/lib/agent/llm";

/**
 * THE ADVERTISING AGENT'S WRITING HALF
 *
 * `advertisingModule` already decides the thing that matters: who to target
 * (the measured drive shed, not a circle) and how much budget is currently
 * aimed at people who physically cannot reach the door. Those are arithmetic
 * and they stay arithmetic.
 *
 * What it could not do is say what the ad should SAY, and that gap is not
 * cosmetic. The right message is a direct read of the diagnosis:
 *
 *   - Tickets down, basket size flat  -> a REACH problem. Fewer people came.
 *     Discounting is the wrong answer; the people who did come spent normally.
 *   - Tickets down, basket size up    -> fewer, higher-value visits. Often a
 *     convenience or occasion shift, not a price objection.
 *   - A competitor measurably taking customers -> the ad has to give a reason
 *     to choose this door over that one, which is a positioning job.
 *   - A closure -> the message is literally "we are open, here is the way in".
 *
 * So the agent is given the diagnosis and the constraint, and drafts concepts
 * against it. It never sets a budget, never states a figure, and never claims
 * a return - the module's own expected-value note is deliberately conservative
 * about that, and prose is exactly where that discipline usually leaks.
 */

export interface AdConcept {
  /** The strategic idea in a few words. */
  angle: string;
  /** Primary text, as it would run. */
  body: string;
  /** Short call to action. */
  cta: string;
  /** Which measured fact this is a response to. */
  groundedIn: string;
  /** Who inside the drive shed this is aimed at, and why. */
  audienceNote: string;
}

export interface AdCreative {
  /** The read of the situation the concepts are answering. */
  diagnosis: string;
  concepts: AdConcept[];
  unavailable?: string;
}

/**
 * Reach or price - the single most decision-relevant split in the object, and
 * it is computed here rather than asked of the model, because the model would
 * get it right most of the time and that is not good enough.
 */
function diagnose(attribution: AttributionResult): string {
  const ticketsDown = attribution.deltaPct < -1;
  const basketMoved = Math.abs(attribution.basketSizeDeltaPct) > 2;
  const basketUp = attribution.basketSizeDeltaPct > 0;

  if (!ticketsDown) {
    return "Tickets are not down against baseline. Nothing here is a rescue campaign; treat this as ordinary demand generation.";
  }
  if (!basketMoved) {
    return (
      `Tickets are down ${Math.abs(attribution.deltaPct).toFixed(1)}% while basket size held ` +
      `(${attribution.basketSizeDeltaPct >= 0 ? "+" : ""}${attribution.basketSizeDeltaPct.toFixed(1)}%). ` +
      "This is a REACH problem: fewer people arrived, and the ones who did spent normally. " +
      "Discounting would give away margin on customers who were never the problem."
    );
  }
  return basketUp
    ? `Tickets are down ${Math.abs(attribution.deltaPct).toFixed(1)}% but basket size is UP ` +
        `${attribution.basketSizeDeltaPct.toFixed(1)}%. Fewer visits, each worth more - a frequency or ` +
        "convenience problem rather than a price objection."
    : `Tickets are down ${Math.abs(attribution.deltaPct).toFixed(1)}% and basket size is down ` +
        `${attribution.basketSizeDeltaPct.toFixed(1)}% as well. Both the number of visits and their value ` +
        "fell, so the offer itself is in question, not just reach.";
}

const SYSTEM = [
  "You write advertising for one independent local business. You are given a finished diagnosis of why its takings moved, and you write concepts that answer that specific diagnosis.",
  "",
  "HARD RULES:",
  "1. Never state a number, percentage, price, discount or dollar figure. Not one. The diagnosis contains numbers; your copy must not repeat them or invent others.",
  "2. Do not promise results, growth, or a return.",
  "3. If the diagnosis says REACH, do not write a discount. Getting this wrong gives away margin on customers who never left.",
  "4. Write like a local shop, not a brand agency. No 'elevate', no 'journey', no 'curated', no exclamation marks.",
  "5. Body copy is at most 25 words. It has to work on a phone, at a glance.",
  "6. Ground every concept in something specific you were told - a road closure, a competitor, the day of the week, the weather. Generic coffee-shop copy is a failure.",
  "",
  'Return JSON exactly: {"concepts":[{"angle":"...","body":"...","cta":"...","groundedIn":"...","audienceNote":"..."}]}',
  "Exactly 3 concepts, each with a genuinely different angle.",
].join("\n");

export async function draftAdCreative(input: {
  site: SiteRecord;
  attribution: AttributionResult;
  insight: Insight;
  tradeArea: TradeAreaRecord | null;
  events: WorldEventRecord[];
}): Promise<AdCreative> {
  const { site, attribution, insight, tradeArea, events } = input;
  const diagnosis = diagnose(attribution);

  const { data, ok, result } = await completeJson<{ concepts: AdConcept[] }>(
    {
      agent: "advertising",
      siteId: site.id,
      system: SYSTEM,
      temperature: 0.75,
      maxTokens: 800,
      user: JSON.stringify(
        {
          business: site.label,
          address: site.resolvedAddress ?? site.inputAddress,
          diagnosis,
          whatIsActuallyHappening: attribution.drivers
            .filter((d) => !d.indistinguishableFromZero)
            .map((d) => `${d.label} (${d.kind})`),
          competitorsInDriveShed: events
            .filter((e) => e.kind === "competitor_open")
            .map((e) => ({
              name: (e.meta?.["businessName"] as string) ?? e.label,
              driveMinutes: e.driveTime?.minutes ?? null,
              note: e.meta?.["note"] ?? null,
            })),
          closures: events
            .filter((e) => e.kind === "road_closure")
            .map((e) => ({
              label: e.label,
              reopens: e.meta?.["scheduledReopen"] ?? null,
            })),
          audience: tradeArea && {
            realDriveMinutes: tradeArea.minutes,
            realAreaSqMi: Number(tradeArea.areaSqMi.toFixed(1)),
            circleTheyWouldOtherwiseBuySqMi: Number(tradeArea.naiveAreaSqMi.toFixed(0)),
          },
          verdict: insight.verdictLine,
        },
        null,
        2,
      ),
    },
    { concepts: [] },
  );

  if (!ok) {
    return {
      diagnosis,
      concepts: [],
      unavailable:
        result.reason === "no_key"
          ? `No model configured (${result.detail}), so no copy was drafted. The diagnosis above is computed from the till and stands on its own.`
          : "The copywriter was unavailable for this run.",
    };
  }

  return { diagnosis, concepts: (data.concepts ?? []).slice(0, 3) };
}
