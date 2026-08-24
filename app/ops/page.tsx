import Link from "next/link";
import { readAll } from "@/lib/telemetry/ledger";
import { allStates } from "@/lib/mireye/budget";
import { proposedActions, tradeAreas } from "@/lib/domain";
import { backend, isMockMode } from "@/lib/store";
import { config, TRADE_AREA_MINUTES } from "@/lib/config";
import { RIDGE_FRACTION } from "@/lib/attribution/ols";
import { Sheet, Plate, Footer } from "@/components/chrome";

export const dynamic = "force-dynamic";

/**
 * OPS — numbers on the machinery, not on the business.
 *
 * A different reader from the consultant surface: this one wants to know
 * whether the thing is credit-safe, whether the quote matches the bill, and
 * whether the attribution is measured or asserted. Labelled clearly so nobody
 * mistakes it for the owner-facing product, and built to the same standard,
 * because a system that claims to be honest has to be auditable.
 */
export default async function OpsPage() {
  const entries = readAll();
  const budgets = allStates();
  const polygons = tradeAreas.all();
  const decisions = proposedActions.all();

  const byEndpoint = new Map<
    string,
    {
      calls: number;
      cacheHits: number;
      refusals: number;
      credits: number;
      totalMs: number;
    }
  >();
  for (const e of entries) {
    const row = byEndpoint.get(e.endpoint) ?? {
      calls: 0,
      cacheHits: 0,
      refusals: 0,
      credits: 0,
      totalMs: 0,
    };
    row.calls += 1;
    if (e.cacheHit) row.cacheHits += 1;
    if (e.refused) row.refusals += 1;
    row.credits += e.creditsActual ?? e.creditsEstimated ?? 0;
    row.totalMs += e.durationMs;
    byEndpoint.set(e.endpoint, row);
  }

  const totalCalls = entries.length;
  const totalCacheHits = entries.filter((e) => e.cacheHit).length;
  const totalRefusals = entries.filter((e) => e.refused).length;
  const totalCredits = entries.reduce(
    (s, e) => s + (e.creditsActual ?? e.creditsEstimated ?? 0),
    0,
  );

  const refusalCodes = Object.entries(
    entries
      .filter((e) => e.refused && e.refusalCode)
      .reduce<Record<string, number>>((acc, e) => {
        acc[e.refusalCode!] = (acc[e.refusalCode!] ?? 0) + 1;
        return acc;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Sheet>
        <Plate
          no="OPS"
          name="Instrumentation"
          of="not the owner-facing product"
        />

        <p className="max-w-[68ch] text-[17px] leading-snug">
          This page is aimed at a technical reader, not at a shop owner. It
          reports what the system spent, what it refused, and how much of what
          it claims is measured rather than asserted.
        </p>

        {/* --- Mode: say plainly what is real right now ------------------- */}
        <section className="mt-8 card p-5">
          <div className="label mb-3">Running configuration</div>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Mireye mode" value={config.mireye.mode} />
            <Field
              label="Mireye key"
              value={config.mireye.apiKey ? "present" : "absent"}
              warn={!config.mireye.apiKey}
            />
            <Field
              label="Store backend"
              value={backend()}
              warn={backend() === "files"}
            />
            <Field
              label="Narrator"
              value={
                config.openai.enabled
                  ? config.openai.model
                  : "deterministic template"
              }
              warn={!config.openai.enabled}
            />
          </dl>
          {isMockMode() ? (
            <p className="mt-4 border-l-2 border-signal pl-3 text-[15px] leading-snug">
              One or more secrets are absent. Mireye calls replay from recorded
              fixtures where they exist and <strong>refuse</strong> where they
              do not; the trade area falls back to the local OSRM router and
              says so on its own citation. Weather is live regardless —
              Open-Meteo needs no key. Nothing is silently faked.
            </p>
          ) : null}
        </section>

        {/* --- Credit safety ---------------------------------------------- */}
        <section className="mt-6">
          <div className="label mb-3">Credit ledger</div>
          <div className="grid grid-cols-2 gap-px border-[1.5px] border-ink bg-rule sm:grid-cols-4">
            <Stat label="Calls" value={totalCalls.toLocaleString()} />
            <Stat
              label="Cache hit rate"
              value={
                totalCalls
                  ? `${((totalCacheHits / totalCalls) * 100).toFixed(0)}%`
                  : "—"
              }
            />
            <Stat label="Credits spent" value={totalCredits.toLocaleString()} />
            <Stat
              label="Refusal rate"
              value={
                totalCalls
                  ? `${((totalRefusals / totalCalls) * 100).toFixed(0)}%`
                  : "—"
              }
            />
          </div>

          {byEndpoint.size > 0 ? (
            <table className="mt-4 w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <Th>Endpoint</Th>
                  <Th right>Calls</Th>
                  <Th right>Cache</Th>
                  <Th right>Refused</Th>
                  <Th right>Credits</Th>
                  <Th right>Mean ms</Th>
                </tr>
              </thead>
              <tbody>
                {[...byEndpoint.entries()]
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([endpoint, r]) => (
                    <tr key={endpoint} className="border-b border-rule">
                      <td className="py-2 font-mono text-[12.5px]">
                        {endpoint}
                      </td>
                      <Td>{r.calls}</Td>
                      <Td>{((r.cacheHits / r.calls) * 100).toFixed(0)}%</Td>
                      <Td>{r.refusals}</Td>
                      <Td>{r.credits.toLocaleString()}</Td>
                      <Td>{Math.round(r.totalMs / r.calls)}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-4 text-[15px]">
              No calls recorded yet. Load a site page to populate the ledger.
            </p>
          )}
        </section>

        {/* --- Per-agent ceilings ------------------------------------------ */}
        <section className="mt-8">
          <div className="label mb-1">Per-agent daily ceilings</div>
          <p className="mb-3 max-w-[68ch] text-[15px] leading-snug">
            Each agent asks the Budget Broker before any live call. Threat Watch
            has the tightest ceiling on purpose: it runs unattended, and nothing
            that runs while nobody is watching gets a large budget.
          </p>
          <div className="space-y-2">
            {budgets.map((b) => (
              <div key={b.agent} className="border border-rule px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] uppercase tracking-[0.14em]">
                    {b.agent}
                  </span>
                  <span className="font-mono text-[12px] tabular text-survey">
                    {b.spent.toLocaleString()} / {b.ceiling.toLocaleString()}{" "}
                    credits today
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full bg-limestone">
                  <div
                    className="h-full bg-survey"
                    style={{
                      width: `${Math.min(100, (b.spent / b.ceiling) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[13.5px] leading-snug text-ink/65">
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* --- Polygon validation ------------------------------------------ */}
        <section className="mt-8">
          <div className="label mb-1">Derived trade areas</div>
          <p className="mb-3 max-w-[68ch] text-[15px] leading-snug">
            Mireye returns no polygon geometry — confirmed against its live
            OpenAPI spec. These boundaries are built by us from measured drive
            times, and each carries its own error figure: after interpolating a
            bearing&rsquo;s boundary we re-probe at exactly that point and
            compare the drive time found there against the {TRADE_AREA_MINUTES}
            -minute target.
          </p>
          {polygons.length > 0 ? (
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <Th>Site</Th>
                  <Th>Engine</Th>
                  <Th right>Area</Th>
                  <Th right>Circle</Th>
                  <Th right>Misaimed</Th>
                  <Th right>Probes</Th>
                  <Th right>Credits</Th>
                  <Th right>Mean err</Th>
                </tr>
              </thead>
              <tbody>
                {polygons.map((t) => (
                  <tr key={t.id} className="border-b border-rule">
                    <td className="py-2 font-mono text-[12.5px]">{t.siteId}</td>
                    <td className="py-2 font-mono text-[12.5px]">{t.engine}</td>
                    <Td>{t.areaSqMi.toFixed(1)} mi²</Td>
                    <Td>{t.naiveAreaSqMi.toFixed(0)} mi²</Td>
                    <Td>
                      {((1 - t.areaSqMi / t.naiveAreaSqMi) * 100).toFixed(0)}%
                    </Td>
                    <Td>{t.probesTested}</Td>
                    <Td>{t.creditsActual.toLocaleString()}</Td>
                    <Td>±{t.accuracyMeanErrorMinutes.toFixed(2)} min</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[15px]">No polygons computed yet.</p>
          )}
        </section>

        {/* --- Method disclosure -------------------------------------------- */}
        <section className="mt-8 card p-5">
          <div className="label mb-3">Attribution method, stated</div>
          <ul className="space-y-2 text-[15px] leading-snug">
            <li>
              <strong>No language model computes a number.</strong> Attribution
              is deterministic code. The narrator receives the finished object
              and turns it into sentences; it cannot assert a figure that was
              not already in that object.
            </li>
            <li>
              <strong>Baseline</strong> is a trailing 28-day level times a
              day-of-week factor, fitted only on days when nothing was happening
              on the street. A baseline fitted through a closure absorbs the
              closure.
            </li>
            <li>
              <strong>Drivers enter simultaneously</strong> in one
              ridge-regularised regression of daily residuals on driver
              magnitude — not sequential subtraction, so what each driver gets
              is its partial effect with the others held constant.
            </li>
            <li>
              <strong>Shrinkage is deliberate,</strong> at {RIDGE_FRACTION} of
              the design&rsquo;s mean diagonal. Plain least squares on indicator
              regressors forces residuals to sum to zero within each
              driver&rsquo;s own day-set, so when the window being explained{" "}
              <em>is</em> that day-set, the drivers account for exactly 100% as
              an accounting identity and ε comes out at 0.0 whatever really
              happened. Shrunk-away weight falls through to ε rather than being
              handed to whichever driver was active.
            </li>
            <li>
              <strong>Saturated windows are flagged,</strong> not smoothed over.
              If every day in the window had something happening, the total is
              solid and the split between drivers is an estimate — and the brief
              says so in those words.
            </li>
          </ul>
        </section>

        {/* --- Decisions ---------------------------------------------------- */}
        <section className="mt-8">
          <div className="label mb-3">Decisions produced</div>
          <div className="grid grid-cols-2 gap-px border-[1.5px] border-ink bg-rule sm:grid-cols-4">
            <Stat label="Proposed" value={String(decisions.length)} />
            <Stat
              label="Needing approval"
              value={String(decisions.filter((d) => d.requiresApproval).length)}
            />
            <Stat
              label="Approved"
              value={String(
                decisions.filter((d) => d.status === "approved").length,
              )}
            />
            <Stat label="Dispatched externally" value="0" />
          </div>
          <p className="mt-3 max-w-[68ch] text-[15px] leading-snug">
            The last figure is zero by construction, not by coincidence. No
            credential exists in this build that could post to an ad platform,
            place an order, or publish anything. Approving marks a draft
            approved in the database and stops.
          </p>
        </section>

        {refusalCodes.length > 0 ? (
          <section className="mt-8">
            <div className="label mb-1">Refusals by code</div>
            <p className="mb-3 max-w-[68ch] text-[15px] leading-snug">
              A refusal is a designed state, not an error. A high rate here with
              an absent key is the system working correctly — declining to
              guess.
            </p>
            <ul className="space-y-1">
              {refusalCodes.map(([code, count]) => (
                <li
                  key={code}
                  className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5 font-mono text-[13px]">
                  <span>{code}</span>
                  <span className="tabular">{count}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-10">
          <Link href="/" className="label underline">
            ← Back to the addresses
          </Link>
        </div>
      </Sheet>
      <Footer />
    </>
  );
}

function Field({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-[14px] ${warn ? "text-stone" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper px-4 py-3">
      <div className="label">{label}</div>
      <div className="mt-0.5 font-mono text-[20px] tabular">{value}</div>
    </div>
  );
}

function Th({
  children,
  right = false,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`border-b-[1.5px] border-ink pb-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] ${
        right ? "text-right" : "text-left"
      }`}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-2 text-right font-mono text-[12.5px] tabular">
      {children}
    </td>
  );
}
