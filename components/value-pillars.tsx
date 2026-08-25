"use client";

import { useEffect, useRef } from "react";

const pillars = [
  {
    icon: "01",
    heading: "Understand Your Revenue",
    body: "Stop guessing why sales are up or down. Groundwork separates what's happening on your street - road closures, weather, new competitors - from what's happening inside your shop. In dollars and customers you can act on, not abstract percentages.",
    highlight: "Know within hours, not weeks",
  },
  {
    icon: "02",
    heading: "Fix Your Advertising",
    body: "Your ad platform targets a 5-mile circle. But only 40% of that circle can actually reach you in 8 minutes. We draw your real trade area - shaped by roads, bridges, and closures - and move your budget to where it works. When a road closes, we pull spend off the blocked side automatically.",
    highlight: "Stop paying for people who can't reach you",
  },
  {
    icon: "03",
    heading: "Stay Ahead of Threats",
    body: "A new competitor filing a permit 200 meters away. A road closure cutting off half your approach. A weather pattern that moves your afternoon trade. Groundwork watches the feeds, filters them against YOUR specific trade area, and tells you before it hits your till.",
    highlight: "Alerts that actually matter to your address",
  },
];

export function ValuePillars() {
  const sectionRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove("opacity-0", "translate-y-6");
            entry.target.classList.add("opacity-100", "translate-y-0");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    const cards = sectionRef.current?.querySelectorAll(".pillar-card");
    cards?.forEach((card) => observer.observe(card));

    return () => {
      cards?.forEach((card) => observer.unobserve(card));
      observer.disconnect();
    };
  }, []);

  return (
    <section className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto" ref={sectionRef}>
      <div className="mb-12">
        <h2 className="font-display text-[clamp(24px,3.5vw,38px)] uppercase font-extrabold text-ink">
          How Groundwork helps your business
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {pillars.map((pillar, index) => (
          <div
            key={index}
            className="pillar-card card p-6 bg-paper border-[1.5px] border-ink opacity-0 translate-y-6 transition-all duration-700 hover:shadow-md hover:-translate-y-0.5 flex flex-col h-full"
            style={{ transitionDelay: `${index * 150}ms` }}
          >
            <div className="mb-6 flex items-center justify-center w-12 h-12 border border-survey text-xl font-mono text-survey bg-limestone">
              {pillar.icon}
            </div>
            
            <h3 className="font-display text-[17px] uppercase font-bold text-ink mb-4">
              {pillar.heading}
            </h3>
            
            <p className="font-serif text-ink/80 mb-6 flex-grow leading-relaxed">
              {pillar.body}
            </p>
            
            <div className="mt-auto pt-4 border-t-[1px] border-ink/10">
              <span className="hl font-mono text-sm inline-block font-semibold">
                {pillar.highlight}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
