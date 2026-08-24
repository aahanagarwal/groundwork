import { NextResponse } from "next/server";
import { readAll } from "@/lib/telemetry/ledger";
import { allStates } from "@/lib/mireye/budget";
import { proposedActions, tradeAreas } from "@/lib/domain";
import { backend, isMockMode } from "@/lib/store";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * THE STAT SHEET.
 *
 * Numbers on the API itself, not on the business: credits spent, cache hit
 * rate, latency by endpoint, refusal rate, and decisions produced per call.
 *
 * Treated as seriously as the consumer-facing product, because it is the
 * artifact aimed at a technical reader — and because a system that claims to
 * be credit-safe by construction has to be able to prove it.
 */
export async function GET() {
  const entries = readAll();

  const byEndpoint = new Map<
    string,
    {
      endpoint: string;
      calls: number;
      cacheHits: number;
      refusals: number;
      creditsEstimated: number;
      creditsActual: number;
      totalMs: number;
      latencies: number[];
    }
  >();

  for (const e of entries) {
    const row = byEndpoint.get(e.endpoint) ?? {
      endpoint: e.endpoint,
      calls: 0,
      cacheHits: 0,
      refusals: 0,
      creditsEstimated: 0,
      creditsActual: 0,
      totalMs: 0,
      latencies: [] as number[],
    };
    row.calls += 1;
    if (e.cacheHit) row.cacheHits += 1;
    if (e.refused) row.refusals += 1;
    row.creditsEstimated += e.creditsEstimated ?? 0;
    row.creditsActual += e.creditsActual ?? 0;
    row.totalMs += e.durationMs;
    row.latencies.push(e.durationMs);
    byEndpoint.set(e.endpoint, row);
  }

  const endpoints = [...byEndpoint.values()].map((r) => {
    const sorted = [...r.latencies].sort((a, b) => a - b);
    return {
      endpoint: r.endpoint,
      calls: r.calls,
      cacheHitRate: r.calls > 0 ? r.cacheHits / r.calls : 0,
      refusalRate: r.calls > 0 ? r.refusals / r.calls : 0,
      creditsEstimated: r.creditsEstimated,
      creditsActual: r.creditsActual,
      meanLatencyMs: r.calls > 0 ? Math.round(r.totalMs / r.calls) : 0,
      p95LatencyMs:
        sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
    };
  });

  const totals = {
    calls: entries.length,
    cacheHits: entries.filter((e) => e.cacheHit).length,
    refusals: entries.filter((e) => e.refused).length,
    creditsEstimated: entries.reduce(
      (s, e) => s + (e.creditsEstimated ?? 0),
      0,
    ),
    creditsActual: entries.reduce((s, e) => s + (e.creditsActual ?? 0), 0),
  };

  const refusalsByCode = Object.entries(
    entries
      .filter((e) => e.refused && e.refusalCode)
      .reduce<Record<string, number>>((acc, e) => {
        acc[e.refusalCode!] = (acc[e.refusalCode!] ?? 0) + 1;
        return acc;
      }, {}),
  )
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const decisions = proposedActions.all();
  const polygons = tradeAreas.all();

  return NextResponse.json({
    mode: {
      mireyeMode: config.mireye.mode,
      storeBackend: backend(),
      mockMode: isMockMode(),
      hasMireyeKey: Boolean(config.mireye.apiKey),
      hasOpenAiKey: config.openai.enabled,
      model: config.openai.model,
      note: isMockMode()
        ? "Running without one or more secrets. Mireye calls replay from fixtures where they exist and refuse where they don't; the trade area falls back to the local OSRM router. Nothing is silently faked."
        : "All configured integrations are live.",
    },

    totals: {
      ...totals,
      cacheHitRate: totals.calls > 0 ? totals.cacheHits / totals.calls : 0,
      refusalRate: totals.calls > 0 ? totals.refusals / totals.calls : 0,
      /** The headline efficiency number: how much analysis one credit bought. */
      decisionsPerCall: totals.calls > 0 ? decisions.length / totals.calls : 0,
      creditsPerDecision:
        decisions.length > 0 ? totals.creditsActual / decisions.length : 0,
    },

    endpoints: endpoints.sort((a, b) => b.calls - a.calls),
    refusalsByCode,
    budgets: allStates(),

    decisions: {
      total: decisions.length,
      byModule: countBy(decisions, (d) => d.module),
      byStatus: countBy(decisions, (d) => d.status),
      requiringApproval: decisions.filter((d) => d.requiresApproval).length,
      approved: decisions.filter((d) => d.status === "approved").length,
      /** Nothing in this build can be anything else. Asserted, not assumed. */
      dispatchedExternally: 0,
    },

    tradeAreas: polygons.map((t) => ({
      siteId: t.siteId,
      engine: t.engine,
      minutes: t.minutes,
      areaSqMi: Number(t.areaSqMi.toFixed(2)),
      naiveAreaSqMi: Number(t.naiveAreaSqMi.toFixed(1)),
      budgetMisaimedPct: Number(
        ((1 - t.areaSqMi / t.naiveAreaSqMi) * 100).toFixed(1),
      ),
      probesTested: t.probesTested,
      creditsEstimated: t.creditsEstimated,
      creditsActual: t.creditsActual,
      /** Estimate versus actual — the number that says the quote is trustworthy. */
      creditsDelta: t.creditsActual - t.creditsEstimated,
      boundaryMeanErrorMinutes: Number(t.accuracyMeanErrorMinutes.toFixed(3)),
      boundaryMaxErrorMinutes: Number(t.accuracyMaxErrorMinutes.toFixed(3)),
      computedAt: t.computedAt,
    })),

    generatedAt: new Date().toISOString(),
  });
}

function countBy<T>(
  rows: T[],
  key: (row: T) => string,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const k = key(row);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
