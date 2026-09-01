import type { Refusal } from "@/lib/datasource";

/**
 * REFUSAL AS A DESIGNED STATE
 *
 * A weak geocode match, a jurisdiction with no permit feed, a missing fixture,
 * a spent credit ceiling - none of these are errors. They are the system
 * declining to guess, which is the behaviour we are selling.
 *
 * So they get the same typography and the same care as a successful panel, in
 * the calm tone Mireye's own `resolved | clarify | no_match` sets: what
 * happened, whether trying again helps, and what to do instead.
 */
export function RefusalPanel({
  refusal,
  title = "We won't guess this one",
}: {
  refusal: Refusal;
  title?: string;
}) {
  return (
    <section className="card border-stone p-0">
      <header className="border-b border-rule px-5 py-4">
        <div className="label">
          {refusal.retryable ? "Temporarily unavailable" : "Refused"} ·{" "}
          <span className="tracking-normal text-stone">{refusal.code}</span>
        </div>
        <h3 className="mt-1.5 font-display text-[18px] font-bold uppercase leading-tight">
          {title}
        </h3>
      </header>

      <div className="px-5 py-4">
        <p className="text-[15.5px] leading-snug">{refusal.message}</p>

        {refusal.candidates && refusal.candidates.length > 0 ? (
          <div className="mt-4">
            <div className="label mb-2">Did you mean</div>
            <ul className="space-y-1.5">
              {refusal.candidates.map((c) => (
                <li
                  key={c.value}
                  className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5 font-mono text-[13px]"
                >
                  <span>{c.label}</span>
                  {c.confidence !== undefined ? (
                    <span className="shrink-0 text-stone tabular">
                      {(c.confidence * 100).toFixed(0)}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {refusal.hint ? (
          <p className="mt-4 border-l-2 border-signal pl-3 text-[14.5px] leading-snug">
            {refusal.hint}
          </p>
        ) : null}

        <p className="mt-4 font-mono text-[12.5px] leading-relaxed text-stone">
          {refusal.retryable
            ? "This one can be retried."
            : "Retrying will not change this. Something about the request has to change first."}
        </p>
      </div>
    </section>
  );
}

/** A compact inline version for a single failed stage inside a working page. */
export function InlineRefusal({ refusal }: { refusal: Refusal }) {
  return (
    <div className="border border-rule bg-limestone px-4 py-3">
      <div className="label mb-1">
        Unavailable · <span className="tracking-normal text-stone">{refusal.code}</span>
      </div>
      <p className="text-[14.5px] leading-snug">{refusal.message}</p>
      {refusal.hint ? (
        <p className="mt-1.5 text-[13.5px] leading-snug text-ink/65">{refusal.hint}</p>
      ) : null}
    </div>
  );
}
