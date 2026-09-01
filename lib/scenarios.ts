import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { bundledPath, writablePath } from "@/lib/paths";
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
  /** Slug from lib/demo-sites.ts - OR a slug resolved live for a user-created
   *  business, when `custom` is set. */
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
  /**
   * Set on every scenario the "Create a new use case" flow writes, and only
   * those. The three hand-authored scenarios are shared TEMPLATES - any of
   * the seeded demo sites can run "Road closure dip" against its own trade
   * area, which is why nothing here filters `Dashboard.scenarios` by site
   * today. A scenario built from one owner's own paragraph is the opposite: it
   * describes one specific business and has no business appearing as an
   * option on every other site's picker. This flag is what lets both rules
   * hold at once - see the filter in lib/pipeline.ts's Dashboard.scenarios.
   */
  custom?: boolean;
  /** ISO timestamp of creation, for user-generated scenarios only. */
  createdAt?: string;
}

// Read from both: the three committed scenarios ship with the deployment and
// are never written to at runtime. Anything created through "Create a new use
// case" lands in the writable directory instead - /tmp on serverless, the
// project directory locally - so the shipped files are never touched and a
// user's own scenario survives exactly as long as the store does.
const BUNDLED_SCENARIO_DIR = bundledPath("data", "scenarios");
const WRITABLE_SCENARIO_DIR = writablePath("data", "scenarios");

function readDir(dir: string): Scenario[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = readFileSync(path.join(dir, f), "utf8");
      return stripComments(JSON.parse(raw)) as unknown as Scenario;
    });
}

export function loadScenarios(): Scenario[] {
  const bundled = readDir(BUNDLED_SCENARIO_DIR);
  const writable =
    WRITABLE_SCENARIO_DIR === BUNDLED_SCENARIO_DIR ? [] : readDir(WRITABLE_SCENARIO_DIR);
  // A writable-dir file with the same key as a bundled one wins - it can only
  // get there via a deliberate re-save through the same key, and the newer
  // write should be the one that answers.
  const byKey = new Map(bundled.map((s) => [s.key, s]));
  for (const s of writable) byKey.set(s.key, s);
  return [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
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
 * Persist a scenario built from a user's own description. Always writes to
 * the writable directory - the "Create a new use case" flow is the only
 * runtime caller, and it must never be able to overwrite one of the three
 * committed fixtures even if a key collided (uniqueScenarioKey below is what
 * actually prevents that from happening in practice).
 */
export function writeScenario(scenario: Scenario): void {
  if (!existsSync(WRITABLE_SCENARIO_DIR)) {
    mkdirSync(WRITABLE_SCENARIO_DIR, { recursive: true });
  }
  writeFileSync(
    path.join(WRITABLE_SCENARIO_DIR, `${scenario.key}.json`),
    JSON.stringify(scenario, null, 2),
  );
}

/**
 * Turn a human-chosen name into a key that does not collide with anything
 * already on disk - appending -2, -3, ... until it doesn't. Slugify matches
 * the convention `lib/resolver.ts` already uses for addresses, so a scenario
 * key and a site slug are visually consistent with each other.
 */
export function uniqueScenarioKey(name: string): string {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "scenario";
  const existing = new Set(loadScenarios().map((s) => s.key));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
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
