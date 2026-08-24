import Link from "next/link";
import { Sheet, MetaRow, Footer, Label } from "@/components/chrome";
import { DEMO_SITES } from "@/lib/demo-sites";
import { TRADE_AREA_MINUTES, NAIVE_RADIUS_MILES } from "@/lib/config";

export default function Home() {
  return (
    <>
      <Sheet>
        <div className="flex flex-wrap gap-4 pt-14 font-mono text-[12px] uppercase tracking-[0.22em] text-survey">
          <span>Concept demo</span>
          <span>Austin, TX</span>
          <span>Food &amp; beverage</span>
        </div>

        <h1 className="mt-4 text-[clamp(46px,8.4vw,104px)] uppercase leading-[0.98] tracking-[-0.03em]">
          Ground&shy;work
        </h1>

        <p className="mt-3 max-w-[22ch] font-display text-[clamp(19px,2.6vw,30px)] font-medium leading-tight">
          The consultant that lives at the address.
        </p>

        <p className="mt-7 max-w-[60ch] text-[21px] leading-[1.45]">
          An autonomous business consultant that explains and steers a local
          business&rsquo;s revenue using the physical facts of its address. It
          joins the ground, the ledger and the world on one parcel key and one
          date, and answers the question every owner asks and no software
          answers:{" "}
          <em className="text-survey">was that me, or was that the street?</em>
        </p>

        <div className="mt-10">
          <MetaRow
            items={[
              { label: "Trade area", value: `${TRADE_AREA_MINUTES}-min drive` },
              {
                label: "Compared against",
                value: `${NAIVE_RADIUS_MILES}-mile radius`,
              },
              { label: "Ground layer", value: "Mireye Earth — live" },
              { label: "Ledger + world", value: "Fixtures — editable" },
            ]}
          />
        </div>
      </Sheet>

      <Sheet className="mt-16">
        <Label>Pick an address</Label>
        <p className="mb-6 max-w-[62ch]">
          Three real Austin food-and-beverage addresses, pre-seeded so you
          don&rsquo;t have to type coordinates. Each resolves through Mireye to
          a real parcel. A free-text address works too, and is refused rather
          than guessed if Mireye can&rsquo;t confidently match it.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          {DEMO_SITES.map((site) => (
            <Link
              key={site.slug}
              href={`/site/${site.slug}`}
              className="card block p-5 transition-colors hover:bg-limestone">
              <div className="label mb-2">{site.category}</div>
              <div className="font-display text-[19px] font-bold uppercase leading-tight">
                {site.label}
              </div>
              <div className="mt-2 font-mono text-[12.5px] leading-snug text-survey">
                {site.address}
              </div>
              <p className="mt-3 text-[15px] leading-snug">{site.whyThisOne}</p>
            </Link>
          ))}
        </div>
      </Sheet>

      <Sheet className="mt-14">
        <div className="card-flat p-5">
          <Label>What this build does not claim</Label>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15.5px]">
            <li>
              No causality from one location. Every attribution says
              &ldquo;consistent with&rdquo;, shows its band, and names the
              unexplained share.
            </li>
            <li>
              No foot-traffic data. None is purchased and none is modelled.
            </li>
            <li>
              No coverage claimed outside Austin, TX — permits and closures are
              per-jurisdiction.
            </li>
            <li>
              No money moves. Campaigns, orders and briefs render as drafts; the
              act layer is simulated.
            </li>
          </ul>
        </div>
      </Sheet>

      <Footer />
    </>
  );
}
