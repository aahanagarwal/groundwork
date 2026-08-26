import type { AttributionResult } from "@/lib/attribution/decompose";
import type { Insight } from "@/lib/insight";
import type { SiteRecord, TradeAreaRecord, WorldEventRecord } from "@/lib/domain";
import { complete, completeJson } from "@/lib/agent/llm";

/**
 * THE LOCAL RESEARCH AGENT
 *
 * What it is for: this engine measures what it can see in a feed - closures,
 * weather, competitor openings - and reports the rest as unexplained. That
 * unexplained share is not noise. It is the part of the business that lives in
 * things no API carries: a festival that shut the parking, a staff change, a
 * neighbouring tenant going dark, a school holiday.
 *
 * The agent's job is to turn that gap into a small number of checkable local
 * hypotheses and, more usefully, into questions the owner can answer in ten
 * seconds. The owner's answer then becomes evidence via the daily check-in,
 * which is the one place in this product where new facts legitimately enter.
 *
 * What it is NOT for, and the previous version got this wrong: it does not
 * "search Reddit". A language model recalling its training data is not
 * research, and formatting recall as though it were retrieved evidence is
 * exactly the move this product exists to refuse. Everything here is labelled
 * a hypothesis, sits behind the measured drivers rather than beside them, and
 * is written to be falsified by the person who actually stood in the shop.
 *
 * The model is also given the real numbers - the size of the gap, which
 * drivers were measured, how big the drive shed is - so its suggestions are
 * anchored to this window rather than to generic small-business advice.
 */

export interface LocalHypothesis {
  /** One sentence, specific enough to be checked. */
  hypothesis: string;
  /** How the owner could confirm or kill it today. */
  howToCheck: string;
}

export interface OwnerQuestion {
  /** Answerable from memory, in one line. */
  question: string;
  /** What the answer would let the engine do differently. */
  whyItMatters: string;
}

export interface LocalResearch {
  hypotheses: LocalHypothesis[];
  questions: OwnerQuestion[];
  /** Present when nothing was generated, so a surface can say why. */
  unavailable?: string;
}

export const EMPTY_RESEARCH: LocalResearch = { hypotheses: [], questions: [] };

function windowSummary(
  site: SiteRecord,
  attribution: AttributionResult,
  insight: Insight,
  tradeArea: TradeAreaRecord | null,
  events: WorldEventRecord[],
): string {
  const measured = attribution.drivers.map(
    (d) =>
      `${d.label} (${d.points >= 0 ? "+" : ""}${d.points.toFixed(1)} points over ${d.activeDays} active days${
        d.indistinguishableFromZero ? ", band crosses zero so it may have done nothing" : ""
      })`,
  );

  return JSON.stringify(
    {
      business: site.label,
      address: site.resolvedAddress ?? site.inputAddress,
      county: site.county,
      window: { start: attribution.windowStart, end: attribution.windowEnd, days: attribution.windowDays },
      ticketsObserved: attribution.observedTickets,
      ticketsExpected: attribution.baselineTickets,
      changeVsNormalPct: Number(attribution.deltaPct.toFixed(1)),
      basketSizeChangePct: Number(attribution.basketSizeDeltaPct.toFixed(1)),
      measuredDrivers: measured,
      unexplainedPoints: Number(attribution.unexplainedPoints.toFixed(1)),
      unexplainedCustomers: Math.round(insight.unexplainedCustomers),
      driversTheEngineCouldNotSize: attribution.unidentifiable.map((u) => u.label),
      driveArea: tradeArea && {
        minutes: tradeArea.minutes,
        areaSqMi: Number(tradeArea.areaSqMi.toFixed(1)),
      },
      whatWasOnTheStreet: events.map((e) => ({
        kind: e.kind,
        label: e.label,
        from: e.startDate,
        to: e.endDate,
      })),
    },
    null,
    2,
  );
}

const SYSTEM = [
  "You are Groundwork's local research agent, working for the owner of one small business at one address.",
  "",
  "You are given a completed statistical attribution for one trading window. Part of the movement is measured and attributed. Part is not. Your job concerns ONLY the part that is not.",
  "",
  "HARD RULES:",
  "1. Never restate, recompute, contradict or refine any number you are given. The arithmetic is finished and it is not yours.",
  "2. Never claim something DID happen. You have no feed and no evidence. Everything you produce is a hypothesis for the owner to confirm or kill.",
  "3. Every hypothesis must be specific to this address, this business type, and this calendar window. 'Consider seasonality' is worthless. 'The week of 6 July falls right after the 4 July holiday, so regulars may still have been away' is useful.",
  "4. Prefer causes that would be invisible to permits, weather feeds and competitor listings - staffing, equipment, parking, neighbouring tenants, school and university calendars, local events, roadworks signage, delivery app outages.",
  "5. If the unexplained share is small, say so by returning fewer hypotheses. Do not pad.",
  "",
  "QUESTIONS: also write questions for the owner. A good question is answerable from memory in one line, is about the specific window, and would change what the engine concludes. 'Was anything different about your mornings that week?' is weak. 'Were you short-staffed on the morning shift between 7 and 9 July?' is strong.",
  "",
  'Return JSON exactly: {"hypotheses":[{"hypothesis":"...","howToCheck":"..."}],"questions":[{"question":"...","whyItMatters":"..."}]}',
  "At most 3 hypotheses and 3 questions.",
].join("\n");

/**
 * Hypotheses and questions aimed at the unexplained share of one window.
 *
 * Returns empty rather than failing when there is no key or the model is
 * unavailable - the brief around it is complete without this, which is the
 * whole reason it is safe to add.
 */
export async function researchLocalContext(input: {
  site: SiteRecord;
  attribution: AttributionResult;
  insight: Insight;
  tradeArea: TradeAreaRecord | null;
  events: WorldEventRecord[];
}): Promise<LocalResearch> {
  const { site, attribution, insight, tradeArea, events } = input;

  // Nothing meaningful is left over, so there is nothing to hypothesise about.
  // Asking anyway invents a problem for the owner to worry about.
  if (Math.abs(attribution.unexplainedPoints) < 1.5) {
    return {
      ...EMPTY_RESEARCH,
      unavailable:
        "The measured drivers account for effectively all of this window, so there is nothing unexplained to chase.",
    };
  }

  const { data, ok, result } = await completeJson<LocalResearch>(
    {
      agent: "chat",
      siteId: site.id,
      system: SYSTEM,
      user: windowSummary(site, attribution, insight, tradeArea, events),
      temperature: 0.6,
      maxTokens: 800,
    },
    EMPTY_RESEARCH,
  );

  if (!ok) {
    return {
      ...EMPTY_RESEARCH,
      unavailable:
        result.reason === "no_key"
          ? `No model configured (${result.detail}), so no local hypotheses were generated.`
          : "The research agent was unavailable for this run.",
    };
  }

  return {
    hypotheses: (data.hypotheses ?? []).slice(0, 3),
    questions: (data.questions ?? []).slice(0, 3),
  };
}

/**
 * The one-paragraph market note the narrator folds into its brief.
 *
 * Kept separate from the structured output above because it serves a different
 * surface and must not smuggle claims into prose that the structured version
 * would have labelled as hypotheses.
 */
export async function getMarketContext(
  site: SiteRecord,
  research: LocalResearch,
): Promise<string> {
  if (research.hypotheses.length === 0) return "";

  const result = await complete({
    agent: "chat",
    siteId: site.id,
    cheap: true,
    temperature: 0.3,
    maxTokens: 220,
    system: [
      "Compress the following hypotheses into at most three short bullet points of local context for a consultant writing to a shop owner.",
      "They are UNCONFIRMED possibilities. Preserve that framing - use 'may', 'could', 'worth checking'.",
      "Do not add anything that is not in the input. Do not state any number.",
    ].join("\n"),
    user: research.hypotheses
      .map((h, i) => `${i + 1}. ${h.hypothesis} (check: ${h.howToCheck})`)
      .join("\n"),
  });

  return result.ok ? result.text : "";
}
