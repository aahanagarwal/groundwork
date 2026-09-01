import type { ScenarioBaseline } from "@/lib/scenarios";

/**
 * THE CLIENT-SAFE HALF OF "CREATE A NEW USE CASE"
 *
 * Split out from lib/agent/scenario-builder.ts for the same reason
 * lib/scenario-kinds.ts exists on its own: lib/scenarios.ts reads files with
 * node:fs at module scope, and scenario-builder.ts additionally imports the
 * OpenAI/Groq client - both are server-only. Importing either from a "use
 * client" page pulls that whole chain into the browser bundle, which
 * Turbopack refuses outright.
 *
 * This file is pure - no fs, no network, no model calls. It is what the
 * review-step form imports directly for its live, in-browser validation, and
 * what scenario-builder.ts imports back for the server-side re-check before
 * anything is written to disk. Both sides run the exact same rules, so a form
 * that says "looks good" is never contradicted by the server a request later.
 */

export const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DowKey = (typeof DOW_KEYS)[number];

export interface ScenarioDraft {
  businessLabel: string;
  address: string;
  scenarioName: string;
  scenarioDescription: string;
  ticketsSun: number | null;
  ticketsMon: number | null;
  ticketsTue: number | null;
  ticketsWed: number | null;
  ticketsThu: number | null;
  ticketsFri: number | null;
  ticketsSat: number | null;
  basketSizeUsd: number | null;
  /** As a percent, 0-100 - the form a business owner actually thinks in. */
  grossMarginPct: number | null;
  dailyAdSpendUsd: number | null;
  analysisWindowStart: string | null;
  analysisWindowEnd: string | null;
}

export const EMPTY_DRAFT: ScenarioDraft = {
  businessLabel: "",
  address: "",
  scenarioName: "",
  scenarioDescription: "",
  ticketsSun: null,
  ticketsMon: null,
  ticketsTue: null,
  ticketsWed: null,
  ticketsThu: null,
  ticketsFri: null,
  ticketsSat: null,
  basketSizeUsd: null,
  grossMarginPct: null,
  dailyAdSpendUsd: null,
  analysisWindowStart: null,
  analysisWindowEnd: null,
};

/** The field list a human-readable form derives its labels from - one place,
 *  shared by parse-confidence reporting and by the review-step UI. */
export const DRAFT_FIELD_LABELS: Record<keyof ScenarioDraft, string> = {
  businessLabel: "Business name",
  address: "Full address",
  scenarioName: "A short name for this situation",
  scenarioDescription: "One or two sentences describing it",
  ticketsSun: "Typical Sunday customers",
  ticketsMon: "Typical Monday customers",
  ticketsTue: "Typical Tuesday customers",
  ticketsWed: "Typical Wednesday customers",
  ticketsThu: "Typical Thursday customers",
  ticketsFri: "Typical Friday customers",
  ticketsSat: "Typical Saturday customers",
  basketSizeUsd: "Average sale, in dollars",
  grossMarginPct: "Gross margin, as a percent",
  dailyAdSpendUsd: "Typical daily ad spend, in dollars",
  analysisWindowStart: "Start of the period you want explained",
  analysisWindowEnd: "End of the period you want explained",
};

export const cap = (k: DowKey): keyof ScenarioDraft =>
  `tickets${k[0].toUpperCase()}${k.slice(1)}` as keyof ScenarioDraft;

// --- Validation --------------------------------------------------------------

export type FieldErrors = Partial<Record<keyof ScenarioDraft, string>>;

const TICKET_FIELDS: (keyof ScenarioDraft & `tickets${string}`)[] = [
  "ticketsSun",
  "ticketsMon",
  "ticketsTue",
  "ticketsWed",
  "ticketsThu",
  "ticketsFri",
  "ticketsSat",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The real constraints the pipeline needs to hold. Runs in the browser as the
 * user fills the form AND again on the server before anything is written -
 * same function, same rules, so the two can never disagree.
 *
 * `windowStart`/`windowEnd` bound what counts as "recent" for the analysis
 * window - the till-data range this flow builds automatically (see
 * defaultWindow below), passed in here rather than recomputed so the two stay
 * in sync.
 */
export function validateDraft(
  draft: ScenarioDraft,
  opts: { requireAddress: boolean; windowStart: string; windowEnd: string },
): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.businessLabel.trim()) errors.businessLabel = "Required.";
  if (opts.requireAddress && !draft.address.trim()) {
    errors.address = "Required - a full street address, city, state and ZIP.";
  }
  if (!draft.scenarioName.trim()) errors.scenarioName = "Required.";
  else if (draft.scenarioName.length > 80) errors.scenarioName = "Keep it under 80 characters.";
  if (!draft.scenarioDescription.trim()) errors.scenarioDescription = "Required.";
  else if (draft.scenarioDescription.length > 500) {
    errors.scenarioDescription = "Keep it under 500 characters.";
  }

  for (const field of TICKET_FIELDS) {
    const v = draft[field];
    if (v === null || !Number.isFinite(v)) errors[field] = "Required - a whole number.";
    else if (v <= 0 || v > 3000) errors[field] = "Must be between 1 and 3000.";
    else if (!Number.isInteger(v)) errors[field] = "Whole customers only.";
  }

  if (draft.basketSizeUsd === null) errors.basketSizeUsd = "Required.";
  else if (draft.basketSizeUsd <= 0 || draft.basketSizeUsd > 500) {
    errors.basketSizeUsd = "Must be between $0 and $500.";
  }

  if (draft.grossMarginPct === null) errors.grossMarginPct = "Required.";
  else if (draft.grossMarginPct <= 0 || draft.grossMarginPct > 100) {
    errors.grossMarginPct = "Must be between 0 and 100.";
  }

  if (draft.dailyAdSpendUsd === null) errors.dailyAdSpendUsd = "Required - enter 0 if you don't run ads.";
  else if (draft.dailyAdSpendUsd < 0 || draft.dailyAdSpendUsd > 5000) {
    errors.dailyAdSpendUsd = "Must be between $0 and $5000.";
  }

  const { analysisWindowStart: aStart, analysisWindowEnd: aEnd } = draft;
  if (aStart || aEnd) {
    if (!aStart || !DATE_RE.test(aStart)) errors.analysisWindowStart = "Use YYYY-MM-DD.";
    if (!aEnd || !DATE_RE.test(aEnd)) errors.analysisWindowEnd = "Use YYYY-MM-DD.";
    if (!errors.analysisWindowStart && !errors.analysisWindowEnd) {
      if (aStart! > aEnd!) errors.analysisWindowEnd = "Must be on or after the start date.";
      else if (aStart! < opts.windowStart || aEnd! > opts.windowEnd) {
        errors.analysisWindowStart = `Must fall within the last 90 days (${opts.windowStart} to ${opts.windowEnd}).`;
      } else {
        const days = (Date.parse(aEnd!) - Date.parse(aStart!)) / 86_400_000 + 1;
        if (days > 30) errors.analysisWindowEnd = "Keep the explained period to 30 days or fewer.";
      }
    }
  }

  return errors;
}

/**
 * The default till-data window: the last 90 days ending today. Not asked of
 * the user - a random-noise percentage or a 90-day data range is not
 * something a business owner can meaningfully report, so this flow never asks
 * for it. The analysis window (the period being explained) defaults to the
 * final 9 days of it when the user did not name one, matching the shape of
 * the built-in scenarios.
 */
export function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export function defaultAnalysisWindow(window: { start: string; end: string }): {
  start: string;
  end: string;
} {
  const end = new Date(`${window.end}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 8);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/**
 * Every scenario the demo ships with clusters around these two values (see
 * data/scenarios/*.json). Kept here, next to the type it fills in
 * (`ScenarioBaseline`), so a change to that type is a compile error here
 * rather than silent drift.
 */
export const BASELINE_DEFAULTS: Pick<ScenarioBaseline, "noisePct" | "trendPctPerMonth"> = {
  noisePct: 0.06,
  trendPctPerMonth: 0.2,
};

/**
 * Weather sensitivity nobody is asked for either, for the same reason.
 * Deliberately more modest than the built-in scenarios' hand-tuned values -
 * this flow has no real till to fit a coefficient from, so it defaults to a
 * plausible, moderate response rather than a dramatic one.
 */
export const WEATHER_RESPONSE_DEFAULTS = {
  rain: { ticketsPct: -0.12, basketPct: 0.01 },
  heat: { ticketsPct: -0.06, basketPct: 0.03 },
} as const;
