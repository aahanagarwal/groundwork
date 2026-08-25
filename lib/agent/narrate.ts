import type { AttributionResult } from "@/lib/attribution/decompose";
import type { SiteRecord, TradeAreaRecord, WorldEventRecord } from "@/lib/domain";
import { EVENT_KIND_META } from "@/lib/scenario-kinds";
import { config } from "@/lib/config";
import { getMarketContext } from "./researcher";

/**
 * THE NARRATOR
 *
 * The hard rule, enforced here rather than hoped for: the language model never
 * computes a number. It receives the attribution engine's output object and
 * turns it into sentences. Every figure in the prose is one that was already
 * in that object before the model saw it.
 *
 * Two implementations:
 *   · a deterministic template, which is what runs with no OPENAI_API_KEY and
 *     is also the reference the model version is judged against
 *   · the model, given the object and a prompt forbidding it from asserting
 *     anything not in that object
 *
 * The deterministic one is not a degraded mode. It is the floor: if the
 * template can say the true thing clearly, the model has no excuse to say
 * something else, and the brief always renders.
 */

export interface NarrationInput {
  site: SiteRecord;
  attribution: AttributionResult;
  tradeArea: TradeAreaRecord | null;
  events: WorldEventRecord[];
  scenarioName: string;
}

export interface Narration {
  headline: string;
  body: string[];
  /** "template" or the model id. Shown in the UI - a reader should know who
   *  wrote the sentences they are reading. */
  narratedBy: string;
}

function fmt(n: number, digits = 0): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

/**
 * The dossier's voice: name the thing, then say what to do, then say what you
 * don't know. Short sentences. No hedging that isn't earned, and no confidence
 * that isn't either.
 */
export function narrateDeterministic(input: NarrationInput): Narration {
  const { attribution: a, events, tradeArea } = input;
  const down = a.deltaPct < 0;
  const top = a.drivers[0];
  const body: string[] = [];

  // --- Headline -------------------------------------------------------------
  const headline = top
    ? down
      ? `Your ${dayName(a)} aren't broken. ${sentenceCase(EVENT_KIND_META[top.kind]?.short ?? top.kind)} took ${Math.abs(top.points).toFixed(0)} of the ${Math.abs(a.deltaPct).toFixed(0)} points.`
      : `Tickets ran ${Math.abs(a.deltaPct).toFixed(0)}% ahead of normal, and most of it wasn't luck.`
    : `Tickets moved ${fmt(a.deltaPct)}%, and nothing on the street explains it.`;

  // --- What happened --------------------------------------------------------
  body.push(
    `Ticket count ${down ? "fell" : "rose"} ${Math.abs(a.deltaPct).toFixed(1)}% from ${formatDate(a.windowStart)} to ${formatDate(a.windowEnd)} - ` +
      `${a.observedTickets.toLocaleString()} against an expected ${a.baselineTickets.toLocaleString()}. ` +
      `That expectation comes from your own quiet days, not an industry average.`,
  );

  // --- Why ------------------------------------------------------------------
  if (a.drivers.length === 0) {
    body.push(
      `Nothing was happening on your street in this window - no closure, no permit, no weather worth the name. ` +
        `So we can't tell you this was the street, and we won't pretend otherwise. A move this size is inside ` +
        `normal week-to-week variation for you.`,
    );
  } else {
    for (const d of a.drivers.slice(0, 3)) {
      const meta = d.provenance.note ? ` (${d.provenance.note})` : "";
      if (d.indistinguishableFromZero) {
        body.push(
          `${sentenceCase(d.label)} was active on ${d.activeDays} of those days, but we can't separate its effect ` +
            `from noise - the range runs from ${fmt(d.pointsLow)} to ${fmt(d.pointsHigh)} points, which includes zero. ` +
            `Treat it as unproven.`,
        );
      } else {
        body.push(
          `${sentenceCase(d.label)} accounts for ${Math.abs(d.points).toFixed(1)} points${meta}, ` +
            `somewhere between ${Math.abs(d.pointsHigh).toFixed(1)} and ${Math.abs(d.pointsLow).toFixed(1)} once you allow for how few days we have.`,
        );
      }
    }
  }

  // --- The honest part ------------------------------------------------------
  const unexplainedShare =
    Math.abs(a.deltaPct) > 0
      ? Math.abs(a.unexplainedPoints) / Math.abs(a.deltaPct)
      : 0;

  if (Math.abs(a.unexplainedPoints) >= 1) {
    body.push(
      `${Math.abs(a.unexplainedPoints).toFixed(1)} points - ${(unexplainedShare * 100).toFixed(0)}% of the move - ` +
        `we cannot account for. No permit, forecast or feed we hold covers it. ` +
        `${unexplainedShare > 0.4 ? "That is a large share, and it means the explanation above is incomplete. Look inside the shop for those days: staffing, equipment, a bad review." : "That is the part worth checking inside the shop."}`,
    );
  }

  if (a.diagnostics.saturatedWindow) {
    body.push(
      `One caveat you should hear: something was happening on every single day of this window, so there are no ` +
        `quiet days inside it to check the drivers against. The total is solid. The split between the drivers is an estimate.`,
    );
  }

  // --- Reach or price -------------------------------------------------------
  if (Math.abs(a.basketSizeDeltaPct) < 2) {
    body.push(
      `Basket size held flat at ${fmt(a.basketSizeDeltaPct)}%. The people who reached you spent what they always spend. ` +
        `This was reach, not price - so discounting would be answering a question nobody asked.`,
    );
  } else if (a.basketSizeDeltaPct > 0) {
    body.push(
      `Basket size rose ${fmt(a.basketSizeDeltaPct)}%. Fewer people, each spending more. That is a mix shift, not just lost footfall.`,
    );
  }

  // --- The ground -----------------------------------------------------------
  if (tradeArea) {
    const shrink = (1 - tradeArea.areaSqMi / tradeArea.naiveAreaSqMi) * 100;
    body.push(
      `For context on where your customers actually come from: your ${tradeArea.minutes}-minute drive area covers ` +
        `${tradeArea.areaSqMi.toFixed(1)} square miles. The ${tradeArea.naiveRadiusMiles}-mile circle an ad platform would ` +
        `sell you covers ${tradeArea.naiveAreaSqMi.toFixed(0)} - ${shrink.toFixed(0)}% of that budget is aimed at people ` +
        `who were never going to drive to you.`,
    );
  }

  const closures = events.filter((e) => e.kind === "road_closure");
  for (const closure of closures) {
    const reopen = closure.meta?.["scheduledReopen"];
    if (typeof reopen === "string") {
      body.push(`The street is scheduled to reopen on ${formatDate(reopen)}.`);
    }
  }

  return { headline, body, narratedBy: "template" };
}

/**
 * The model version. Same object, same constraints, better prose.
 *
 * The system prompt does the enforcement, and the fallback does the rest: if
 * the model is unavailable or slow, the template renders instead of an error.
 */
export async function narrate(input: NarrationInput): Promise<Narration> {
  const deterministic = narrateDeterministic(input);
  if (!config.openai.enabled) return deterministic;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  
  // Call the Research Sub-Agent to get localized, business-centric context
  const marketContext = await getMarketContext(input.site);

  const system = [
    "You are Groundwork, a consultant that explains a local business's revenue using the physical facts of its address.",
    "",
    "ABSOLUTE CONSTRAINTS - violating any of these makes your output unusable:",
    "1. You may ONLY narrate the attribution object you are given. You may not compute, estimate, or state any number, percentage, or dollar figure that is not already present in that object.",
    "2. You may not assert a causal claim the object does not support. If a driver's band crosses zero, you must say it may have done nothing.",
    "3. If unexplained variance is large, or the window is flagged saturated, you must say so plainly and must NOT smooth it into a confident story. 'I can't fully explain this one' is the required framing in that case.",
    "4. Never say 'caused'. Say 'accounts for', 'consistent with', 'lines up with'.",
    "",
    "MARKET CONTEXT FROM RESEARCH SUB-AGENT:",
    "Use the following insights about this specific business and location to make your tone more business-centric and locally relevant. Do not force these in if they don't apply to the data, but use them to contextualize how you talk to the owner:",
    marketContext,
    "",
    "VOICE: plain English for a shop owner who is busy. Short sentences. Name the thing, say what to do, say what you don't know. No consultant-speak, no bullet lists, no headings. Four to seven short paragraphs.",
    "",
    "A reference narration written by a deterministic template is included. It is factually correct. Do not contradict it; improve only its readability.",
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(
            {
              business: input.site.label,
              address: input.site.resolvedAddress ?? input.site.inputAddress,
              attribution: input.attribution,
              tradeArea: input.tradeArea && {
                minutes: input.tradeArea.minutes,
                areaSqMi: input.tradeArea.areaSqMi,
                naiveAreaSqMi: input.tradeArea.naiveAreaSqMi,
                naiveRadiusMiles: input.tradeArea.naiveRadiusMiles,
              },
              events: input.events.map((e) => ({
                kind: e.kind,
                label: e.label,
                startDate: e.startDate,
                endDate: e.endDate,
                meta: e.meta,
              })),
              referenceNarration: deterministic,
            },
            null,
            2,
          ),
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) return deterministic;

    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return {
      headline: deterministic.headline,
      body: paragraphs,
      narratedBy: config.openai.model,
    };
  } catch {
    // A model outage must never take down the brief.
    return deterministic;
  }
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Which day of the week took the worst hit - the dossier's "your Tuesdays". */
function dayName(a: AttributionResult): string {
  const worst = new Map<number, { residual: number; count: number }>();
  for (const p of a.series) {
    if (!p.inWindow) continue;
    const dow = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    const entry = worst.get(dow) ?? { residual: 0, count: 0 };
    entry.residual += p.residual;
    entry.count += 1;
    worst.set(dow, entry);
  }
  let best = -1;
  let bestMean = 0;
  for (const [dow, entry] of worst) {
    const mean = entry.residual / entry.count;
    if (mean < bestMean) {
      bestMean = mean;
      best = dow;
    }
  }
  const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  return best >= 0 ? names[best] : "weekdays";
}
