import { completeJson } from "@/lib/agent/llm";
import { uniqueScenarioKey, type Scenario, type ScenarioBaseline, type ScenarioEvent } from "@/lib/scenarios";
import type { EventKind } from "@/lib/scenario-kinds";
import {
  BASELINE_DEFAULTS,
  DOW_KEYS,
  DRAFT_FIELD_LABELS,
  EMPTY_DRAFT,
  WEATHER_RESPONSE_DEFAULTS,
  cap,
  defaultAnalysisWindow,
  defaultWindow,
  type ScenarioDraft,
} from "@/lib/scenario-draft";

// Re-exported so every existing call site (both API routes) can keep
// importing the draft type and its helpers from this one module, same as
// before the client/server split - see lib/scenario-draft.ts for why the
// split exists and what actually lives where now.
export {
  BASELINE_DEFAULTS,
  DRAFT_FIELD_LABELS,
  EMPTY_DRAFT,
  WEATHER_RESPONSE_DEFAULTS,
  defaultWindow,
  validateDraft,
  type FieldErrors,
  type ScenarioDraft,
} from "@/lib/scenario-draft";

/**
 * TURNING A PARAGRAPH INTO A SCENARIO
 *
 * "Create a new use case" has exactly one manual data-entry step - the review
 * form - and this module is what keeps that step small. It has two jobs, kept
 * strictly separate because they carry different honesty obligations:
 *
 *   PARSE  (parseBusinessParagraph) reads what the owner actually wrote and
 *          extracts real facts. Anything it is not confident about is left
 *          missing rather than guessed, because a wrong number silently
 *          filled in is worse than a blank field asking to be filled in.
 *
 *   INVENT (generateSyntheticEvents) is the opposite: the owner did not
 *          describe a road closure or a new competitor, so anything here is
 *          manufactured to make the demo interesting. It is tagged as such in
 *          the record itself - `source: SYNTHETIC_SOURCE` - so nothing
 *          downstream (a citation, a chart, a brief) can present it as a real
 *          finding by accident.
 *
 * Neither function ever computes a number the way the attribution engine
 * does. They only produce the INPUTS the deterministic generator
 * (lib/fixtures/generate-ledger.ts) and the pipeline already know how to turn
 * into a dashboard - the same two-stage discipline every other agent in this
 * app follows.
 */

/** What a real event created by this flow is never mistaken for. */
export const SYNTHETIC_SOURCE = "LLM-simulated - not a live feed, not verified";

export interface ParseResult {
  draft: ScenarioDraft;
  /** Fields the model left null, in the order a form should ask for them. */
  missing: (keyof ScenarioDraft)[];
  unavailable?: string;
}

const PARSE_SYSTEM = [
  "You extract structured facts from one paragraph a small-business owner wrote about their own business. You do not run a business and you do not know anything about this one beyond what is written.",
  "",
  "HARD RULES:",
  "1. Extract a field ONLY when the paragraph states or clearly implies it. If it is not there, output null for that field. A null is not a failure - it is the correct answer when the information genuinely is not in the text.",
  "2. Never invent a number. 'Business does well' is not a revenue figure. 'Downtown Austin' is not a full address unless a street number is present.",
  "3. If the owner gives one number for typical daily customers rather than seven day-of-week numbers, apply a normal weekday/weekend shape yourself (weekends roughly 25-40% busier than weekdays) rather than repeating the same number seven times, and note in your reasoning that these are inferred, not stated - but still return numbers, since a same-number-every-day baseline is worse than a shaped guess for every field that DOES have a real anchor.",
  "4. grossMarginPct is a percent from 0 to 100, not a fraction. Coffee/food service is typically 55-70% if not stated - only fill this from the paragraph if it says something about costs or margin; otherwise leave it null rather than assuming a typical number, since margin is not something people mention in passing the way revenue is.",
  "5. analysisWindowStart/End is the period the owner wants explained - a recent dip or spike they mention. If no specific dates or timeframe are given, leave both null. NEITHER date may fall after today - this describes something that already happened, never something still in the future. If your best reading of a relative phrase would land past today, leave both null rather than guess forward.",
  "6. Dates, if given, come back as YYYY-MM-DD. If a relative date is used (\"last month\", \"in July\") and no year is stated, use the most recent occurrence relative to today's date, which you are given.",
  "",
  'Return JSON exactly: {"businessLabel":str|null,"address":str|null,"scenarioName":str|null,"scenarioDescription":str|null,"ticketsSun":num|null,"ticketsMon":num|null,"ticketsTue":num|null,"ticketsWed":num|null,"ticketsThu":num|null,"ticketsFri":num|null,"ticketsSat":num|null,"basketSizeUsd":num|null,"grossMarginPct":num|null,"dailyAdSpendUsd":num|null,"analysisWindowStart":str|null,"analysisWindowEnd":str|null}',
].join("\n");

/**
 * Read one free-text paragraph and pull out whatever the model can honestly
 * find. Everything else comes back null and is the review form's job.
 */
export async function parseBusinessParagraph(
  paragraph: string,
  opts: { existingBusinessLabel?: string; existingAddress?: string } = {},
): Promise<ParseResult> {
  const { data, ok, result } = await completeJson<Partial<ScenarioDraft>>(
    {
      agent: "create",
      system: PARSE_SYSTEM,
      temperature: 0.2,
      maxTokens: 500,
      user: JSON.stringify({
        today: new Date().toISOString().slice(0, 10),
        // When attaching a scenario to an address that is already resolved
        // (Ahaan's case - reuse an existing site rather than creating a new
        // one), the business and address are already known and are not asked
        // of the model at all.
        businessAlreadyKnown: opts.existingBusinessLabel ?? null,
        addressAlreadyKnown: opts.existingAddress ?? null,
        paragraph,
      }),
    },
    {},
  );

  const draft: ScenarioDraft = {
    ...EMPTY_DRAFT,
    ...data,
    businessLabel: opts.existingBusinessLabel ?? data.businessLabel ?? "",
    address: opts.existingAddress ?? data.address ?? "",
  };

  // A relative date ("last Saturday", "the week after") is exactly the kind
  // of thing a model gets subtly wrong - off by a day, or reasoning past
  // "today" into the future. `validateDraft` catches this today by refusing
  // the submission with a message naming the valid range, which is correct
  // but leaves a wrong, model-written date sitting pre-filled in the field
  // for the user to notice and fix themselves. Since a date the pipeline
  // cannot honestly use is no better than no date at all, an out-of-range or
  // malformed pair is discarded here instead - it reverts to "not found",
  // the same honest state as if the paragraph had never mentioned dates.
  const bounds = defaultWindow();
  const dateOk = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= bounds.start && d <= bounds.end;
  if (
    !dateOk(draft.analysisWindowStart) ||
    !dateOk(draft.analysisWindowEnd) ||
    (draft.analysisWindowStart as string) > (draft.analysisWindowEnd as string)
  ) {
    draft.analysisWindowStart = null;
    draft.analysisWindowEnd = null;
  }

  const missing = (Object.keys(DRAFT_FIELD_LABELS) as (keyof ScenarioDraft)[]).filter(
    (k) => {
      if (k === "address" && opts.existingAddress) return false;
      if (k === "businessLabel" && opts.existingBusinessLabel) return false;
      const v = draft[k];
      return v === null || v === "";
    },
  );

  if (!ok && result.reason === "no_key") {
    return {
      draft,
      missing: Object.keys(DRAFT_FIELD_LABELS) as (keyof ScenarioDraft)[],
      unavailable: `No model configured (${result.detail}). Every field below needs filling in by hand.`,
    };
  }

  return { draft, missing };
}

// --- Synthetic events --------------------------------------------------------

export interface GeneratedEvents {
  events: ScenarioEvent[];
  hiddenEvents: ScenarioEvent[];
  unavailable?: string;
}

const NON_WEATHER_KINDS: EventKind[] = [
  "road_closure",
  "event",
  "holiday",
  "competitor_open",
  "fuel_price",
  "news",
];

const EVENTS_SYSTEM = [
  "You invent plausible local events for one small business, to make a demo attribution scenario interesting. These events are NOT real - they are clearly labelled as simulated and nobody will mistake them for verified data.",
  "",
  "HARD RULES:",
  `1. Only use these event kinds: ${NON_WEATHER_KINDS.join(", ")}. NEVER generate "rain" or "heat" - real weather for this address is pulled live from a real weather API elsewhere in the system, and a fabricated weather event would collide with it.`,
  "2. Every event needs a start and end date inside the given window, a magnitude from 0 to 1 (how big a deal it was), and an effect on tickets and basket size as signed percentages (e.g. -0.15 means a 15% drop). Make the sign and size plausible for the kind - a competitor opening nearby should hurt tickets a little, not by half; a positive local event can raise tickets.",
  "3. Optionally include ONE 'hiddenEvents' entry - something that would move the till but that no feed would ever carry (a staffing issue, an equipment failure, a supply problem). This is what keeps the demo honest: without something unexplained, the story is too clean to be believed. It is fine to return zero hidden events if nothing fits.",
  "4. Ground events in the specific business and address you are given - a coffee shop and a hardware store should not get the same event.",
  "5. Between 1 and 4 events is normal. Zero is a valid, honest answer if you cannot think of anything plausible for this address - do not pad the list to hit a quota.",
  "",
  'Return JSON exactly: {"events":[{"kind":"...","label":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","magnitude":0.0,"ticketsPct":0.0,"basketPct":0.0}],"hiddenEvents":[... same shape ...]}',
].join("\n");

/**
 * Manufacture 1-4 plausible, clearly-synthetic local events for the analysis
 * window. Returns an empty list rather than throwing when no model is
 * configured - a scenario with no discovered events is a valid, honest
 * result, not a failure state.
 */
export async function generateSyntheticEvents(input: {
  businessLabel: string;
  address: string;
  category: string;
  windowStart: string;
  windowEnd: string;
  analysisWindowStart: string;
  analysisWindowEnd: string;
}): Promise<GeneratedEvents> {
  type RawEvent = {
    kind: string;
    label: string;
    startDate: string;
    endDate: string;
    magnitude: number;
    ticketsPct: number;
    basketPct: number;
  };

  const { data, ok, result } = await completeJson<{
    events: RawEvent[];
    hiddenEvents: RawEvent[];
  }>(
    {
      agent: "create",
      temperature: 0.8,
      maxTokens: 900,
      system: EVENTS_SYSTEM,
      user: JSON.stringify(input),
    },
    { events: [], hiddenEvents: [] },
  );

  if (!ok) {
    return {
      events: [],
      hiddenEvents: [],
      unavailable:
        result.reason === "no_key"
          ? `No model configured (${result.detail}). This scenario will run with no authored events - real weather still applies.`
          : "Event generation was unavailable for this run.",
    };
  }

  const toScenarioEvent = (e: RawEvent): ScenarioEvent | null => {
    if (!NON_WEATHER_KINDS.includes(e.kind as EventKind)) return null;
    if (!e.label || !e.startDate || !e.endDate) return null;
    return {
      kind: e.kind as EventKind,
      label: e.label,
      startDate: e.startDate,
      endDate: e.endDate,
      magnitude: clamp01(Number(e.magnitude) || 0.3),
      effect: {
        ticketsPct: clampEffect(Number(e.ticketsPct) || 0),
        basketPct: clampEffect(Number(e.basketPct) || 0),
      },
      source: SYNTHETIC_SOURCE,
      meta: { synthetic: true },
    };
  };

  return {
    events: (data.events ?? []).map(toScenarioEvent).filter((e): e is ScenarioEvent => e !== null).slice(0, 4),
    hiddenEvents: (data.hiddenEvents ?? [])
      .map(toScenarioEvent)
      .filter((e): e is ScenarioEvent => e !== null)
      .slice(0, 1)
      .map((e) => ({ ...e, source: `${SYNTHETIC_SOURCE} - by construction, no feed carries this` })),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function clampEffect(n: number): number {
  return Math.max(-0.6, Math.min(0.6, n));
}

// --- Assembly ------------------------------------------------------------

/** Cheap, deterministic string hash - a PRNG seed, nothing more. */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/**
 * Assemble the final `Scenario` object from a validated draft plus what the
 * rest of the flow has resolved. Assumes `validateDraft` (lib/scenario-draft)
 * has already been called and returned no errors - this function does not
 * re-check.
 */
export function buildScenario(input: {
  draft: ScenarioDraft;
  siteSlug: string;
  generated: GeneratedEvents;
}): Scenario {
  const { draft, siteSlug, generated } = input;
  const window = defaultWindow();
  const analysisWindow: { start: string; end: string } =
    draft.analysisWindowStart && draft.analysisWindowEnd
      ? { start: draft.analysisWindowStart, end: draft.analysisWindowEnd }
      : defaultAnalysisWindow(window);

  const key = uniqueScenarioKey(draft.scenarioName);

  const dayOfWeekTickets = Object.fromEntries(
    DOW_KEYS.map((k) => [k, draft[cap(k)] as number]),
  ) as ScenarioBaseline["dayOfWeekTickets"];

  const baseline: ScenarioBaseline = {
    seed: hashSeed(key),
    dayOfWeekTickets,
    basketSizeUsd: draft.basketSizeUsd as number,
    grossMarginPct: (draft.grossMarginPct as number) / 100,
    dailyAdSpendUsd: draft.dailyAdSpendUsd as number,
    ...BASELINE_DEFAULTS,
  };

  return {
    key,
    name: draft.scenarioName,
    site: siteSlug,
    description: draft.scenarioDescription,
    expectation:
      "User-authored scenario, created from a free-text description. No fixed expectation was authored for it - the events below are LLM-simulated, not a claim about what really happened.",
    sortOrder: Date.now(),
    window,
    analysisWindow,
    baseline,
    events: generated.events,
    hiddenEvents: generated.hiddenEvents.length > 0 ? generated.hiddenEvents : undefined,
    weatherResponse: { ...WEATHER_RESPONSE_DEFAULTS },
    custom: true,
    createdAt: new Date().toISOString(),
  };
}
