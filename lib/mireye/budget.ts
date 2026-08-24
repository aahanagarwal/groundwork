import type { Refusal } from "@/lib/datasource";
import { spentToday, type AgentId } from "@/lib/telemetry/ledger";

/**
 * THE BUDGET BROKER
 *
 * Every Mireye call goes through here. No exceptions — the client will not
 * issue a request without a grant.
 *
 * The rule the whole system is built on: a 90-day backtest must not cost more
 * than a 1-day run. That is only true if ground-layer facts are fetched once
 * per address and persisted forever, and if something structurally refuses the
 * call when they aren't. This is that something.
 *
 * Order of operations, always:
 *   1. Cache. If we already have it, no credits are spent and no request goes
 *      out. A cache hit is still recorded — hit rate is a headline metric.
 *   2. Quote. Price the call from Mireye's published formula before making it.
 *   3. Ceiling. Compare against what this agent has already spent today.
 *   4. Grant, defer, or refuse — and a refusal is a typed `Refusal` that the
 *      UI renders as a designed state, never a thrown error.
 *
 * Ceilings are per-agent and per-day because the agents have genuinely
 * different risk profiles. Threat Watch runs unattended on a schedule and must
 * never be able to drain the account overnight; the Resolver runs when a human
 * typed an address and is worth more.
 */

export interface AgentBudget {
  agent: AgentId;
  /** Credits per UTC day. */
  ceiling: number;
  description: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Defaults are sized against the Build plan's 25,000 credits a month.
 *
 * These are DAILY ceilings, deliberately well under the monthly allowance:
 * the job of a ceiling is to stop a runaway loop or a bad deploy draining the
 * account overnight, not to ration normal use. Three full isochrones (~960
 * each) plus resolution and world ingest for every demo address fits inside a
 * single day without touching any of them.
 */
export function budgets(): AgentBudget[] {
  return [
    {
      agent: "resolver",
      ceiling: envInt("BUDGET_RESOLVER", 3000),
      description:
        "Address → parcel. NOT cheap: a parcel is a per-record-licensed county document at 300 credits on Build, so this ceiling is ten resolutions a day. Parcel records are also capped separately at 80/month, which runs out long before the credits do.",
    },
    {
      agent: "isochrone",
      ceiling: envInt("BUDGET_ISOCHRONE", 6000),
      description:
        "The expensive one. ~960 credits per trade area, computed once per address and persisted forever.",
    },
    {
      agent: "world_ingest",
      ceiling: envInt("BUDGET_WORLD_INGEST", 1500),
      description:
        "Site fields around the parcel — nearest cafe, POI density, roads. Weather and permits are free feeds and cost nothing here.",
    },
    {
      agent: "threat_watch",
      ceiling: envInt("BUDGET_THREAT_WATCH", 800),
      description:
        "Runs unattended on a schedule. Deliberately the tightest ceiling — nothing that runs while nobody is watching gets a large budget.",
    },
    {
      agent: "advertising",
      ceiling: envInt("BUDGET_ADVERTISING", 400),
      description:
        "Reads the persisted polygon. Should rarely need Mireye at all.",
    },
    {
      agent: "chat",
      ceiling: envInt("BUDGET_CHAT", 1500),
      description:
        "Ad-hoc /v1/ask questions from the owner. Capped so one curious afternoon can't drain the month.",
    },
    {
      agent: "brief",
      ceiling: envInt("BUDGET_BRIEF", 400),
      description:
        "Weekly brief assembly. Reads persisted facts; rarely calls out.",
    },
  ];
}

export function budgetFor(agent: AgentId): AgentBudget {
  return (
    budgets().find((b) => b.agent === agent) ?? {
      agent,
      ceiling: envInt("BUDGET_DEFAULT", 100),
      description: "Unregistered agent, minimum ceiling.",
    }
  );
}

export interface BudgetState {
  agent: AgentId;
  ceiling: number;
  spent: number;
  remaining: number;
  description: string;
}

export function state(agent: AgentId): BudgetState {
  const budget = budgetFor(agent);
  const spent = spentToday(agent);
  return {
    agent,
    ceiling: budget.ceiling,
    spent,
    remaining: Math.max(0, budget.ceiling - spent),
    description: budget.description,
  };
}

export function allStates(): BudgetState[] {
  return budgets().map((b) => state(b.agent));
}

export type Grant =
  | { granted: true; agent: AgentId; credits: number; remainingAfter: number }
  | { granted: false; refusal: Refusal };

/**
 * Ask permission to spend. Called before every live Mireye request; cached and
 * replayed calls skip it, because they cost nothing.
 */
export function request(
  agent: AgentId,
  estimatedCredits: number,
  context: string,
): Grant {
  const current = state(agent);

  if (estimatedCredits <= current.remaining) {
    return {
      granted: true,
      agent,
      credits: estimatedCredits,
      remainingAfter: current.remaining - estimatedCredits,
    };
  }

  return {
    granted: false,
    refusal: {
      code: "budget_exceeded",
      message:
        `${context} would cost about ${estimatedCredits} credits, but the ${agent} agent has ` +
        `${current.remaining} of its ${current.ceiling} daily credits left (${current.spent} already spent today).`,
      retryable: true,
      hint:
        `This is a self-imposed ceiling, not a Mireye limit. Raise BUDGET_${agent.toUpperCase()} in .env, ` +
        `wait for the daily reset at 00:00 UTC, or use a persisted result instead of recomputing.`,
    },
  };
}
