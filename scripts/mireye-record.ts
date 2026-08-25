/**
 * Live Mireye run: resolve the seeded addresses for real, then build their
 * trade areas from real drive times.
 *
 * Everything is recorded to data/fixtures/mireye/, so this is paid for once
 * and the demo replays it forever afterwards - offline, and free.
 *
 *   npx tsx scripts/mireye-record.ts resolve          # cheap: lookup + fields
 *   npx tsx scripts/mireye-record.ts isochrone <slug> # ~960 credits each
 *   npx tsx scripts/mireye-record.ts iou              # compare vs local OSRM
 */

import { DEMO_SITES } from "@/lib/demo-sites";
import { resolveSite } from "@/lib/resolver";
import { buildIsochrone } from "@/lib/isochrone/builder";
import { mireyeProbe, osrmProbe } from "@/lib/isochrone/probes";
import { tradeAreas, sites, type TradeAreaRecord } from "@/lib/domain";
import { TRADE_AREA_MINUTES, NAIVE_RADIUS_MILES, config } from "@/lib/config";
import { starPolygonIoU } from "@/lib/geo";
import { readAll } from "@/lib/telemetry/ledger";

const mode = process.argv[2] ?? "resolve";
const only = process.argv[3];

function creditsSpentSince(mark: number): number {
  return readAll()
    .slice(mark)
    .reduce((s, e) => s + (e.creditsActual ?? e.creditsEstimated ?? 0), 0);
}

async function doResolve() {
  console.log("Resolving addresses through the real Mireye API...\n");
  for (const site of DEMO_SITES) {
    const before = readAll().length;
    const result = await resolveSite(site.slug, { force: true });
    const spent = creditsSpentSince(before);

    if (!result.ok) {
      console.log(`✗ ${site.label}\n    REFUSED ${result.refusal.code}: ${result.refusal.message}`);
      if (result.refusal.hint) console.log(`    hint: ${result.refusal.hint}`);
      continue;
    }

    const s = result.data;
    console.log(`✓ ${site.label}   (${spent} credits)`);
    console.log(`    ${s.resolvedAddress}`);
    console.log(`    ${s.lat}, ${s.lng}   confidence ${s.confidence ?? "-"}   ${s.matchMethod ?? ""}`);
    console.log(`    ${s.county ?? "?"} · tract ${s.tractGeoid ?? "?"} · ${s.cbsaName ?? "?"}`);
    console.log(`    flood zone ${s.femaFloodZone ?? "-"} · elevation ${s.elevationM ?? "-"}m · ${s.timezone ?? "-"}`);
    console.log(`    parcel ${s.parcelId ?? "none"}${s.parcelAreaM2 ? ` · ${Math.round(s.parcelAreaM2).toLocaleString()} m²` : ""}${s.parcelZoning ? ` · zoning ${s.parcelZoning}` : ""}`);
    console.log(`    boundary geometry: ${s.parcelGeoJson ? "yes" : "no"}   approximate: ${s.approximate}`);
    if (s.countyMarket) {
      const m = s.countyMarket;
      console.log(`    county market: pop ${m.population?.toLocaleString() ?? "?"} · income $${m.median_household_income_usd?.toLocaleString() ?? "?"} · employment ${m.employment_yoy_pct ?? "?"}% YoY`);
    }
    const fields = s.siteFields ? Object.keys(s.siteFields).length : 0;
    console.log(`    site fields returned: ${fields}`);
    console.log();
  }
}

async function doIsochrone(slug: string) {
  const site = sites.find((s) => s.slug === slug);
  if (!site?.lat || !site?.lng) {
    console.log(`No resolved coordinate for "${slug}". Run the resolve step first.`);
    return;
  }

  console.log(`Building the ${TRADE_AREA_MINUTES}-minute trade area for ${site.label} from real Mireye drive times.`);
  console.log("80 probes over two passes. Estimated ~960 credits.\n");

  const before = readAll().length;
  const started = Date.now();
  const result = await buildIsochrone(
    { lat: site.lat, lng: site.lng },
    TRADE_AREA_MINUTES,
    mireyeProbe("isochrone", site.id),
    { naiveRadiusMiles: NAIVE_RADIUS_MILES, engineLabel: "Mireye /v1/proximity (op: screen)" },
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.ok) {
    console.log(`REFUSED ${result.refusal.code}: ${result.refusal.message}`);
    if (result.refusal.hint) console.log(`hint: ${result.refusal.hint}`);
    return;
  }

  const iso = result.data;
  const spent = creditsSpentSince(before);

  const record: TradeAreaRecord = {
    id: `${site.id}-${iso.minutes}-mireye`,
    siteId: site.id,
    minutes: iso.minutes,
    mode: "driving",
    engine: "mireye",
    polygonGeoJson: iso.geojson,
    naiveCircleGeoJson: iso.naiveCircle,
    naiveRadiusMiles: iso.naiveRadiusMiles,
    areaSqMi: iso.areaSqMi,
    naiveAreaSqMi: iso.naiveAreaSqMi,
    method: iso.method,
    bearings: iso.bearings.length,
    probesTested: iso.probesTested,
    paidDrivingCalcs: iso.paidDrivingCalcs,
    creditsEstimated: 960,
    creditsActual: spent,
    accuracyMeanErrorMinutes: iso.accuracy.meanErrorMinutes,
    accuracyMaxErrorMinutes: iso.accuracy.maxErrorMinutes,
    laborForce: null,
    population: null,
    naivePopulation: null,
    detail: iso.bearings,
    provenance: result.provenance,
    computedAt: new Date().toISOString(),
  };
  tradeAreas.put(record);

  console.log(`✓ ${site.label} - ${elapsed}s`);
  console.log(`    area ${iso.areaSqMi.toFixed(2)} mi² vs ${iso.naiveAreaSqMi.toFixed(0)} mi² circle (${((1 - iso.areaSqMi / iso.naiveAreaSqMi) * 100).toFixed(0)}% smaller)`);
  console.log(`    paid driving calcs: ${iso.paidDrivingCalcs}`);
  console.log(`    CREDITS  estimated 960  ·  actual ${spent}  ·  delta ${spent - 960 >= 0 ? "+" : ""}${spent - 960}`);
  console.log(`    boundary accuracy: mean ±${iso.accuracy.meanErrorMinutes.toFixed(2)} min, worst ±${iso.accuracy.maxErrorMinutes.toFixed(2)} min`);
  const radii = iso.bearings.map((b) => b.boundaryDistanceMi);
  console.log(`    reach: ${Math.min(...radii).toFixed(2)}–${Math.max(...radii).toFixed(2)} mi  (anisotropy ${(Math.max(...radii) / Math.max(Math.min(...radii), 0.01)).toFixed(1)}x)`);
  for (const note of iso.notes.slice(0, 3)) console.log(`    note: ${note}`);
}

async function doIou() {
  console.log("PHASE 4 VALIDATION - local OSRM counterfactual vs the Mireye-derived polygon.\n");
  console.log("Same builder, same probe grid, same interpolation on both sides, so any");
  console.log("difference is the road-network model, not the algorithm.\n");

  for (const site of sites.all()) {
    const mine = tradeAreas.find((t) => t.siteId === site.id && t.engine === "mireye");
    if (!mine || !site.lat || !site.lng) continue;

    let osrm = tradeAreas.find((t) => t.siteId === site.id && t.engine === "osrm");
    if (!osrm) {
      const built = await buildIsochrone(
        { lat: site.lat, lng: site.lng },
        TRADE_AREA_MINUTES,
        osrmProbe(),
        { naiveRadiusMiles: NAIVE_RADIUS_MILES, engineLabel: "local OSRM (Austin extract)" },
      );
      if (!built.ok) {
        console.log(`${site.label}: local router unavailable (${built.refusal.code})`);
        continue;
      }
      osrm = { ...mine, id: `${site.id}-8-osrm`, engine: "osrm", polygonGeoJson: built.data.geojson, areaSqMi: built.data.areaSqMi } as TradeAreaRecord;
      tradeAreas.put(osrm);
    }

    const cmp = starPolygonIoU(
      mine.polygonGeoJson.coordinates[0],
      osrm.polygonGeoJson.coordinates[0],
      { lat: site.lat, lng: site.lng },
    );
    console.log(`${site.label}`);
    console.log(`    Mireye ${mine.areaSqMi.toFixed(2)} mi²   OSRM ${osrm.areaSqMi.toFixed(2)} mi²`);
    console.log(`    IoU ${cmp.iou.toFixed(3)}   (intersection ${cmp.intersectionSqMi.toFixed(2)} / union ${cmp.unionSqMi.toFixed(2)} mi²)\n`);
  }
}

async function main() {
  if (!config.mireye.apiKey) {
    console.log("No MIREYE_API_KEY in .env - nothing to record.");
    return;
  }
  if (mode === "resolve") await doResolve();
  else if (mode === "isochrone") {
    for (const s of only ? [only] : DEMO_SITES.map((d) => d.slug)) await doIsochrone(s);
  } else if (mode === "iou") await doIou();
  else console.log(`Unknown mode "${mode}". Use resolve | isochrone | iou.`);
}
void main();
