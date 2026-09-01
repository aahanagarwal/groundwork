"use client";

import React from "react";
import type { AttributionResult } from "@/lib/attribution/decompose";
import type { Narration } from "@/lib/agent/narrate";
import { AttributionWaterfall } from "./attribution";
import { Cited } from "./citations";

interface MathBreakdownProps {
  narration: Narration;
  attribution: AttributionResult;
  scenarioName: string;
}

function pct(n: number, digits = 1): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/**
 * Categorize narration paragraphs into actionable business tags
 */
function getPointerCategory(text: string, index: number): { tag: string; icon: string } {
  const lower = text.toLowerCase();
  if (lower.includes("ticket count") || lower.includes("expected") || lower.includes("baseline")) {
    return { tag: "TRAFFIC & BENCHMARK", icon: "📊" };
  }
  if (lower.includes("accounts for") || lower.includes("resurfacing") || lower.includes("closure") || lower.includes("competitor") || lower.includes("rain") || lower.includes("heat")) {
    return { tag: "EXTERNAL DRIVER", icon: "🚧" };
  }
  if (lower.includes("cannot account") || lower.includes("unexplained") || lower.includes("inside the shop")) {
    return { tag: "INTERNAL / UNEXPLAINED", icon: "🔍" };
  }
  if (lower.includes("basket size") || lower.includes("spending") || lower.includes("discounting")) {
    return { tag: "BASKET & PRICING", icon: "💳" };
  }
  if (lower.includes("drive area") || lower.includes("square miles") || lower.includes("ad platform") || lower.includes("budget")) {
    return { tag: "ADVERTISING & REACH", icon: "🎯" };
  }
  if (lower.includes("reopen") || lower.includes("scheduled")) {
    return { tag: "REOPENING TIMELINE", icon: "🗓️" };
  }
  if (lower.includes("caveat") || lower.includes("saturated")) {
    return { tag: "STATISTICAL DIAGNOSTIC", icon: "⚠️" };
  }
  return { tag: `FINDING 0${index + 1}`, icon: "📌" };
}

/**
 * Highlights key figures, percentages, and dollar amounts for quick scanning
 */
function formatPointerText(text: string): React.ReactNode {
  // Regex to match percentages, point values, numbers with commas, dollar amounts, and date ranges
  const regex = /(\b\d+(?:\.\d+)?%|\b[-+]\d+(?:\.\d+)?\s*(?:points|pts)|\$\d+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+\b|\b\d+\s+of\s+the\s+\d+\s+days\b)/g;
  
  const parts = text.split(regex);
  return parts.map((part, i) => {
    if (regex.test(part)) {
      return (
        <span key={i} className="font-mono font-bold text-ink bg-limestone px-1.5 py-0.5 rounded border border-rule">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function MathBreakdown({
  narration,
  attribution,
  scenarioName,
}: MathBreakdownProps) {
  const down = attribution.deltaPct < 0;

  return (
    <div className="space-y-8">
      {/* Header Overview Card */}
      <section className="card p-0 bg-paper overflow-hidden border-2 border-ink">
        <header className="px-6 py-5 border-b-[1.5px] border-ink bg-limestone/60 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[13px] uppercase tracking-widest px-2 py-0.5 bg-ink text-limestone font-bold">
                Executive Math Brief
              </span>
              <span className="font-mono text-[12.5px] uppercase tracking-wider text-survey">
                Written by {narration.narratedBy}
              </span>
            </div>
            <h2 className="font-display text-[26px] font-extrabold uppercase tracking-tight text-ink">
              The Full Breakdown &amp; Analysis
            </h2>
          </div>
          <div className="text-right font-mono text-[13px] text-survey">
            <div className="font-bold text-ink">{attribution.windowStart} &rarr; {attribution.windowEnd}</div>
            <div>{attribution.windowDays} Days &middot; {scenarioName}</div>
          </div>
        </header>

        {/* Big Headline Banner */}
        {narration.headline ? (
          <div className="px-6 py-4 bg-paper border-b border-rule">
            <div className="text-[13px] font-mono uppercase tracking-widest text-ink/60 mb-1">
              Core Conclusion:
            </div>
            <p className="font-display text-[20px] font-bold text-ink leading-snug">
              {narration.headline}
            </p>
          </div>
        ) : null}

        {/* 4-Stat Metric Strip */}
        <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 sm:divide-y-0 bg-paper border-b border-rule">
          <div className="px-5 py-4">
            <div className="label">Observed Customers</div>
            <div className="mt-1 font-mono text-[22px] font-bold tabular text-ink">
              {attribution.observedTickets.toLocaleString()}
            </div>
            <div className="text-[12.5px] text-ink/60 font-mono mt-0.5">Tickets in window</div>
          </div>

          <div className="px-5 py-4">
            <div className="label">Expected Baseline</div>
            <div className="mt-1 font-mono text-[22px] font-bold tabular text-ink">
              {attribution.baselineTickets.toLocaleString()}
            </div>
            <div className="text-[12.5px] text-ink/60 font-mono mt-0.5">Based on normal days</div>
          </div>

          <div className="px-5 py-4">
            <div className="label">Total Net Movement</div>
            <div className={`mt-1 font-mono text-[22px] font-bold tabular ${down ? "text-ultra" : "text-survey"}`}>
              {pct(attribution.deltaPct)}
            </div>
            <div className="text-[12.5px] text-ink/60 font-mono mt-0.5">
              {Math.abs(attribution.observedTickets - attribution.baselineTickets)} tickets gap
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="label">Basket Size Shift</div>
            <div className="mt-1 font-mono text-[22px] font-bold tabular text-ink">
              {pct(attribution.basketSizeDeltaPct)}
            </div>
            <div className="text-[12.5px] text-ink/60 font-mono mt-0.5">
              {Math.abs(attribution.basketSizeDeltaPct) < 2 ? "Flat (reach problem)" : "Mix shift"}
            </div>
          </div>
        </div>

        {/* Key Pointers Section */}
        <div className="px-6 py-6 bg-paper">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="label">Key Findings in Plain English</div>
              <h3 className="font-display text-[19px] font-bold uppercase tracking-tight text-ink">
                What The Numbers Mean For Your Business
              </h3>
            </div>
            <span className="font-mono text-[13px] uppercase tracking-wider text-ink/60">
              {narration.body.length} Actionable Points
            </span>
          </div>

          <div className="grid gap-3">
            {narration.body.map((paragraph, i) => {
              const { tag } = getPointerCategory(paragraph, i);
              const numStr = String(i + 1).padStart(2, "0");

              return (
                <div
                  key={i}
                  className="flex flex-col sm:flex-row items-start gap-3.5 p-4 rounded border border-rule bg-limestone/30 hover:bg-limestone/60 transition-colors"
                >
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[13px] font-bold px-2 py-1 bg-ink text-limestone rounded border border-ink">
                      {numStr}
                    </span>
                    <span className="sm:hidden font-mono text-[12.5px] uppercase tracking-wider px-2 py-0.5 bg-paper border border-rule text-survey font-bold">
                      {tag}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="hidden sm:inline-block mb-1.5">
                      <span className="font-mono text-[12.5px] uppercase tracking-wider px-2 py-0.5 bg-paper border border-rule text-survey font-bold rounded">
                        {tag}
                      </span>
                    </div>
                    <p className="text-[15.5px] leading-[1.55] text-ink/90">
                      {formatPointerText(paragraph)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Attribution Waterfall Mathematical Visualizer */}
      <div className="pt-2">
        <AttributionWaterfall
          attribution={attribution}
          scenarioName={scenarioName}
        />
      </div>
    </div>
  );
}
