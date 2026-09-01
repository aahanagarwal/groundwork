"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sheet, Footer } from "@/components/chrome";
import { DEMO_SITES } from "@/lib/demo-sites";
import {
  DRAFT_FIELD_LABELS,
  EMPTY_DRAFT,
  defaultWindow,
  validateDraft,
  type FieldErrors,
  type ScenarioDraft,
} from "@/lib/scenario-draft";

/**
 * CREATE A NEW USE CASE
 *
 * Two ways in, chosen up front because they need different questions:
 *
 *   NEW BUSINESS - describe an address Groundwork has never seen. The address
 *   gets resolved live through Mireye, exactly the same call the three seeded
 *   demos already went through.
 *
 *   EXISTING ADDRESS - Aahan's addition. Attach a second, different situation
 *   to a business already in the demo, without re-resolving anything that is
 *   already resolved and persisted.
 *
 * One manual step either way: the review form. Everything the model could
 * confidently read from the paragraph arrives pre-filled; everything it
 * could not is blank and flagged, never guessed.
 */

type Mode = "new" | "existing";
type Step = "describe" | "review";

const TICKET_ROW: { key: keyof ScenarioDraft; short: string }[] = [
  { key: "ticketsSun", short: "Sun" },
  { key: "ticketsMon", short: "Mon" },
  { key: "ticketsTue", short: "Tue" },
  { key: "ticketsWed", short: "Wed" },
  { key: "ticketsThu", short: "Thu" },
  { key: "ticketsFri", short: "Fri" },
  { key: "ticketsSat", short: "Sat" },
];

export default function CreateUseCasePage() {
  const router = useRouter();
  const analysisBounds = useMemo(() => defaultWindow(), []);

  const [mode, setMode] = useState<Mode>("new");
  const [existingSlug, setExistingSlug] = useState(DEMO_SITES[0]?.slug ?? "");
  const [paragraph, setParagraph] = useState("");
  const [step, setStep] = useState<Step>("describe");

  const [draft, setDraft] = useState<ScenarioDraft>(EMPTY_DRAFT);
  const [missing, setMissing] = useState<Set<keyof ScenarioDraft>>(new Set());
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existingSite = DEMO_SITES.find((s) => s.slug === existingSlug);

  const setField = <K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const readParagraph = async () => {
    if (paragraph.trim().length < 10) {
      setFormError("Write a sentence or two about the business first.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/create/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paragraph,
          existingBusinessLabel: mode === "existing" ? existingSite?.label : undefined,
          existingAddress: mode === "existing" ? existingSite?.address : undefined,
        }),
      });
      const body = (await res.json()) as {
        draft?: ScenarioDraft;
        missing?: (keyof ScenarioDraft)[];
        unavailable?: string;
        error?: string;
      };
      if (!res.ok || !body.draft) {
        setFormError(body.error ?? "Could not read that.");
        return;
      }
      setDraft(body.draft);
      setMissing(new Set(body.missing ?? []));
      setParseNote(body.unavailable ?? null);
      setFieldErrors({});
      setStep("review");
    } catch {
      setFormError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    // Recomputed fresh here rather than reusing `analysisBounds` (which is
    // fixed once at mount, for the date-input min/max hints). A user can sit
    // on this form for a while, and the LLM parse step computes its own
    // "today" fresh too - validating against a bound frozen at page load
    // could reject a date the server would accept once real time, or a UTC
    // midnight boundary, has moved on since.
    const freshBounds = defaultWindow();
    const errors = validateDraft(draft, {
      requireAddress: mode === "new",
      windowStart: freshBounds.start,
      windowEnd: freshBounds.end,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstBad = document.getElementById(`field-${Object.keys(errors)[0]}`);
      firstBad?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch("/api/create/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          existingSlug: mode === "existing" ? existingSlug : undefined,
          draft,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        slug?: string;
        scenarioKey?: string;
        fieldErrors?: FieldErrors;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        if (body.fieldErrors) {
          setFieldErrors(body.fieldErrors);
          const firstBad = document.getElementById(
            `field-${Object.keys(body.fieldErrors)[0]}`,
          );
          firstBad?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          setFormError(body.error ?? "Could not create that scenario.");
        }
        return;
      }
      router.push(`/site/${body.slug}?scenario=${body.scenarioKey}`);
    } catch {
      setFormError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet className="mt-14 mb-4">
        <Link href="/" className="label inline-block underline">
          ← All addresses
        </Link>
        <h1 className="mt-4 font-display text-[clamp(24px,3.5vw,36px)] uppercase font-extrabold leading-[0.98] tracking-[-0.02em]">
          Create a new use case
        </h1>
        <p className="mt-3 max-w-[62ch] text-[17px] leading-[1.45] text-ink/80">
          Describe the business in plain language. We fill in what we can read
          from it, ask you for whatever is left, then resolve the address,
          draw the real drive-time area, and build the same analysis you see
          on the three demo sites.
        </p>
      </Sheet>

      {step === "describe" ? (
        <Sheet className="mb-16">
          <div className="card p-0">
            <div className="border-b border-rule px-5 py-4">
              <div className="label mb-2">Which business?</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className={`border px-3 py-1.5 font-mono text-[13px] uppercase tracking-widest ${
                    mode === "new" ? "border-ink bg-ink text-limestone" : "border-rule hover:border-ink"
                  }`}
                >
                  A new business
                </button>
                <button
                  type="button"
                  onClick={() => setMode("existing")}
                  className={`border px-3 py-1.5 font-mono text-[13px] uppercase tracking-widest ${
                    mode === "existing" ? "border-ink bg-ink text-limestone" : "border-rule hover:border-ink"
                  }`}
                >
                  A new situation for an existing address
                </button>
              </div>

              {mode === "existing" ? (
                <div className="mt-3">
                  <label className="label mb-1.5 block" htmlFor="existing-site">
                    Which one
                  </label>
                  <select
                    id="existing-site"
                    value={existingSlug}
                    onChange={(e) => setExistingSlug(e.target.value)}
                    className="border-2 border-ink bg-paper px-3 py-2 font-display text-[15px] font-bold uppercase tracking-wide text-ink outline-none cursor-pointer hover:bg-limestone"
                  >
                    {DEMO_SITES.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 font-mono text-[13px] leading-snug text-stone">
                    Its address and drive-time area are already resolved and
                    persisted - this only describes a different situation
                    happening to it. It will not touch or replace anything
                    already there.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="px-5 py-4">
              <label className="label mb-1.5 block" htmlFor="paragraph">
                {mode === "new"
                  ? "Tell us about the business"
                  : `Tell us what's going on at ${existingSite?.label ?? "this address"}`}
              </label>
              <textarea
                id="paragraph"
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                rows={6}
                placeholder={
                  mode === "new"
                    ? "We're a small breakfast taco spot at 4200 Red River St, Austin, TX 78751. We usually see about 150 customers a day, more on weekends, average ticket around $9. We spend about $30 a day on ads. Sales have been down the last couple weeks and we're not sure why."
                    : "Sales dropped noticeably the week of August 10th and we can't figure out why - nothing obvious changed on our end."
                }
                className="w-full resize-y border border-rule bg-paper px-3 py-2.5 text-[16px] leading-snug placeholder:text-stone/70 focus:border-ink focus:outline-none"
              />
              <p className="mt-2 font-mono text-[13px] leading-snug text-stone">
                Address, typical customer counts, average sale, ad spend - the
                more you include, the less you&rsquo;ll need to fill in by hand next.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={readParagraph}
                  className="border-[1.5px] border-ink bg-ink px-4 py-2 font-mono text-[13px] uppercase tracking-widest text-limestone disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Reading…" : "Continue"}
                </button>
                {formError ? (
                  <span className="font-mono text-[12.5px] text-ultra">{formError}</span>
                ) : null}
              </div>
            </div>
          </div>
        </Sheet>
      ) : (
        <Sheet className="mb-16">
          <div className="card p-0">
            <header className="border-b border-rule px-5 py-4">
              <div className="label">Step 2 of 2</div>
              <h2 className="mt-1.5 font-display text-[19px] font-bold uppercase leading-tight">
                Check the details
              </h2>
              <p className="mt-2 max-w-[62ch] text-[15.5px] leading-snug text-ink/80">
                Fields marked <span className="text-ultra font-semibold">not found</span> weren&rsquo;t in your paragraph - fill those in. Everything else
                is editable too, if anything looks off.
              </p>
              {parseNote ? (
                <p className="mt-2 border-l-2 border-signal pl-3 text-[13.5px] leading-snug text-ink/70">
                  {parseNote}
                </p>
              ) : null}
            </header>

            <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
              <Field
                id="businessLabel"
                label={DRAFT_FIELD_LABELS.businessLabel}
                missing={missing.has("businessLabel")}
                error={fieldErrors.businessLabel}
              >
                <input
                  id="field-businessLabel"
                  type="text"
                  value={draft.businessLabel}
                  disabled={mode === "existing"}
                  onChange={(e) => setField("businessLabel", e.target.value)}
                  className={inputClass(!!fieldErrors.businessLabel)}
                />
              </Field>

              {mode === "new" ? (
                <Field
                  id="address"
                  label={DRAFT_FIELD_LABELS.address}
                  missing={missing.has("address")}
                  error={fieldErrors.address}
                >
                  <input
                    id="field-address"
                    type="text"
                    value={draft.address}
                    onChange={(e) => setField("address", e.target.value)}
                    placeholder="123 Main St, Austin, TX 78701"
                    className={inputClass(!!fieldErrors.address)}
                  />
                </Field>
              ) : null}

              <Field
                id="scenarioName"
                label={DRAFT_FIELD_LABELS.scenarioName}
                missing={missing.has("scenarioName")}
                error={fieldErrors.scenarioName}
              >
                <input
                  id="field-scenarioName"
                  type="text"
                  value={draft.scenarioName}
                  onChange={(e) => setField("scenarioName", e.target.value)}
                  placeholder="Slow start to August"
                  className={inputClass(!!fieldErrors.scenarioName)}
                />
              </Field>

              <Field
                id="scenarioDescription"
                label={DRAFT_FIELD_LABELS.scenarioDescription}
                missing={missing.has("scenarioDescription")}
                error={fieldErrors.scenarioDescription}
                span
              >
                <textarea
                  id="field-scenarioDescription"
                  value={draft.scenarioDescription}
                  onChange={(e) => setField("scenarioDescription", e.target.value)}
                  rows={2}
                  className={inputClass(!!fieldErrors.scenarioDescription) + " resize-y"}
                />
              </Field>

              <div className="sm:col-span-2">
                <div className="label mb-2">Typical customers per day</div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
                  {TICKET_ROW.map(({ key, short }) => (
                    <Field
                      key={key}
                      id={key}
                      label={short}
                      missing={missing.has(key)}
                      error={fieldErrors[key]}
                      compact
                    >
                      <input
                        id={`field-${key}`}
                        type="number"
                        min={0}
                        value={draft[key] ?? ""}
                        onChange={(e) =>
                          setField(key, e.target.value === "" ? null : Number(e.target.value))
                        }
                        className={inputClass(!!fieldErrors[key]) + " text-center tabular"}
                      />
                    </Field>
                  ))}
                </div>
              </div>

              <Field
                id="basketSizeUsd"
                label={DRAFT_FIELD_LABELS.basketSizeUsd}
                missing={missing.has("basketSizeUsd")}
                error={fieldErrors.basketSizeUsd}
              >
                <input
                  id="field-basketSizeUsd"
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.basketSizeUsd ?? ""}
                  onChange={(e) =>
                    setField("basketSizeUsd", e.target.value === "" ? null : Number(e.target.value))
                  }
                  className={inputClass(!!fieldErrors.basketSizeUsd)}
                />
              </Field>

              <Field
                id="grossMarginPct"
                label={DRAFT_FIELD_LABELS.grossMarginPct}
                missing={missing.has("grossMarginPct")}
                error={fieldErrors.grossMarginPct}
              >
                <input
                  id="field-grossMarginPct"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.grossMarginPct ?? ""}
                  onChange={(e) =>
                    setField("grossMarginPct", e.target.value === "" ? null : Number(e.target.value))
                  }
                  placeholder="e.g. 62"
                  className={inputClass(!!fieldErrors.grossMarginPct)}
                />
              </Field>

              <Field
                id="dailyAdSpendUsd"
                label={DRAFT_FIELD_LABELS.dailyAdSpendUsd}
                missing={missing.has("dailyAdSpendUsd")}
                error={fieldErrors.dailyAdSpendUsd}
              >
                <input
                  id="field-dailyAdSpendUsd"
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.dailyAdSpendUsd ?? ""}
                  onChange={(e) =>
                    setField("dailyAdSpendUsd", e.target.value === "" ? null : Number(e.target.value))
                  }
                  placeholder="0 if you don't run ads"
                  className={inputClass(!!fieldErrors.dailyAdSpendUsd)}
                />
              </Field>

              <div className="sm:col-span-2">
                <div className="label mb-2">
                  The period you want explained{" "}
                  <span className="normal-case text-ink/50">(optional - leave blank for the last 9 days)</span>
                </div>
                <div className="flex flex-wrap gap-4">
                  <Field
                    id="analysisWindowStart"
                    label={DRAFT_FIELD_LABELS.analysisWindowStart}
                    missing={false}
                    error={fieldErrors.analysisWindowStart}
                  >
                    <input
                      id="field-analysisWindowStart"
                      type="date"
                      min={analysisBounds.start}
                      max={analysisBounds.end}
                      value={draft.analysisWindowStart ?? ""}
                      onChange={(e) => setField("analysisWindowStart", e.target.value || null)}
                      className={inputClass(!!fieldErrors.analysisWindowStart)}
                    />
                  </Field>
                  <Field
                    id="analysisWindowEnd"
                    label={DRAFT_FIELD_LABELS.analysisWindowEnd}
                    missing={false}
                    error={fieldErrors.analysisWindowEnd}
                  >
                    <input
                      id="field-analysisWindowEnd"
                      type="date"
                      min={analysisBounds.start}
                      max={analysisBounds.end}
                      value={draft.analysisWindowEnd ?? ""}
                      onChange={(e) => setField("analysisWindowEnd", e.target.value || null)}
                      className={inputClass(!!fieldErrors.analysisWindowEnd)}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="border-t border-rule px-5 py-4">
              <p className="mb-3 font-mono text-[13px] leading-relaxed text-stone">
                What happens next: {mode === "new" ? "the address is resolved through Mireye and the real drive-time area is drawn, then " : "the trade area is already drawn, so we skip straight to "}
                a handful of plausible local events are generated to make the
                scenario interesting - clearly marked as simulated, never
                presented as verified. Real weather for this address still
                comes from a live feed either way.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setStep("describe")}
                  className="border border-rule px-3 py-2 font-mono text-[13px] uppercase tracking-widest hover:border-ink"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={create}
                  className="border-[1.5px] border-ink bg-ink px-4 py-2 font-mono text-[13px] uppercase tracking-widest text-limestone disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Creating…" : "Create it"}
                </button>
                {formError ? (
                  <span className="font-mono text-[12.5px] text-ultra">{formError}</span>
                ) : null}
              </div>
            </div>
          </div>
        </Sheet>
      )}

      <Footer />
    </>
  );
}

function inputClass(hasError: boolean): string {
  return `w-full border bg-paper px-3 py-2 text-[15px] leading-snug focus:outline-none ${
    hasError ? "border-ultra focus:border-ultra" : "border-rule focus:border-ink"
  }`;
}

function Field({
  id,
  label,
  missing,
  error,
  span,
  compact,
  children,
}: {
  id: string;
  label: string;
  missing: boolean;
  error?: string;
  span?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div id={`field-wrap-${id}`} className={span ? "sm:col-span-2" : undefined}>
      <label
        htmlFor={`field-${id}`}
        className={`mb-1.5 block font-mono text-[12.5px] uppercase tracking-[0.1em] ${
          compact ? "text-center" : ""
        } ${error ? "text-ultra" : missing ? "text-ultra" : "text-survey"}`}
      >
        {compact ? label : missing ? `${label} · not found` : label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 font-mono text-[12.5px] leading-snug text-ultra">{error}</p>
      ) : null}
    </div>
  );
}
