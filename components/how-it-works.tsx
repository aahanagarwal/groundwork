'use client';

import { useEffect, useRef } from 'react';

export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const steps = Array.from(entry.target.querySelectorAll('.step-anim'));
            steps.forEach((step, index) => {
              (step as HTMLElement).style.transitionDelay = `${index * 200}ms`;
              (step as HTMLElement).classList.add('opacity-100', 'translate-x-0');
              (step as HTMLElement).classList.remove('opacity-0', '-translate-x-[12px]');
            });
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={containerRef} className="py-16 bg-limestone px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="font-display text-[clamp(22px,3vw,34px)] uppercase font-extrabold text-ink mb-2">
          What happens when you open Groundwork
        </h2>
        <p className="font-serif text-[18px] text-ink/70 mb-12">
          Every morning, in under two minutes
        </p>

        <div className="relative flex flex-col">
          {/* Step 1 */}
          <div className="step-anim opacity-0 -translate-x-[12px] transition-all duration-700 ease-out flex relative group">
            <div className="flex flex-col items-center mr-6">
              <div className="w-[40px] h-[40px] rounded-full border-[2px] border-ink bg-limestone flex items-center justify-center font-mono text-[14px] font-bold text-ink z-10 shrink-0">
                1
              </div>
              {/* Connector */}
              <div className="w-[2px] border-l-[2px] border-dashed border-ink/20 h-full min-h-[40px] my-2 group-last:hidden"></div>
            </div>
            
            <div className="pb-10 pt-2">
              <h3 className="font-display font-bold uppercase text-ink text-xl mb-3 flex items-center gap-3 flex-wrap">
                Open the app → Instant verdict
                <span className="bg-ink text-limestone px-2 py-1 font-mono text-[10px] uppercase rounded-sm whitespace-nowrap">NOT YOUR FAULT</span>
              </h3>
              <p className="font-serif text-ink/80 text-base leading-relaxed">
                Before you finish your coffee, you see the answer: 'This wasn’t you - it was the street.' or 'You ran ahead, and it wasn’t luck.' In customers and dollars, not percentages.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="step-anim opacity-0 -translate-x-[12px] transition-all duration-700 ease-out flex relative group">
            <div className="flex flex-col items-center mr-6">
              <div className="w-[40px] h-[40px] rounded-full border-[2px] border-ink bg-limestone flex items-center justify-center font-mono text-[14px] font-bold text-ink z-10 shrink-0">
                2
              </div>
              <div className="w-[2px] border-l-[2px] border-dashed border-ink/20 h-full min-h-[40px] my-2 group-last:hidden"></div>
            </div>
            
            <div className="pb-10 pt-2">
              <h3 className="font-display font-bold uppercase text-ink text-xl mb-3">
                See exactly what moved it
              </h3>
              <div className="flex gap-2 mb-3 flex-wrap">
                <span className="label bg-paper px-2 py-0.5 border border-ink/10 text-ink/80">Road closure</span>
                <span className="label bg-paper px-2 py-0.5 border border-ink/10 text-ink/80">Heat</span>
                <span className="label bg-paper px-2 py-0.5 border border-ink/10 text-ink/80">Competitor</span>
              </div>
              <p className="font-serif text-ink/80 text-base leading-relaxed">
                A road closure on Menchaca. Three days of 102°F heat. A new competitor 200m away. Each one shows how many customers it cost you and how certain we are - 'confirmed', 'likely', or 'unproven'. We never tell you to act on something we couldn’t measure.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="step-anim opacity-0 -translate-x-[12px] transition-all duration-700 ease-out flex relative group">
            <div className="flex flex-col items-center mr-6">
              <div className="w-[40px] h-[40px] rounded-full border-[2px] border-ink bg-limestone flex items-center justify-center font-mono text-[14px] font-bold text-ink z-10 shrink-0">
                3
              </div>
              <div className="w-[2px] border-l-[2px] border-dashed border-ink/20 h-full min-h-[40px] my-2 group-last:hidden"></div>
            </div>
            
            <div className="pb-10 pt-2">
              <h3 className="font-display font-bold uppercase text-ink text-xl mb-3">
                Get told what to do
              </h3>
              <p className="font-serif text-ink/80 text-base leading-relaxed mb-4">
                Move $340 of ad spend off the closed approach. Hold your prices - basket size didn’t move. Push iced drinks to the afternoon shift. Each action comes with a cost and an expected value, and nothing fires until you approve it.
              </p>
              <div className="flex gap-2">
                <button className="bg-survey text-limestone font-mono text-[10px] px-3 py-1.5 uppercase tracking-wider hover:opacity-90 transition-opacity">APPROVE</button>
                <button className="bg-paper border border-ink/20 text-ink font-mono text-[10px] px-3 py-1.5 uppercase tracking-wider hover:bg-limestone transition-colors">NOT NOW</button>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="step-anim opacity-0 -translate-x-[12px] transition-all duration-700 ease-out flex relative group">
            <div className="flex flex-col items-center mr-6">
              <div className="w-[40px] h-[40px] rounded-full border-[2px] border-ink bg-limestone flex items-center justify-center font-mono text-[14px] font-bold text-ink z-10 shrink-0">
                4
              </div>
              {/* No connector on last item */}
              <div className="w-[2px] border-l-[2px] border-dashed border-ink/20 h-full min-h-[40px] my-2 hidden"></div>
            </div>
            
            <div className="pb-2 pt-2 w-full">
              <h3 className="font-display font-bold uppercase text-ink text-xl mb-3">
                Tell us what we missed
              </h3>
              <p className="font-serif text-ink/80 text-base leading-relaxed mb-4">
                We show you exactly how much we can’t explain. You tell us what was happening - a broken grinder, a staff shortage, a menu change. Your knowledge fills the gap our data can’t, and the numbers stop blaming the street for something that happened inside.
              </p>
              <div className="border border-ink/20 bg-paper px-3 py-2 font-mono text-[11px] text-stone w-full max-w-sm rounded-sm">
                Grinder broke Tuesday...
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
