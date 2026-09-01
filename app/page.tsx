import Link from "next/link";
import { Sheet, Footer } from "@/components/chrome";
import { DEMO_SITES } from "@/lib/demo-sites";
import { WelcomeHero } from "@/components/welcome-hero";
import { ValuePillars } from "@/components/value-pillars";
import { HowItWorks } from "@/components/how-it-works";
import { SocialTrends } from "@/components/social-trends";

export default function Home() {
  return (
    <>
      {/* --- Hero: the first thing a business owner reads ------------------- */}
      <WelcomeHero />

      {/* --- Value Pillars: how Groundwork helps your business -------------- */}
      <Sheet>
        <ValuePillars />
      </Sheet>

      {/* --- How It Works: step-by-step walkthrough ------------------------- */}
      <Sheet className="mt-4">
        <HowItWorks />
      </Sheet>

      {/* --- Social & Positioning Intelligence ----------------------------- */}
      <Sheet className="mt-8">
        <SocialTrends />
      </Sheet>

      {/* --- Address Picker ------------------------------------------------- */}
      <Sheet className="mt-16" id="addresses">
        <div className="mb-2">
          <span className="label">Try it now</span>
        </div>
        <h2 className="font-display text-[clamp(24px,3.5vw,38px)] uppercase font-extrabold leading-[0.98] tracking-[-0.02em]">
          Pick a real address
        </h2>
        <p className="mt-3 mb-8 max-w-[62ch] text-[18px] leading-[1.45] text-ink/80">
          Three real Austin food-and-beverage businesses, each showing a
          different story. Pick one to see exactly how Groundwork reads the
          ground, explains the numbers, and proposes what to do.
        </p>

        <div className="grid gap-5 md:grid-cols-3">
          {DEMO_SITES.map((site) => (
            <Link
              key={site.slug}
              href={`/site/${site.slug}`}
              prefetch={true}
              className="card group block p-0 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
            >
              {/* Top accent bar */}
              <div className="h-1.5 w-full bg-survey" />

              <div className="p-5">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="label">{site.category}</span>
                  <span className="inline-block border border-survey bg-survey px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-paper">
                    Live demo
                  </span>
                </div>

                <div className="font-display text-[19px] font-bold uppercase leading-tight">
                  {site.label}
                </div>
                <div className="mt-2 font-mono text-[12px] leading-snug text-stone">
                  {site.address}
                </div>

                <p className="mt-3 text-[15px] leading-snug text-ink/75">
                  {site.whyThisOne}
                </p>

                {/* Teaser CTA */}
                <div className="mt-4 pt-3 border-t border-rule flex items-center justify-between">
                  <span className="font-mono text-[11px] text-survey uppercase tracking-wide">
                    See the full analysis
                  </span>
                  <span className="font-mono text-[14px] text-ink group-hover:translate-x-1 transition-transform duration-200">
                    →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Sheet>

      {/* --- Trust & Credibility -------------------------------------------- */}
      <Sheet className="mt-16 mb-8">
        <div className="card-flat p-6">
          <div className="label mb-3">Built on honesty, not hype</div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Every number cited",
                desc: "Click any figure and see where it came from, what produced it, and what it cannot claim.",
              },
              {
                title: "Uncertainty named, not hidden",
                desc: "When we can't measure something, we say so - and we never tell you to act on it.",
              },
              {
                title: "No vanity metrics",
                desc: "Customers and dollars, not engagement scores. Units you staff and discount with.",
              },
              {
                title: "You approve before anything moves",
                desc: "Every spend, order, and public post stops at the approval gate. Alerts skip it - they're free.",
              },
            ].map((item) => (
              <div key={item.title} className="flex flex-col gap-1.5">
                <h3 className="font-display text-[14px] font-bold uppercase leading-tight">
                  {item.title}
                </h3>
                <p className="text-[14px] leading-snug text-ink/70">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Sheet>

      <Footer />
    </>
  );
}
