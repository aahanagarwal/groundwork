/**
 * Phase 3 gate check: real weather, real normals, derived drivers.
 *   npx tsx scripts/check-weather.ts
 */
import { fetchObserved, fetchNormals, scoreAnomalies } from "@/lib/world/weather";
import { deriveWeatherEvents } from "@/lib/world/derive-events";
import { DEMO_SITES } from "@/lib/demo-sites";

async function main() {
  const site = DEMO_SITES[0];
  const at = site.fallbackAt;

  console.log(`Austin - ${site.label} @ ${at.lat},${at.lng}`);
  console.log("Fetching 1991-2020 normals (first run downloads ~11k days, then caches)...");

  const normals = await fetchNormals(at);
  if (!normals.ok) { console.log("REFUSED:", normals.refusal); return; }
  console.log(`normals: ${Object.keys(normals.data.byDayOfYear).length} calendar days, ${normals.data.yearsCovered} years`);
  const jul09 = normals.data.byDayOfYear["07-09"];
  console.log(`  9 July normal: apparent max ${jul09.apparentMaxMean.toFixed(1)}C (sd ${jul09.apparentMaxSd.toFixed(1)}), precip ${jul09.precipMean.toFixed(2)}mm`);

  const observed = await fetchObserved(at, "2026-05-19", "2026-08-16");
  if (!observed.ok) { console.log("REFUSED:", observed.refusal); return; }
  console.log(`observed: ${observed.data.length} days  [${observed.provenance.source}]`);

  const scored = scoreAnomalies(observed.data, normals.data);
  const events = deriveWeatherEvents(scored, "jos-coffee", "live");

  console.log(`\nDerived ${events.length} weather drivers from real data:`);
  for (const e of events) {
    console.log(`  ${e.startDate}${e.endDate !== e.startDate ? ` -> ${e.endDate}` : "          "}  ${e.kind.padEnd(5)} mag ${e.magnitude.toFixed(2)}  ${e.label}`);
  }

  const hottest = [...scored].sort((a,b) => (b.heatZ ?? -99) - (a.heatZ ?? -99))[0];
  console.log(`\nhottest vs normal: ${hottest.date}  ${hottest.apparentMaxC}C vs normal ${hottest.normalApparentMaxC?.toFixed(1)}C  = +${hottest.heatAnomalyC?.toFixed(1)}C (${hottest.heatZ?.toFixed(2)} SD)`);
  const wettest = [...scored].sort((a,b) => (b.precipitationMm ?? 0) - (a.precipitationMm ?? 0))[0];
  console.log(`wettest:            ${wettest.date}  ${wettest.precipitationMm}mm vs normal ${wettest.normalPrecipitationMm?.toFixed(2)}mm`);
}
void main();
