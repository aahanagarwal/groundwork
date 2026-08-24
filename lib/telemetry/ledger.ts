import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The call ledger.
 *
 * Every Mireye call — live, replayed, cached, refused — lands here. Two
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

const LEDGER_DIR = path.join(process.cwd(), "data", "telemetry");
const LEDGER_FILE = path.join(LEDGER_DIR, "mireye-calls.jsonl");

function ensureDir(): void {
  if (!existsSync(LEDGER_DIR)) mkdirSync(LEDGER_DIR, { recursive: true });
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function record(entry: Omit<LedgerEntry, "id" | "at">): LedgerEntry {
  const full: LedgerEntry = {
    id: nextId(),
    at: new Date().toISOString(),
    ...entry,
  };
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

/** Credits spent by one agent today (UTC), read back from the ledger so the
 *  ceiling survives a process restart. */
export function spentToday(agent: AgentId): number {
  const today = new Date().toISOString().slice(0, 10);
  return readAll()
    .filter((e) => e.agent === agent && e.at.slice(0, 10) === today)
    .reduce((sum, e) => sum + (e.creditsActual ?? e.creditsEstimated ?? 0), 0);
}

export function byId(id: string): LedgerEntry | undefined {
  return readAll().find((e) => e.id === id);
}
