"use client";

import { useState } from "react";

/**
 * GETTING STARTED BANNER
 *
 * A dismissible orientation banner for the site detail page. Shows first-time
 * visitors what they're looking at in plain English, with a quick legend for
 * the verdict chips and a tip about signal-yellow highlights.
 *
 * Dismissal persists in sessionStorage so it stays gone for the current
 * session but reappears on a fresh visit - because a returning user might
 * still be learning, and the banner is light enough not to annoy.
 */

const STORAGE_KEY = "groundwork-banner-dismissed";

export function GettingStartedBanner({ siteLabel }: { siteLabel: string }) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // sessionStorage might be unavailable in some contexts
    }
  };

  return (
    <div className="mb-6 border-[1.5px] border-survey bg-paper p-5 relative">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-3 right-3 font-mono text-[11px] text-stone hover:text-ink transition-colors"
        aria-label="Dismiss"
      >
        ✕
      </button>

      <div className="label mb-2">Here&rsquo;s what you&rsquo;re looking at</div>

      <p className="text-[15.5px] leading-snug max-w-[64ch] mb-4">
        This is your business report for{" "}
        <strong>{siteLabel}</strong>. Groundwork has analyzed what happened on your
        street, separated it from what happened inside your shop, and turned it into
        customers and dollars you can act on.
      </p>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="shrink-0 border border-ink bg-ink px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-limestone">
            Not your fault
          </span>
          <span className="text-[13px] text-ink/70">The street did it</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 border border-ink bg-signal px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink">
            Partly explained
          </span>
          <span className="text-[13px] text-ink/70">We found some of it</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 border border-stone px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-stone">
            Unexplained
          </span>
          <span className="text-[13px] text-ink/70">Something we can&rsquo;t see</span>
        </div>
      </div>

      <p className="font-mono text-[11px] text-survey leading-relaxed">
        Tip: <span className="hl px-0.5">Yellow-highlighted numbers</span> are the ones
        that matter most. Click any number to see exactly where it came from.
      </p>
    </div>
  );
}
