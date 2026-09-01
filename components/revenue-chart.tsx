"use client";

import { useState } from "react";
import type { AttributionResult } from "@/lib/attribution/decompose";

/**
 * Observed tickets against the expected line, with the window under
 * investigation shaded.
 *
 * Hand-drawn SVG rather than a chart library: the survey aesthetic wants
 * hairlines and no chrome, and the only interaction needed is a hover readout.
 */
export function RevenueChart({ attribution }: { attribution: AttributionResult }) {
  const [hover, setHover] = useState<number | null>(null);

  const series = attribution.series;
  if (series.length === 0) return null;

  const W = 900;
  const H = 200;
  const PAD = { top: 12, right: 8, bottom: 20, left: 8 };

  const max = Math.max(...series.map((p) => Math.max(p.tickets, p.baseline))) * 1.05;
  const min = Math.min(...series.map((p) => Math.min(p.tickets, p.baseline))) * 0.9;

  const x = (i: number) =>
    PAD.left + (i / (series.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  const line = (get: (p: (typeof series)[number]) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(" ");

  const windowStart = series.findIndex((p) => p.inWindow);
  const windowEnd = series.findLastIndex((p) => p.inWindow);
  const active = hover !== null ? series[hover] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="label">Daily tickets vs expected</span>
        <span className="font-mono text-[12.5px] text-survey">
          {active ? (
            <>
              {active.date} · {active.tickets} actual · {Math.round(active.baseline)} expected ·{" "}
              <span className={active.residual < 0 ? "text-ultra" : "text-survey"}>
                {active.residual > 0 ? "+" : ""}
                {Math.round(active.residual)}
              </span>
            </>
          ) : (
            `${series.length} days · hover for a day`
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full border border-rule bg-paper"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
      >
        {/* The window under investigation. */}
        {windowStart >= 0 ? (
          <rect
            x={x(windowStart)}
            y={PAD.top}
            width={x(windowEnd) - x(windowStart)}
            height={H - PAD.top - PAD.bottom}
            fill="var(--color-signal)"
            opacity={0.28}
          />
        ) : null}

        {/* Expected: a thin dashed line - it is a claim, not an observation. */}
        <path
          d={line((p) => p.baseline)}
          fill="none"
          stroke="var(--color-survey)"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        {/* Observed: solid, heavier. */}
        <path
          d={line((p) => p.tickets)}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />

        {active ? (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="var(--color-ultra)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {/* Invisible hover targets. */}
        {series.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - (W / series.length) / 2}
            y={0}
            width={W / series.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div className="mt-1.5 flex flex-wrap gap-4 font-mono text-[13px] text-survey">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-[1.5px] border-ink" /> actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-survey" /> expected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 bg-signal/50" /> the window being explained
        </span>
      </div>
    </div>
  );
}
