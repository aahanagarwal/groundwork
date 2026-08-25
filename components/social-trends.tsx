"use client";

import React, { useState, useEffect, useRef } from "react";

const scenarios = [
  {
    event: "LOCAL EVENT",
    headline: "SXSW brought +190 customers this week",
    happened:
      "A confirmed driver. 190 more customers than your baseline, mostly in the afternoon.",
    move: "Post your location and hours on Instagram now. Your trade area has 3x normal foot traffic - everyone is searching 'coffee near me'. The ad polygon is already drawn. Run it for the duration of the festival.",
    channel: "Instagram · Google Maps · TikTok",
    borderColor: "border-[#2c5f52]", // survey
  },
  {
    event: "NEW COMPETITOR",
    headline: "Blue Bottle filed a permit 200m away",
    happened:
      "Certificate of occupancy issued. Opening in ~6 weeks. Currently accounts for -2.3 points - unproven, but worth watching.",
    move: "Launch a loyalty campaign targeting YOUR 8-minute drive area - not their overlap zone. Remind your regulars why they come to you. Don't discount - your basket size held, which means price isn't the battleground.",
    channel: "Instagram Stories · Email · In-store signage",
    borderColor: "border-[#ebdd3c]", // signal
  },
  {
    event: "ROAD CLOSURE",
    headline: "Menchaca resurfacing cut off the south approach",
    happened:
      "Confirmed. Cost you 47 customers and $1,700 in margin over 14 days. Basket size flat - people who got there spent normal.",
    move: "Run a geo-targeted ad to the NORTH side of your trade area: 'Still open - here's the way round.' Pull budget from the blocked south side. Post the detour route on Google Maps and social.",
    channel: "Meta Ads (polygon-targeted) · Google Maps",
    borderColor: "border-[#2438c8]", // ultra
  },
  {
    event: "HEAT WAVE",
    headline: "Three days of 102°F shifted trade to mornings",
    happened:
      "Likely driver. Afternoon traffic dropped 15%, mornings held steady.",
    move: "Promote iced drinks and cold brew on social, timed for 11am–1pm when people are deciding. Shift one staffer from the 3pm slot to cover the morning rush. Post a 'beat the heat' special that expires at 2pm.",
    channel: "Instagram · TikTok · In-store",
    borderColor: "border-[#2c5f52]", // survey
  },
];

export function SocialTrends() {
  const [activeIndex, setActiveIndex] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % scenarios.length);
    }, 5000);
  };

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleDotClick = (index: number) => {
    setActiveIndex(index);
    startTimer(); // Reset timer on manual click
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-12 flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-[clamp(22px,3vw,34px)] uppercase font-extrabold text-ink leading-tight">
          Turn street intelligence into positioning
        </h2>
        <p className="font-serif text-[18px] text-ink/70 max-w-[56ch]">
          When the street gives you an advantage, your advertising should amplify
          it
        </p>
      </div>

      {/* Scenario Cards container */}
      <div className="relative h-[420px] md:h-[350px]">
        {scenarios.map((scenario, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={index}
              className={`absolute top-0 left-0 w-full h-full transition-all duration-500 ease-in-out ${
                isActive
                  ? "opacity-100 translate-x-0 pointer-events-auto"
                  : "opacity-0 translate-x-4 pointer-events-none"
              }`}
            >
              <div
                className={`card border-l-[5px] p-6 md:p-8 flex flex-col gap-6 h-full ${scenario.borderColor}`}
              >
                <div className="flex flex-col gap-2 border-b border-ink/10 pb-4">
                  <span className="label text-ink/60">{scenario.event}</span>
                  <h3 className="font-serif text-2xl md:text-3xl font-medium text-ink">
                    {scenario.headline}
                  </h3>
                </div>

                <div className="flex flex-col md:flex-row gap-6 md:gap-12 flex-grow">
                  <div className="flex-1 flex flex-col gap-2">
                    <span className="label text-ink/60 text-[11px]">
                      WHAT HAPPENED
                    </span>
                    <p className="font-sans text-[15px] leading-relaxed text-ink/80">
                      {scenario.happened}
                    </p>
                  </div>
                  <div className="flex-[1.5] flex flex-col gap-2">
                    <span className="label text-ink/60 text-[11px]">
                      YOUR MOVE
                    </span>
                    <p className="font-sans text-[15px] leading-relaxed text-ink font-medium">
                      {scenario.move}
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-ink/10">
                  <span className="font-mono text-[11px] text-ink/50 uppercase tracking-wider">
                    Channels: {scenario.channel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-3 py-2">
        {scenarios.map((_, index) => (
          <button
            key={index}
            onClick={() => handleDotClick(index)}
            className={`w-2.5 h-2.5 rounded-full transition-colors ${
              index === activeIndex ? "bg-ink" : "bg-stone/50 hover:bg-stone"
            }`}
            aria-label={`View scenario ${index + 1}`}
          />
        ))}
      </div>

      {/* Summary Footer */}
      <div className="border-t border-ink/10 pt-4 mt-4">
        <p className="font-mono text-[12px] text-survey">
          Every recommendation is grounded in measured data from your address - not
          generic advice. The numbers came first; the strategy follows.
        </p>
      </div>
    </div>
  );
}
