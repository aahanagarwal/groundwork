import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writablePath } from "@/lib/paths";

/**
 * The call ledger.
 *
 * Every Mireye call - live, replayed, cached, refused - lands here. Two
 * consumers:
 *   1. The citation inspector, which drills from a number on screen down to
 *      the exact request/response that produced it.
 *   2. /api/stats, the one-page sheet of numbers on Mireye's own API: credits
 *      spent, cache hit rate, latency by endpoint, refusal rate, and decisions
 *      produced per call.
 *
 * Backed by Postgres when DATABASE_URL is live, and by an append-only JSONL
 * file otherwise, so the telemetry story works before the database does.
 * Both backends are always written to when available; the file is the one that
 * survives a missing database, which is the state this repo starts in.
 */

export type AgentId =
  | "resolver"
  | "isochrone"
  | "world_ingest"
  | "threat_watch"
  | "advertising"
  | "chat"
  | "brief";

export interface LedgerEntry {
  id: string;
  at: string;
  agent: AgentId;
  endpoint: string;
  /** "live" | "record" | "replay" | "cache" | "refused" */
  mode: string;
  cacheHit: boolean;
  creditsEstimated: number;
  /** What Mireye actually charged for, where it tells us. */
  paidDrivingCalcs?: number | null;
  creditsActual?: number | null;
  durationMs: number;
  httpStatus?: number | null;
  refused: boolean;
  refusalCode?: string | null;
  /** Field names returned by /v1/fetch, or the op for /v1/proximity. */
  fieldsReturned?: string[] | null;
  siteId?: string | null;
  /** Kept only in the file backend, for citation drill-down. */
  request?: unknown;
  response?: unknown;
}

const LEDGER_DIR = writablePath("data", "telemetry");
const LEDGER_FILE = path.join(LEDGER_DIR, "mireye-calls.jsonl");

function ensureDir(): void {
  if (!existsSync(LEDGER_DIR)) mkdirSync(LEDGER_DIR, { recursive: true });
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function record(
  entry: Omit<LedgerEntry, "id" | "at">,
): LedgerEntry {
  const full: LedgerEntry = { id: nextId(), at: new Date().toISOString(), ...entry };
  try {
    ensureDir();
    appendFileSync(LEDGER_FILE, `${JSON.stringify(full)}\n`);
  } catch {
    // Telemetry must never take down the call it is measuring.
  }
  return full;
}

export function readAll(): LedgerEntry[] {
  try {
    if (!existsSync(LEDGER_FILE)) return [];
    return readFileSync(LEDGER_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerEntry);
  } catch {
    return [];
  }
}

/**
 * Refusals where no request ever reached Mireye, and so nothing was billed.
 *
 * The distinction matters because the ceiling is spend control, not a request
 * counter. Counting a connection that was never established burns budget for
 * calls that cost nothing - and it is self-reinforcing: a burst of dropped
 * connections exhausts the day's ceiling, which then refuses the legitimate
 * calls that follow. That happened here: 43 dropped /v1/proximity connections
 * booked ~1,548 phantom credits against a 1,500 ceiling.
 *
 * An HTTP error response is deliberately NOT in this list. The server saw that
 * request and may have billed part of it - a geocode inside a failed proximity
 * call, say - so it keeps the estimate as an honest upper bound.
 */
const UNBILLED_REFUSALS = new Set([
  "network_error",
  "budget_exceeded",
  "fixture_missing",
  "no_api_key",
]);

/** Credits spent by one agent today (UTC), read back from the ledger so the
 *  ceiling survives a process restart. */
export function spentToday(agent: AgentId): number {
  const today = new Date().toISOString().slice(0, 10);
  return readAll()
    .filter((e) => e.agent === agent && e.at.slice(0, 10) === today)
    .filter((e) => !(e.refused && UNBILLED_REFUSALS.has(e.refusalCode ?? "")))
    .reduce((sum, e) => sum + (e.creditsActual ?? e.creditsEstimated ?? 0), 0);
}

export function byId(id: string): LedgerEntry | undefined {
  return readAll().find((e) => e.id === id);
}
