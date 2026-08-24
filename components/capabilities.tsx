import type { Insight } from "@/lib/insight";
import type {
  SiteRecord,
  TradeAreaRecord,
  WorldEventRecord,
} from "@/lib/domain";

/**
 * WHAT GROUNDWORK CAN TELL YOU
 *
 * A plain answer to "what does this thing actually do for me", phrased as the
 * questions an owner would ask out loud rather than as feature names.
 *
 * Each card carries a live answer where we have one, so the section is a
 * working index into the page rather than a brochure. Where we cannot answer
 * yet, it says so and says why — a capability list that quietly omits its own
 * gaps is a sales page, and this product's entire argument is that it doesn't
 * do that.
 */

export type CapabilityStatus = "answering" | "needs_key" | "v2";

const STATUS_STYLE: Record<
  CapabilityStatus,
  { label: string; className: string }
> = {
  answering: {
    label: "Answering now",
    className: "border-survey bg-survey text-paper",
  },
  needs_key: { label: "Needs a key", className: "border-stone text-stone" },
  v2: { label: "Not yet", className: "border-stone text-stone" },
};

export function Capabilities({
  insight,
  site,
  tradeArea,
  events,
  hasMireyeKey,
}: {
  insight: Insight | null;
  site: SiteRecord;
  tradeArea: TradeAreaRecord | null;
  events: WorldEventRecord[];
  hasMireyeKey: boolean;
}) {
  const threats = events.filter(
    (e) => e.kind === "competitor_open" || e.kind === "road_closure",
  );

  const cards: Array<{
    question: string;
    answer: string;
    status: CapabilityStatus;
  }> = [
    {
      question: "Was that me, or was that the street?",
      answer: insight
        ? insight.verdictLine
        : "Needs till data for this address before it can answer.",
      status: insight ? "answering" : "v2",
    },
    {
      question: "Who can actually reach me?",
      answer: tradeArea
        ? `${tradeArea.areaSqMi.toFixed(1)} square miles inside an ${tradeArea.minutes}-minute drive — not the ${tradeArea.naiveAreaSqMi.toFixed(0)} square miles a ${tradeArea.naiveRadiusMiles}-mile circle would sell you. The difference is ${((1 - tradeArea.areaSqMi / tradeArea.naiveAreaSqMi) * 100).toFixed(0)}% of any radius-targeted budget.`
        : "No trade area drawn for this address yet.",
      status: tradeArea ? "answering" : "v2",
    },
    {
      question: "Where is my ad money going to waste?",
      answer: tradeArea
        ? "Any spend aimed outside the drive area, plus anything aimed at a side of it a closure has cut off. The proposal below shows the amount and the exact polygon to target instead."
        : "Needs a trade area first.",
      status: tradeArea ? "answering" : "v2",
    },
    {
      question: "What's about to happen to me?",
      answer:
        threats.length > 0
          ? `${threats.length} thing${threats.length === 1 ? "" : "s"} being watched inside your trade area right now, including ${threats[0].label.toLowerCase()}.`
          : "Nothing filed inside your trade area right now. Permits and closures are checked against the polygon, not the postcode.",
      status: "answering",
    },
    {
      question: "What can't you explain?",
      answer: insight
        ? `${Math.round(insight.unknownShare * 100)}% of this period's movement — about ${Math.abs(Math.round(insight.unexplainedCustomers))} customers. We name it rather than folding it into a driver, and ask you what it was.`
        : "Nothing to explain yet.",
      status: insight ? "answering" : "v2",
    },
    {
      question: "Is this really my parcel?",
      answer: hasMireyeKey
        ? `Resolved to a parcel via ${site.matchMethod ?? "Mireye"}, with the boundary drawn on the map. A weak match is refused rather than guessed.`
        : "Running on a hand-checked approximate coordinate — no Mireye key is set, so this is not a parcel match and the header says so.",
      status: hasMireyeKey ? "answering" : "needs_key",
    },
    {
      question: "How many people live within a drive of me?",
      answer:
        "Mireye can total the civilian labour force and population inside a drive-time shed. Not wired into this build yet — it is a separate paid call and the polygon was the priority.",
      status: "v2",
    },
    {
      question: "Should I open a second site here?",
      answer:
        "The same engine scores a candidate address, but the placement module was deliberately cut to build advertising and threat watch properly instead.",
      status: "v2",
    },
  ];

  return (
    <section className="card-flat p-5">
      <div className="label mb-1">What Groundwork can tell you</div>
      <p className="mb-4 max-w-[66ch] text-[15px] leading-snug">
        The questions this answers, in the words an owner would use. Where it
        can&rsquo;t answer yet, it says so — a capability list that hides its
        own gaps is a brochure.
      </p>

      <div className="grid gap-px bg-rule sm:grid-cols-2">
        {cards.map((card) => {
          const style = STATUS_STYLE[card.status];
          return (
            <div key={card.question} className="bg-limestone p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15.5px] font-semibold leading-snug">
                  &ldquo;{card.question}&rdquo;
                </h3>
                <span
                  className={`shrink-0 border px-1.5 py-px font-mono text-[9.5px] uppercase tracking-[0.12em] ${style.className}`}>
                  {style.label}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] leading-snug text-ink/75">
                {card.answer}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
