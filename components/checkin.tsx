"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckinRecord } from "@/lib/domain";
import { CHECKIN_TAGS, checkinTagLabel } from "@/lib/checkin-tags";

/**
 * THE CHECK-IN
 *
 * The only input in the product, and it exists because of a specific gap: the
 * engine reports what it cannot explain, and the owner is the only source that
 * can explain it. A grinder that broke, a barista who quit, a delivery that
 * never came - none of that is in any permit feed or weather archive, and all
 * of it moves the till.
 *
 * So this is not a generic feedback box. It is framed as answering the
 * unexplained share directly, and the answer is shown back against that bar.
 *
 * What it deliberately does NOT do is feed the regression. Testimony is not a
 * measurement, and quietly converting "we were short-staffed" into a fitted
 * coefficient would manufacture exactly the precision this product refuses
 * everywhere else.
 */

const PULSE: Array<{ id: CheckinRecord["pulse"]; label: string }> = [
  { id: "busy", label: "Busy" },
  { id: "normal", label: "Normal" },
  { id: "slow", label: "Slow" },
  { id: "dead", label: "Dead" },
];

export function DailyCheckin({
  siteId,
  today,
  windowStart,
  windowEnd,
  unexplainedCustomers,
  existing,
}: {
  siteId: string;
  today: string;
  windowStart: string;
  windowEnd: string;
  unexplainedCustomers: number;
  existing: CheckinRecord[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [pulse, setPulse] = useState<CheckinRecord["pulse"]>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gap = Math.abs(Math.round(unexplainedCustomers));

  const toggleTag = (id: string) =>
    setTags((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId, date, pulse, tags, note }),
      });
      if (response.ok) {
        setSaved(true);
        setPulse(null);
        setTags([]);
        setNote("");
        router.refresh();
      } else {
        const body = (await response.json()) as { error?: string };
        setError(body.error ?? "Could not save that.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = pulse !== null || tags.length > 0 || note.trim().length > 0;

  return (
    <section className="card border-l-[5px] border-signal p-0">
      <header className="border-b border-rule px-5 py-4">
        <div className="label">Your turn</div>
        <h2 className="mt-1.5 font-display text-[19px] font-bold uppercase leading-tight">
          How&rsquo;s trade going?
        </h2>
        <p className="mt-2 max-w-[58ch] text-[15px] leading-snug">
          {gap > 0 ? (
            <>
              There are <strong>{gap} customers</strong> in this period we
              can&rsquo;t account for. No permit, forecast or feed we hold covers
              them. You&rsquo;re the only one who knows what that was - tell us and
              we&rsquo;ll stop counting it against the street.
            </>
          ) : (
            <>
              Anything the feeds wouldn&rsquo;t catch? Staffing, equipment, a late
              open, a change on the menu. It gets recorded against the day and shown
              next to the numbers.
            </>
          )}
        </p>
      </header>

      <div className="px-5 py-4">
        {/* Date. Defaults to today; the window is one tap away because that is
            the period the question is actually about. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="label" htmlFor="checkin-date">
            Day
          </label>
          <input
            id="checkin-date"
            type="date"
            value={date}
            min={windowStart}
            onChange={(e) => {
              setDate(e.target.value);
              setSaved(false);
            }}
            className="border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
          />
          <button
            type="button"
            onClick={() => {
              setDate(windowStart);
              setSaved(false);
            }}
            className="border border-rule px-2 py-1 font-mono text-[12.5px] uppercase tracking-widest hover:border-ink"
          >
            Jump to {windowStart}
          </button>
          <span className="font-mono text-[13px] text-stone">
            the period above is {windowStart} → {windowEnd}
          </span>
        </div>

        <div className="mt-4">
          <div className="label mb-1.5">How did it feel?</div>
          <div className="flex flex-wrap gap-1.5">
            {PULSE.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setPulse(pulse === option.id ? null : option.id);
                  setSaved(false);
                }}
                className={`border px-3 py-1.5 font-mono text-[13px] uppercase tracking-widest ${
                  pulse === option.id
                    ? "border-ink bg-ink text-limestone"
                    : "border-rule hover:border-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="label mb-1.5">Anything going on?</div>
          <div className="flex flex-wrap gap-1.5">
            {CHECKIN_TAGS.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  toggleTag(tag.id);
                  setSaved(false);
                }}
                className={`border px-2.5 py-1.5 font-mono text-[13px] ${
                  tags.includes(tag.id)
                    ? "border-ink bg-signal text-ink"
                    : "border-rule hover:border-ink"
                }`}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="label mb-1.5 block" htmlFor="checkin-note">
            In your own words
          </label>
          <textarea
            id="checkin-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            rows={2}
            placeholder="Grinder packed up Tuesday to Thursday, one machine all week."
            className="w-full resize-y border border-rule bg-paper px-3 py-2 text-[15px] leading-snug placeholder:text-stone focus:border-ink focus:outline-none"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={submit}
            className="border-[1.5px] border-ink bg-ink px-4 py-2 font-mono text-[13px] uppercase tracking-widest text-limestone disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Record it"}
          </button>
          {saved ? (
            <span className="font-mono text-[12.5px] text-survey">
              Saved against {date}.
            </span>
          ) : null}
          {error ? (
            <span className="font-mono text-[12.5px] text-ultra">{error}</span>
          ) : null}
        </div>

        <p className="mt-3 max-w-[62ch] font-mono text-[13px] leading-relaxed text-stone">
          What you write here is shown next to the unexplained figure - it is not
          fed into the model. What you tell us is testimony, not a measurement, and
          turning it into a coefficient would invent precision nobody earned.
        </p>
      </div>

      {existing.length > 0 ? (
        <div className="border-t border-rule px-5 py-3">
          <div className="label mb-2">Recent notes</div>
          <ul className="space-y-1.5">
            {existing.slice(0, 4).map((entry) => (
              <li key={entry.id} className="flex gap-3 text-[14px] leading-snug">
                <span className="shrink-0 font-mono text-[12.5px] text-survey">
                  {entry.date}
                </span>
                <span className="min-w-0">
                  {entry.pulse ? (
                    <span className="mr-1.5 font-mono text-[13px] uppercase text-stone">
                      {entry.pulse}
                    </span>
                  ) : null}
                  {entry.tags
                    .map(checkinTagLabel)
                    .join(", ")}
                  {entry.tags.length > 0 && entry.note ? " - " : ""}
                  {entry.note}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
