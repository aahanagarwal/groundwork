/**
 * Measure road distances from each demo site to every driver that carries a
 * coordinate, and persist them.
 *
 * Separate from a page load on purpose. Drive times are a ground-layer fact -
 * bought once, kept forever - and the pipeline will not re-buy one that is
 * already recorded. When a measurement needs redoing (a failed batch, a moved
 * fixture, a new address), this is the deliberate way to ask for it, with the
 * price printed before anything is spent.
 *
 *   npm run mireye:drivetimes          # fill in whatever is missing
 *   npm run mireye:drivetimes -- --force   # re-measure everything
 */
import { buildDashboard, ensureDriveTimes } from "@/lib/pipeline";
import { DEMO_SITES } from "@/lib/demo-sites";
import { allStates } from "@/lib/mireye/budget";
import { config } from "@/lib/config";
import type { DashboardStageStatus } from "@/lib/pipeline";

const force = process.argv.includes("--force");
const scenario = config.demo.defaultScenario;

async function main() {
  if (!config.mireye.apiKey) {
    console.error("MIREYE_API_KEY is not set - nothing to measure against.");
    process.exit(1);
  }

  const before = allStates().find((s) => s.agent === "world_ingest")!;
  console.log(
    `world_ingest budget: ${before.spent} / ${before.ceiling} spent, ${before.remaining} remaining\n`,
  );

  for (const site of DEMO_SITES) {
    const dash = await buildDashboard(site.slug, scenario);
    if (!dash.ok) {
      console.log(`${site.slug}: refused - ${dash.refusal.message}`);
      continue;
    }
    const { site: record, events, discardedEvents } = dash.data;
    const all = [...events, ...discardedEvents];
    const stages: DashboardStageStatus[] = [];
    await ensureDriveTimes(record, all, stages, { force });

    const geo = all.filter((e) => e.meta?.["at"]);
    const routed = geo.filter((e) => e.driveTime?.method === "mireye_distance");
    console.log(`${site.slug}: ${routed.length}/${geo.length} routed`);
    for (const stage of stages) {
      console.log(`   ${stage.ok ? "ok" : "refused"} - ${stage.note ?? stage.refusal?.message}`);
    }
    for (const e of geo) {
      const d = e.driveTime;
      const shown =
        d?.method === "mireye_distance"
          ? `${d.minutes?.toFixed(1)} min · ${d.miles} mi by road`
          : `${d?.miles?.toFixed(2)} mi straight-line (not routed)`;
      console.log(`     ${e.label.slice(0, 40).padEnd(42)} ${shown}`);
    }
  }

  const after = allStates().find((s) => s.agent === "world_ingest")!;
  console.log(
    `\nworld_ingest budget: ${after.spent} / ${after.ceiling} spent (${after.spent - before.spent} this run)`,
  );
}

main();
