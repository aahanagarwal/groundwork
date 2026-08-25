/**
 * Phase 1 gate check.
 *
 * Builds the 8-minute trade area for the three seeded Austin addresses and
 * reports whether the result is a plausible drive shed or a circle in
 * disguise. Runs against the local OSRM graph so it costs nothing and can be
 * re-run freely; the same builder runs against Mireye once a key is present,
 * and Phase 4 compares the two by IoU.
 *
 *   npx tsx scripts/check-isochrone.ts
 */

import { buildIsochrone } from "@/lib/isochrone/builder";
import { osrmProbe } from "@/lib/isochrone/probes";
import { circleRing, starPolygonIoU, type LatLng } from "@/lib/geo";
import { TRADE_AREA_MINUTES, NAIVE_RADIUS_MILES } from "@/lib/config";

/** Approximate rooftop coordinates. Mireye /v1/lookup replaces these with
 *  parcel-grade ones the moment a key is available. */
const SITES: Array<{ slug: string; label: string; at: LatLng }> = [
  { slug: "jos-coffee", label: "Jo's Coffee, 1300 S Congress", at: { lat: 30.2515, lng: -97.7494 } },
  { slug: "radio-coffee", label: "Radio Coffee & Beer, 4204 Menchaca", at: { lat: 30.2265, lng: -97.7935 } },
  { slug: "franklin-barbecue", label: "Franklin Barbecue, 900 E 11th", at: { lat: 30.2701, lng: -97.7313 } },
];

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

async function main() {
for (const site of SITES) {
  const result = await buildIsochrone(
    site.at,
    TRADE_AREA_MINUTES,
    osrmProbe(),
    { naiveRadiusMiles: NAIVE_RADIUS_MILES, engineLabel: "local OSRM (Austin extract)" },
  );

  console.log(`\n${"=".repeat(78)}`);
  console.log(site.label);

  if (!result.ok) {
    console.log(`REFUSED  ${result.refusal.code}: ${result.refusal.message}`);
    if (result.refusal.hint) console.log(`   hint: ${result.refusal.hint}`);
    continue;
  }

  const iso = result.data;
  const radii = iso.bearings.map((b) => b.boundaryDistanceMi);
  const min = Math.min(...radii);
  const max = Math.max(...radii);
  const mean = radii.reduce((s, v) => s + v, 0) / radii.length;

  console.log(
    `area ${iso.areaSqMi.toFixed(2)} sq mi   vs naive ${NAIVE_RADIUS_MILES}-mile circle ${iso.naiveAreaSqMi.toFixed(1)} sq mi` +
      `   (${((1 - iso.areaSqMi / iso.naiveAreaSqMi) * 100).toFixed(1)}% smaller)`,
  );
  console.log(
    `reach by bearing: min ${min.toFixed(2)} mi, max ${max.toFixed(2)} mi, mean ${mean.toFixed(2)} mi` +
      `   anisotropy ${(max / Math.max(min, 0.01)).toFixed(1)}x`,
  );
  console.log(
    `boundary accuracy: mean |measured − ${TRADE_AREA_MINUTES}min| = ${iso.accuracy.meanErrorMinutes.toFixed(2)} min, ` +
      `worst ${iso.accuracy.maxErrorMinutes.toFixed(2)} min across ${iso.accuracy.refinedBearings} refined bearings`,
  );
  console.log(`probes ${iso.probesTested}   paid driving calcs ${iso.paidDrivingCalcs}`);
  console.log("-".repeat(78));

  iso.bearings.forEach((b, i) => {
    const bar = "#".repeat(Math.round(b.boundaryDistanceMi * 8));
    console.log(
      `  ${COMPASS[i % 16].padEnd(4)} ${b.boundaryDistanceMi.toFixed(2).padStart(5)} mi ` +
        `${bar.padEnd(34)} ${b.flag}` +
        (b.measuredMinutesAtBoundary !== null
          ? `  measured ${b.measuredMinutesAtBoundary.toFixed(1)}min`
          : ""),
    );
  });

  // How circle-like is this really? IoU against the equal-area circle centred
  // on the same site. 1.000 would mean we drew a circle and learned nothing.
  const equalAreaRadiusMi = Math.sqrt(iso.areaSqMi / Math.PI);
  const vsCircle = starPolygonIoU(
    iso.geojson.coordinates[0],
    circleRing(site.at, equalAreaRadiusMi),
    site.at,
  );
  console.log(
    `\n  circle test: IoU vs the equal-area circle = ${vsCircle.iou.toFixed(3)}` +
      `   (1.000 would mean we drew a circle and learned nothing)`,
  );
}
}

await_main();
function await_main() { void main(); }
