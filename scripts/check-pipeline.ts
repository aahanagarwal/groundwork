import { buildDashboard } from "@/lib/pipeline";
async function main() {
  const r = await buildDashboard("jos-coffee", "road-closure-dip");
  if (!r.ok) { console.log("REFUSED", r.refusal); return; }
  const d = r.data;
  console.log(`site: ${d.site.label} @ ${d.site.lat},${d.site.lng} approximate=${d.site.approximate}`);
  console.log(`trade area: ${d.tradeArea?.engine} ${d.tradeArea?.areaSqMi.toFixed(1)} sq mi vs ${d.tradeArea?.naiveAreaSqMi.toFixed(0)} circle`);
  console.log(`events kept: ${d.events.length}  (live weather: ${d.liveWeatherEvents.length})`);
  console.log(`ledger days: ${d.ledger.length}`);
  if (d.attribution) {
    const a = d.attribution;
    console.log(`\nATTRIBUTION ${a.windowStart}..${a.windowEnd}  ${a.deltaPct.toFixed(1)}%  confidence ${a.confidence}`);
    for (const dr of a.drivers) console.log(`   ${dr.label.slice(0,50).padEnd(52)} ${dr.points.toFixed(1).padStart(6)} pts [${dr.pointsLow.toFixed(1)}..${dr.pointsHigh.toFixed(1)}]`);
    console.log(`   ${"unexplained".padEnd(52)} ${a.unexplainedPoints.toFixed(1).padStart(6)} pts`);
  }
  console.log("\nSTAGES");
  for (const s of d.stages) console.log(`  ${s.ok ? "ok  " : "REFUSED"} ${s.stage.padEnd(14)} ${s.note ?? s.refusal?.message ?? ""}`);
}
void main();
