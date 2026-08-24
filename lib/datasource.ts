/**
 * The one interface every input goes through — the real Mireye client, the
 * mocked Square ledger, the mocked weather feed, all of it.
 *
 * Two rules the rest of the codebase depends on:
 *
 *   1. Nothing returns a bare value. Every fetch returns data *with* its
 *      provenance, so no numeric claim can reach the UI without a source and a
 *      timestamp attached. `CitedNumber` refuses to render otherwise.
 *   2. Failure is typed, never thrown-and-guessed. A source that cannot
 *      confidently answer returns a `Refusal`; it does not return an
 *      approximation. This is the behaviour Mireye's own `/v1/lookup` has
 *      (`disposition: clarify | no_match`) and we propagate it rather than
 *      flattening it.
 *
 * Swapping a mock for a real integration means writing a new object with this
 * shape and changing one line in lib/sources/registry.ts. See
 * docs/ARCHITECTURE.md § Extension points.
 */

export type Confidence = "high" | "medium" | "low";

export type Layer = "ground" | "ledger" | "world";

/** Where a value came from and when. Attached to every asserted number. */
export interface Provenance {
  /** Human-readable, shown in the citation chip: "Mireye /v1/lookup". */
  source: string;
  sourceUrl?: string;
  fetchedAt: string; // ISO 8601
  confidence?: Confidence;
  /**
   * True when this came from a fixture rather than a live third party. The UI
   * renders mocked citations differently on purpose — a demo that hides which
   * half is real is a demo that lies.
   */
  mocked: boolean;
  /** Dataset vintage, jurisdiction, caveat — whatever the reader needs. */
  note?: string;
}

/** A value that carries its own receipt. */
export interface Cited<T> {
  value: T;
  provenance: Provenance;
}

export function cite<T>(value: T, provenance: Provenance): Cited<T> {
  return { value, provenance };
}

/**
 * A source declining to answer. Carries enough to render an honest empty
 * state: what failed, whether trying again helps, and what the caller could do
 * instead.
 */
export interface Refusal {
  /** Stable machine code, e.g. "no_match", "low_confidence_resolution". */
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
  /** Present when the input was ambiguous rather than wrong. */
  candidates?: Array<{ label: string; value: string; confidence?: number }>;
}

export type SourceResult<T> =
  | { ok: true; data: T; provenance: Provenance }
  | { ok: false; refusal: Refusal };

export function ok<T>(data: T, provenance: Provenance): SourceResult<T> {
  return { ok: true, data, provenance };
}

export function refuse<T>(refusal: Refusal): SourceResult<T> {
  return { ok: false, refusal };
}

export interface DataSource<Req, Res> {
  /** Stable id, e.g. "mireye.lookup", "ledger.square.orders". */
  readonly id: string;
  readonly layer: Layer;
  /** Display name used in citations when the call succeeds. */
  readonly source: string;
  readonly sourceUrl?: string;
  /** Whether this implementation reads fixtures instead of a live API. */
  readonly mocked: boolean;
  fetch(req: Req): Promise<SourceResult<Res>>;
}

/** Convenience for the many mocked sources: builds their provenance stamp. */
export function mockProvenance(
  source: string,
  opts: { sourceUrl?: string; confidence?: Confidence; note?: string } = {},
): Provenance {
  return {
    source,
    sourceUrl: opts.sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence: opts.confidence ?? "medium",
    mocked: true,
    note: opts.note,
  };
}
