"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProposedActionRecord } from "@/lib/domain";
import { Cited } from "./citations";

/**
 * THE ACTION CENTER AND THE APPROVAL GATE
 *
 * Nothing here executes. Approving marks the draft approved in the database
 * and nothing else — no ad account is connected, no order is placed, no post
 * is made. The gate is real all the same, because the point of the gate is
 * that a human sees the cost and the expected value before anything moves, and
 * that habit has to exist before the wire is live.
 *
 * Alerts and analysis skip the gate entirely. Only spend, orders and public
 * posts stop here.
 */
export function ActionCenter({ actions }: { actions: ProposedActionRecord[] }) {
  if (actions.length === 0) {
    return (
      <div className="card-flat p-5">
        <div className="label mb-1.5">Action center</div>
        <p className="text-[15px] leading-snug">
          Nothing to approve. The engine found no movement worth acting on in
          this window — which is a result, not an empty state.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="label">Action center — {actions.length} proposed</div>
      {actions.map((action) => (
        <ActionCard key={action.id} action={action} />
      ))}
    </div>
  );
}

function ActionCard({ action }: { action: ProposedActionRecord }) {
  const router = useRouter();
  const [status, setStatus] = useState(action.status);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const response = await fetch(`/api/actions/${action.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (response.ok) {
        setStatus(decision);
        setConfirming(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const decided = status === "approved" || status === "rejected";

  return (
    <article
      className={`card p-0 ${status === "approved" ? "border-survey" : ""}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <div className="label">
            {action.module === "advertising" ? "Advertising" : "Threat watch"}
            {action.requiresApproval ? (
              <span className="ml-2 border border-signal bg-signal px-1.5 py-0.5 tracking-normal text-ink">
                NEEDS APPROVAL
              </span>
            ) : (
              <span className="ml-2 text-stone">
                alert — no approval needed
              </span>
            )}
          </div>
          <h3 className="mt-1.5 font-display text-[17px] font-bold uppercase leading-tight">
            {action.title}
          </h3>
        </div>

        {status === "approved" ? (
          <span className="shrink-0 border-[1.5px] border-survey bg-survey px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-paper">
            Approved
          </span>
        ) : status === "rejected" ? (
          <span className="shrink-0 border border-stone px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-stone">
            Declined
          </span>
        ) : null}
      </header>

      <div className="px-5 py-4">
        <p className="text-[15.5px] leading-snug">{action.rationale}</p>

        {(action.costUsd !== null || action.expectedValueUsd !== null) && (
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-y border-rule py-3">
            {action.costUsd !== null ? (
              <div>
                <div className="label">Cost</div>
                <div className="font-mono text-[17px] tabular">
                  ${action.costUsd.toLocaleString()}
                </div>
              </div>
            ) : null}
            {action.expectedValueUsd !== null ? (
              <div>
                <div className="label">Expected value</div>
                <div className="font-mono text-[17px] tabular">
                  <Cited
                    label="Expected value"
                    value={`$${action.expectedValueUsd.toLocaleString()}`}
                    derivation={
                      "The budget currently aimed at the part of the trade area a closure has cut off. Those people " +
                      "cannot reach the door at any conversion rate, so that spend returns zero. The expected value " +
                      "is the recovered spend itself — NOT a revenue uplift. We hold no click data, no matched " +
                      "conversions and no holdout, so we cannot say what share of tickets ads drive, and we do not " +
                      "guess. Dividing total tickets by total ad spend would produce a far larger and entirely " +
                      "unearned number."
                    }
                    detail={{
                      costUsd: action.costUsd,
                      expectedValueUsd: action.expectedValueUsd,
                    }}
                    provenance={
                      action.evidence[action.evidence.length - 1] ?? {
                        source: "Groundwork decision module",
                        fetchedAt: action.createdAt,
                        mocked: false,
                      }
                    }
                  />
                </div>
              </div>
            ) : null}
            {action.horizon ? (
              <div>
                <div className="label">Horizon</div>
                <div className="font-mono text-[17px]">{action.horizon}</div>
              </div>
            ) : null}
          </div>
        )}

        {action.payload ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowPayload((v) => !v)}
              className="font-mono text-[11px] uppercase tracking-widest text-ultra underline">
              {showPayload ? "Hide" : "Review"} the draft payload
            </button>
            {showPayload ? (
              <pre className="mt-2 max-h-[300px] overflow-auto border border-rule bg-limestone p-3 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(action.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}

        {action.evidence.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {action.evidence.map((provenance, i) => (
              <Cited
                key={`${provenance.source}-${i}`}
                label="Evidence"
                value={
                  <span className="font-mono text-[11px]">
                    {provenance.source}
                  </span>
                }
                provenance={provenance}
              />
            ))}
          </div>
        ) : null}

        {action.requiresApproval && !decided ? (
          <div className="mt-5">
            {confirming ? (
              <div className="border-[1.5px] border-ink bg-limestone p-4">
                <p className="text-[15px] leading-snug">
                  This will mark the draft approved in Groundwork&rsquo;s
                  database.{" "}
                  <strong>
                    Nothing is sent anywhere — no ad account is connected in
                    this build.
                  </strong>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide("approved")}
                    className="border-[1.5px] border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-limestone disabled:opacity-50">
                    {busy ? "Working…" : "Yes, approve"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                    className="border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-widest">
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="border-[1.5px] border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-ink hover:text-limestone">
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("rejected")}
                  className="border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-stone hover:border-ink hover:text-ink">
                  Not now
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
