"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

const questions = [
  "Why were sales down 12% this Tuesday?",
  "Is the new coffee shop on 5th hurting me?",
  "Am I wasting money on ads nobody sees?",
  "Should I run a discount or hold my prices?",
  "Was that the weather, or was that me?"
];

const TYPE_MS = 40;
const HOLD_MS = 2000;

export function WelcomeHero() {
  const [typed, setTyped] = useState({ qIndex: 0, charIndex: 0 });

  useEffect(() => {
    // One self-scheduling timer owns the animation: it holds the cursor
    // position in local variables and pushes each frame into React, so the
    // effect never reads state it also writes.
    let qIndex = 0;
    let charIndex = 0;
    let timeout: ReturnType<typeof setTimeout>;

    const step = () => {
      const full = questions[qIndex];
      let delay = TYPE_MS;

      if (charIndex < full.length) {
        charIndex += 1;
        // Sit on the finished question before clearing it.
        if (charIndex === full.length) delay = HOLD_MS;
      } else {
        qIndex = (qIndex + 1) % questions.length;
        charIndex = 0;
      }

      setTyped({ qIndex, charIndex });
      timeout = setTimeout(step, delay);
    };

    timeout = setTimeout(step, TYPE_MS);
    return () => clearTimeout(timeout);
  }, []);

  const currentText = questions[typed.qIndex].substring(0, typed.charIndex);

  return (
    <section className="w-full pt-20 pb-16 bg-paper text-ink">
      <div className="mx-auto w-full max-w-[1080px] px-7">
        
        {/* Main headline */}
        <h1 
          className="font-display uppercase leading-[0.95] tracking-tight mb-8"
          style={{ fontSize: "clamp(32px, 6vw, 72px)" }}
        >
          Know exactly why your sales moved - and what to do about it
        </h1>

        {/* Animated typing effect */}
        <div className="mb-8 font-serif text-[24px] text-survey h-[32px] flex items-center">
          <span className="inline-block relative">
            &quot;{currentText}&quot;
            <span className="inline-block w-[2px] h-[24px] bg-survey ml-1 align-middle animate-pulse" />
          </span>
        </div>

        {/* Value proposition subtitle */}
        <p className="font-serif text-[19px] leading-relaxed max-w-[52ch] text-ink/80 mb-10">
          Groundwork reads the permits, the weather, the competition, and your own till - and tells you in plain English what moved your revenue and what to do next. No dashboards. No guesswork. Just the answer.
        </p>

        {/* CTA area */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 mb-16">
          <Link 
            href="#addresses" 
            className="inline-flex items-center justify-center px-6 py-3 border border-ink bg-ink text-limestone font-mono text-sm uppercase tracking-wide hover:bg-ink/90 transition-colors"
          >
            See it in action →
          </Link>
          <span className="font-mono text-sm text-ink/60 italic">
            Pick a real Austin address below
          </span>
        </div>

        {/* Trust strip */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-wide text-survey">
          <span>Every number cited</span>
          <span aria-hidden="true">·</span>
          <span>No foot-traffic guesses</span>
          <span aria-hidden="true">·</span>
          <span>No vanity metrics</span>
          <span aria-hidden="true">·</span>
          <span>You approve before anything moves</span>
        </div>
      </div>
    </section>
  );
}
