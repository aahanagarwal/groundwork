"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Provenance } from "@/lib/datasource";

/**
 * Formatted in UTC with a fixed layout rather than the reader's locale.
 * `toLocaleString()` renders differently on the server and in the browser, so
 * it hydrates dirty - and a fetch timestamp is a record, not a pleasantry, so
 * one unambiguous rendering is the right one anyway.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * THE CITATION INSPECTOR
 *
 * The rule the whole product rests on: no number reaches the screen without a
 * source and a timestamp attached, and any number can be opened to see them.
 *
 * `<Cited>` is therefore the only sanctioned way to render a value. It takes a
 * `Provenance` as a required prop, so a number with no source is a type error
 * rather than a judgement call - which is what keeps the rule from eroding the
 * first time someone is in a hurry.
 */

export interface CitationPayload {
  label: string;
  value: ReactNode;
  provenance: Provenance;
  /** Anything else worth showing: the raw API body, the derivation, the
   *  polygon-membership decision. Rendered as formatted JSON. */
  detail?: unknown;
  /** Shown above the raw detail - how a derived number was arrived at. */
  derivation?: string;
}

interface CitationContextValue {
  open: (payload: CitationPayload) => void;
  close: () => void;
  current: CitationPayload | null;
}

const CitationContext = createContext<CitationContextValue | null>(null);

export function CitationProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CitationPayload | null>(null);
  const open = useCallback((payload: CitationPayload) => setCurrent(payload), []);
  const close = useCallback(() => setCurrent(null), []);
  const value = useMemo(() => ({ open, close, current }), [open, close, current]);

  return (
    <CitationContext.Provider value={value}>
      {children}
      <CitationDrawer />
    </CitationContext.Provider>
  );
}

export function useCitations(): CitationContextValue {
  const ctx = useContext(CitationContext);
  if (!ctx) {
    throw new Error("useCitations must be used inside a <CitationProvider>.");
  }
  return ctx;
}

/**
 * A value plus its receipt. Click it to see where it came from.
 *
 * Mocked sources get a hollow badge and live ones a filled badge, deliberately:
 * a demo that hides which half is real is a demo that lies, and a reader should
 * be able to tell at a glance without opening anything.
 */
export function Cited({
  label,
  value,
  provenance,
  detail,
  derivation,
  className = "",
}: CitationPayload & { className?: string }) {
  const { open } = useCitations();

  return (
    <button
      type="button"
      onClick={() => open({ label, value, provenance, detail, derivation })}
      title={`${provenance.source} · ${formatTimestamp(provenance.fetchedAt)}`}
      className={`group inline-flex items-baseline gap-1 border-b border-dotted border-rule-strong text-left hover:border-solid hover:border-ultra ${className}`}
    >
      <span className="tabular">{value}</span>
      <span
        aria-hidden
        className={`mb-[3px] inline-block h-[7px] w-[7px] shrink-0 rounded-full border transition-colors ${
          provenance.mocked
            ? "border-stone bg-transparent group-hover:border-ultra"
            : "border-survey bg-survey group-hover:border-ultra group-hover:bg-ultra"
        }`}
      />
      <span className="sr-only">
        {provenance.mocked ? "Fixture source" : "Live source"} - {provenance.source}.
        Click for details.
      </span>
    </button>
  );
}

function CitationDrawer() {
  const { current, close } = useCitations();
  if (!current) return null;

  const { label, value, provenance, detail, derivation } = current;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close citation"
        onClick={close}
        className="absolute inset-0 bg-ink/25"
      />
      <aside className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto border-l-[1.5px] border-ink bg-paper">
        <header className="sticky top-0 z-10 border-b-[1.5px] border-ink bg-paper px-6 pb-4 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="label">Where this number came from</div>
              <div className="mt-1 font-display text-[19px] font-bold uppercase leading-tight">
                {label}
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              className="shrink-0 border border-rule px-2 py-1 font-mono text-[13px] uppercase tracking-widest hover:border-ink"
            >
              Close
            </button>
          </div>
          <div className="mt-3 font-mono text-[26px] tabular">{value}</div>
        </header>

        <div className="px-6 py-5">
          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-3 text-[14.5px]">
            <dt className="label pt-0.5">Source</dt>
            <dd className="font-mono text-[13px] leading-snug">{provenance.source}</dd>

            {provenance.sourceUrl ? (
              <>
                <dt className="label pt-0.5">Link</dt>
                <dd className="break-all font-mono text-[12.5px] leading-snug">
                  <a
                    href={provenance.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ultra underline"
                  >
                    {provenance.sourceUrl}
                  </a>
                </dd>
              </>
            ) : null}

            <dt className="label pt-0.5">Fetched</dt>
            <dd className="font-mono text-[13px] tabular">
              {formatTimestamp(provenance.fetchedAt)}
            </dd>

            <dt className="label pt-0.5">Confidence</dt>
            <dd className="font-mono text-[13px] uppercase">
              {provenance.confidence ?? "not stated"}
            </dd>

            <dt className="label pt-0.5">Status</dt>
            <dd className="font-mono text-[13px]">
              {provenance.mocked ? (
                <span className="border border-stone px-1.5 py-0.5 text-stone">
                  FIXTURE - stands in for a real integration
                </span>
              ) : (
                <span className="border border-survey bg-survey px-1.5 py-0.5 text-paper">
                  LIVE - fetched from the real source
                </span>
              )}
            </dd>
          </dl>

          {provenance.note ? (
            <p className="mt-5 border-l-2 border-signal pl-3 text-[15px] leading-snug">
              {provenance.note}
            </p>
          ) : null}

          {derivation ? (
            <section className="mt-6">
              <div className="label mb-2">How it was derived</div>
              <p className="text-[15px] leading-snug">{derivation}</p>
            </section>
          ) : null}

          {detail !== undefined && detail !== null ? (
            <section className="mt-6">
              <div className="label mb-2">Raw</div>
              <pre className="max-h-[420px] overflow-auto border border-rule bg-limestone p-3 font-mono text-[12.5px] leading-relaxed">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
