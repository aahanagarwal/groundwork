import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { EventKind } from "./scenario-kinds";

export { EVENT_KIND_META, type EventKind } from "./scenario-kinds";

/**
 * Demo scenarios live as JSON on disk, not in the database and not in
 * component code, so they can be hand-edited without touching the app. The
 * seed script loads them into Postgres; /admin edits write back to the
 * database only, leaving these files as the pristine starting point you can
 * always re-seed from.
 */


export interface ScenarioEvent {
  kind: EventKind;
  label: string;
  startDate: string;
  endDate: string;
  /** How big the thing was in the world. Cited; shown to the user. */
  magnitude: number;
  /**
   * What it did to the till. This is the generator's ground truth - the
   * attribution engine never reads it, and recovering it is the whole test.
   */
  effect: { ticketsPct: number; basketPct: number };
  source: string;
  sourceUrl?: string;
  meta?: Record<string, unknown>;
}

export interface ScenarioBaseline {
  seed: number;
  dayOfWeekTickets: Record<
    "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat",
    number
  >;
  basketSizeUsd: number;
  grossMarginPct: number;
  dailyAdSpendUsd: number;
  noisePct: number;
  trendPctPerMonth: number;
}

export interface Scenario {
  key: string;
  name: string;
  /** Slug from lib/demo-sites.ts. */
  site: string;
  description: string;
  /** What the author expects the engine to conclude. Shown in /admin so an
   *  operator can tell a real finding from drift. */
  expectation: string;
  sortOrder: number;
  window: { start: string; end: string };
  /** The window the demo lands on - the dip being explained. */
  analysisWindow: { start: string; end: string };
  baseline: ScenarioBaseline;
  events: ScenarioEvent[];
  /**
   * Things that moved the till but that no data source carries - a staff
   * shortage, a rumour on Nextdoor, a broken espresso machine. The generator
   * applies these; the world layer never sees them, so the attribution engine
   * cannot attribute them and reports them as unexplained.
   *
   * Without these the demo is dishonest: a street whose every event is in our
   * feed is a street that does not exist, and an engine that explains 100% of
   * every dip is an engine nobody should believe.
   */
  hiddenEvents?: ScenarioEvent[];
  /**
   * How this business responds to weather, per unit of driver magnitude.
   *
   * The weather DRIVERS are real - Open-Meteo observations at this parcel,
   * scored against its own 1991–2020 normals - so the till reacts to weather
   * Austin actually had. Only the response coefficient is authored, because
   * there is no real till to fit it from. The attribution engine never reads
   * this block; recovering it from the series is the test.
   */
  weatherResponse?: Partial<
    Record<"rain" | "heat", { ticketsPct: number; basketPct: number }>
  >;
}

const SCENARIO_DIR = path.join(process.cwd(), "data", "scenarios");

export function loadScenarios(): Scenario[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = readFileSync(path.join(SCENARIO_DIR, f), "utf8");
      return stripComments(JSON.parse(raw)) as unknown as Scenario;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function loadScenario(key: string): Scenario {
  const found = loadScenarios().find((s) => s.key === key);
  if (!found) {
    throw new Error(
      `No scenario "${key}" in data/scenarios/. Available: ${loadScenarios()
        .map((s) => s.key)
        .join(", ")}`,
    );
  }
  return found;
}

/**
 * The scenario files carry `_comment_*` keys so a human editing them can read
 * what a block is for. JSON has no comments; this is the next best thing.
 */
function stripComments(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_comment")) continue;
    out[k] = v;
  }
  return out;
}

