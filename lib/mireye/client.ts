import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";

import { config } from "@/lib/config";
import type { Provenance, Refusal, SourceResult } from "@/lib/datasource";
import { ok, refuse } from "@/lib/datasource";
import * as broker from "./budget";
import { record, type AgentId } from "@/lib/telemetry/ledger";
import {
  CREDITS_PER_ASK,
  CREDITS_PER_GEOCODE,
  estimateFetchCredits,
  estimateLookupCredits,
  estimateProximityCredits,
} from "./credits";
import type {
  AskRequest,
  AskResponse,
  DistanceOp,
  DistanceResponse,
  FetchRequest,
  FetchResponse,
  GeocodeRequest,
  GeocodeResponse,
  LaborShedOp,
  LaborShedResponse,
  LookupRequest,
  LookupResponse,
  MireyeErrorBody,
  ProximityOp,
  ScreenOp,
  ScreenResponse,
} from "./types";

/**
 * The one way this app talks to Mireye.
 *
 * Every call follows the same four steps, in this order, with no way around
 * them:
 *
 *   CACHE   - a recorded response for this exact request body short-circuits
 *             everything. Costs nothing, records a cache hit.
 *   QUOTE   - price the call from Mireye's published formula (credits.ts).
 *   GRANT   - ask the Budget Broker (budget.ts). A denial is a typed Refusal
 *             the UI renders as a designed state, not a thrown error.
 *   RECORD  - write the outcome to the ledger whatever happened: hit, miss,
 *             success, refusal, timeout.
 *
 * Modes, set by MIREYE_MODE:
 *   record - call live on a cache miss, then persist the response as a fixture
 *   replay - never touch the network (the default when no key is present)
 *   live   - always call, never read or write fixtures
 *
 * Record/replay is not only a cost saver. Once the three seeded Austin
 * addresses are recorded, the demo never depends on a network, a rate limit,
 * or a credit balance. A missing fixture in replay mode is a typed refusal
 * naming the exact call to record - never a silent empty result.
 */

/**
 * Force IPv4 for outbound calls, unless told not to.
 *
 * api.mireye.com publishes both an A and an AAAA record, and on networks where
 * the AAAA route is advertised but not actually reachable, Node's Happy
 * Eyeballs implementation races the two and stalls on the dead one until the
 * socket times out. The symptom is miserable to diagnose: `fetch failed` with
 * an AggregateError of ETIMEDOUT, roughly 300ms, on a host that answers curl
 * instantly - because curl falls back to IPv4 and undici does not.
 *
 * It cost this project a day of phantom credits before it was found: every
 * failed attempt was retried on the next render, and the Budget Broker
 * eventually refused a whole day's legitimate calls on the strength of
 * connections that never opened.
 *
 * Set GROUNDWORK_FORCE_IPV4=0 on a network where IPv6 genuinely works and this
 * is unwanted.
 */
if (process.env.GROUNDWORK_FORCE_IPV4 !== "0") {
  try {
    setDefaultResultOrder("ipv4first");
    // Reordering DNS results is not enough on its own - undici still races
    // both families. This is the half that actually stops it.
    setDefaultAutoSelectFamily(false);
  } catch {
    // Older runtime, or an environment that forbids it. Not fatal: the calls
    // either work anyway or fail with the refusal they already handle.
  }
}

const FIXTURE_ROOT = path.join(process.cwd(), "data", "fixtures", "mireye");

function fixturePath(endpoint: string, body: unknown): string {
  const slug = endpoint.replace(/^\/v1\//, "").replace(/\//g, "-");
  const hash = createHash("sha1")
    .update(stableStringify(body))
    .digest("hex")
    .slice(0, 12);
  return path.join(FIXTURE_ROOT, slug, `${hash}.json`);
}

/** Key order must not change the cache key, or the cache silently misses. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function readFixture<T>(endpoint: string, body: unknown): T | null {
  const file = fixturePath(endpoint, body);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")).response as T;
  } catch {
    return null;
  }
}

function writeFixture(endpoint: string, body: unknown, response: unknown): void {
  const file = fixturePath(endpoint, body);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        _note:
          "Recorded from the live Mireye Earth API. Safe to delete - it is " +
          "re-recorded on the next run in record mode.",
        endpoint,
        recordedAt: new Date().toISOString(),
        request: body,
        response,
      },
      null,
      2,
    ),
  );
}

/** Maps Mireye's own error taxonomy onto our refusal type. One vocabulary. */
function toRefusal(
  status: number,
  body: MireyeErrorBody | undefined,
  endpoint: string,
): Refusal {
  const detail = body?.detail;
  const code = detail?.error ?? `http_${status}`;

  const hints: Record<string, string> = {
    address_too_coarse:
      "The address resolved only to a ZIP or city centroid. Add a street number.",
    address_not_found: "No match. Check the street name and the city.",
    address_form_unsupported:
      "PO boxes, carrier routes and APO/FPO addresses route mail through a facility and describe no parcel, so no coordinate exists.",
    unresolvable_input: "None of the locators in this request could be resolved.",
    low_confidence_resolution:
      "Mireye matched something but below its accuracy floor, and refuses to return a coordinate it does not trust.",
    proximity_request_exceeds_budget_share:
      "This request exceeds the credit ceiling we sent with it. Lower the probe density or raise MIREYE_MAX_CREDITS_PER_CALL.",
    shed_too_large:
      "The drive-time shed covers more census tracts than Mireye will route. Try fewer minutes.",
    geocode_budget_exhausted:
      "Mireye's own fleet-wide monthly geocode budget is spent. Nothing was charged. This resets at the UTC month boundary.",
  };

  return {
    code,
    message:
      detail?.message ?? `Mireye ${endpoint} returned ${status} with no message body.`,
    retryable: detail?.retryable ?? status >= 500,
    hint: hints[code] ?? detail?.caller_guidance,
  };
}

function provenanceFor(endpoint: string, cached: boolean): Provenance {
  const docSlug = endpoint.replace("/v1/", "").replace(/\//g, "-");
  return {
    source: `Mireye ${endpoint}`,
    sourceUrl: `https://docs.mireye.ai/api-reference/${docSlug}`,
    fetchedAt: new Date().toISOString(),
    confidence: "high",
    mocked: false,
    note: cached ? "Served from a recorded response - no credits spent." : undefined,
  };
}

/** Field names for the ledger, so /api/stats can report what we actually got. */
function fieldsOf(endpoint: string, data: unknown): string[] | null {
  if (endpoint === "/v1/fetch") {
    const fields = (data as FetchResponse)?.fields;
    return fields ? Object.keys(fields) : null;
  }
  const op = (data as { op?: string })?.op;
  return op ? [`op:${op}`] : null;
}

export interface CallOptions {
  agent: AgentId;
  creditsEstimated?: number;
  timeoutMs?: number;
  siteId?: string;
  /** Human-readable description used in a budget refusal message. */
  context?: string;
}

async function call<T>(
  endpoint: string,
  body: unknown,
  opts: CallOptions,
): Promise<SourceResult<T>> {
  const mode = config.mireye.mode;
  const started = Date.now();
  const creditsEstimated = opts.creditsEstimated ?? 0;
  const base = {
    agent: opts.agent,
    endpoint,
    siteId: opts.siteId ?? null,
    request: body,
  };

  // --- 1. CACHE -------------------------------------------------------------
  if (mode !== "live") {
    const cached = readFixture<T>(endpoint, body);
    if (cached) {
      record({
        ...base,
        mode: "cache",
        cacheHit: true,
        creditsEstimated: 0,
        creditsActual: 0,
        durationMs: Date.now() - started,
        refused: false,
        fieldsReturned: fieldsOf(endpoint, cached),
        response: cached,
      });
      return ok(cached, provenanceFor(endpoint, true));
    }
  }

  if (mode === "replay") {
    const refusal: Refusal = {
      code: "fixture_missing",
      message: `No recorded response for ${endpoint}, and nothing was called because MIREYE_MODE is "replay"${
        config.mireye.apiKey ? "" : " (no MIREYE_API_KEY is set)"
      }.`,
      retryable: false,
      hint: `Set MIREYE_API_KEY and MIREYE_MODE=record, then run \`npm run mireye:record\`. Expected fixture: ${path.relative(process.cwd(), fixturePath(endpoint, body))}`,
    };
    record({
      ...base,
      mode: "replay",
      cacheHit: false,
      creditsEstimated: 0,
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: refusal.code,
    });
    return refuse(refusal);
  }

  if (!config.mireye.apiKey) {
    const refusal: Refusal = {
      code: "no_api_key",
      message: "MIREYE_API_KEY is not set, so the ground layer cannot be reached.",
      retryable: false,
      hint: "Add the key to .env, or set MIREYE_MODE=replay to run entirely off recorded fixtures.",
    };
    record({
      ...base,
      mode: "refused",
      cacheHit: false,
      creditsEstimated: 0,
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: refusal.code,
    });
    return refuse(refusal);
  }

  // --- 2 & 3. QUOTE, THEN GRANT --------------------------------------------
  const grant = broker.request(
    opts.agent,
    creditsEstimated,
    opts.context ?? `A ${endpoint} call`,
  );
  if (!grant.granted) {
    record({
      ...base,
      mode: "refused",
      cacheHit: false,
      creditsEstimated,
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: grant.refusal.code,
    });
    return refuse(grant.refusal);
  }

  // --- 4. CALL --------------------------------------------------------------
  let response: Response;
  try {
    response = await fetch(`${config.mireye.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mireye.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      // /v1/ask runs a plan → fetch → synthesise pipeline bounded at 110s
      // server-side. The docs are explicit that a short client timeout aborts
      // otherwise-successful requests while they keep running and billing.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 130_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const refusal: Refusal = {
      code: "network_error",
      message: error instanceof Error ? error.message : "The request never completed.",
      retryable: true,
      hint: timedOut
        ? "The server may still have processed and billed this request."
        : "The connection never completed, so nothing was billed.",
    };
    record({
      ...base,
      mode,
      cacheHit: false,
      creditsEstimated,
      // A timeout may have been served and billed anyway; a connection that
      // never opened certainly was not.
      creditsActual: timedOut ? null : 0,
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: refusal.code,
      response: { error: refusal.message },
    });
    return refuse(refusal);
  }

  const durationMs = Date.now() - started;
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const refusal = toRefusal(response.status, parsed as MireyeErrorBody, endpoint);
    record({
      ...base,
      mode,
      cacheHit: false,
      creditsEstimated,
      // A refused call may still have been billed for its geocoding part; the
      // estimate is the honest upper bound to carry here.
      creditsActual: null,
      durationMs,
      httpStatus: response.status,
      refused: true,
      refusalCode: refusal.code,
      response: parsed,
    });
    return refuse(refusal);
  }

  const data = parsed as T;
  const paid = (data as { paid_driving_calcs?: number })?.paid_driving_calcs;
  const paidDrivingCalcs = typeof paid === "number" ? paid : null;

  record({
    ...base,
    mode,
    cacheHit: false,
    creditsEstimated,
    paidDrivingCalcs,
    // Where Mireye echoes what it charged for, that beats our estimate.
    creditsActual:
      paidDrivingCalcs !== null ? Math.max(5, paidDrivingCalcs * 12) : creditsEstimated,
    durationMs,
    httpStatus: response.status,
    refused: false,
    fieldsReturned: fieldsOf(endpoint, data),
    response: data,
  });

  if (mode === "record") writeFixture(endpoint, body, data);

  return ok(data, provenanceFor(endpoint, false));
}

// --- The endpoints we actually use ------------------------------------------

export const mireye = {
  geocode(req: GeocodeRequest, opts: Omit<CallOptions, "creditsEstimated">) {
    return call<GeocodeResponse>("/v1/geocode", req, {
      ...opts,
      creditsEstimated: CREDITS_PER_GEOCODE,
      context: `Geocoding "${req.address}"`,
    });
  },

  /**
   * The expensive one, and not obviously so: with `include_parcel` this buys a
   * per-record-licensed county parcel at 300 credits on Build, against 1 for a
   * bare geocode. Callers that only need a coordinate should pass
   * `include_parcel: false` and save 299.
   */
  lookup(req: LookupRequest, opts: Omit<CallOptions, "creditsEstimated">) {
    const includeParcel = req.include_parcel ?? true;
    return call<LookupResponse>(
      "/v1/lookup",
      { ...req, include_parcel: includeParcel },
      {
        ...opts,
        creditsEstimated: estimateLookupCredits(includeParcel),
        context: includeParcel
          ? `Resolving "${req.input}" to a parcel (licensed record)`
          : `Geocoding "${req.input}"`,
      },
    );
  },

  fetchFields(req: FetchRequest, opts: Omit<CallOptions, "creditsEstimated">) {
    return call<FetchResponse>("/v1/fetch", req, {
      ...opts,
      creditsEstimated: estimateFetchCredits(req.fields ?? []),
      timeoutMs: 70_000,
      context: `Fetching ${req.fields?.length ?? "preset"} site fields`,
    });
  },

  ask(req: AskRequest, opts: Omit<CallOptions, "creditsEstimated">) {
    return call<AskResponse>("/v1/ask", req, {
      ...opts,
      creditsEstimated: CREDITS_PER_ASK,
      timeoutMs: 130_000,
      context: "A natural-language site question",
    });
  },

  /**
   * Every proximity call carries an explicit `max_credits`. Mireye checks it
   * before the driving matrix is charged, so an accidental 500-probe request
   * comes back as a priced 422 rather than as a bill. Belt and braces with the
   * broker: the broker protects our daily total, this protects one request.
   */
  proximity<T = ScreenResponse | LaborShedResponse | DistanceResponse>(
    op: ProximityOp,
    opts: Omit<CallOptions, "creditsEstimated">,
  ) {
    const estimate = estimateProximityCredits(op);
    return call<T>(
      "/v1/proximity",
      { ...op, max_credits: op.max_credits ?? config.mireye.maxCreditsPerCall },
      {
        ...opts,
        creditsEstimated: estimate.credits,
        context: `A ${op.op} call (${estimate.explanation})`,
      },
    );
  },

  screen(op: Omit<ScreenOp, "op">, opts: Omit<CallOptions, "creditsEstimated">) {
    return mireye.proximity<ScreenResponse>({ op: "screen", ...op }, opts);
  },

  /**
   * The full origin x destination matrix, with a duration on every leg.
   *
   * `screen` answers "which of these are within N minutes" and is the right
   * call for drawing a boundary. `distance` answers "how far is each of these,
   * exactly", which is what you want when the points are already known to
   * matter and the number itself is the product - a competitor's drive time,
   * for instance. Same price per leg; different question.
   */
  distance(op: Omit<DistanceOp, "op">, opts: Omit<CallOptions, "creditsEstimated">) {
    return mireye.proximity<DistanceResponse>({ op: "distance", ...op }, opts);
  },

  laborShed(op: Omit<LaborShedOp, "op">, opts: Omit<CallOptions, "creditsEstimated">) {
    return mireye.proximity<LaborShedResponse>({ op: "labor_shed", ...op }, opts);
  },
};

export { estimateProximityCredits };
