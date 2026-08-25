import type { SourceResult } from "@/lib/datasource";
import { ok, refuse } from "@/lib/datasource";
import {
  circleRing,
  destinationPoint,
  METERS_PER_MILE,
  polygon,
  ringAreaSqMi,
  type LatLng,
} from "@/lib/geo";

/**
 * THE ISOCHRONE BUILDER
 *
 * Mireye has no isochrone endpoint. Confirmed against the live OpenAPI spec
 * (api.mireye.com/v1/openapi.json, Mireye Earth 0.15.0): the four
 * /v1/proximity ops return legs, rankings, screen verdicts and labor-shed
 * scalars. `labor_shed` comes closest - it knows which census tracts sit
 * inside a drive shed - but returns only summed counts, never the tract ids or
 * their geometry. Nothing in the API returns a polygon.
 *
 * So we build one, from real drive times, and label it derived everywhere.
 *
 * ── Method: two passes, 80 probes ────────────────────────────────────────
 *
 *   Pass 1 (bracket). Probe points on 16 compass bearings at 4 radii each.
 *   Against Mireye this is one `op: "screen"` call with the parcel as the sole
 *   anchor. `screen` is the right op precisely because it does not discard
 *   failures: every non-survivor comes back in `screened_out` carrying its own
 *   best duration. One call therefore yields a full distance→drive-time curve
 *   along all 16 bearings, not a yes/no.
 *
 *   Interpolate. Along each bearing, take the OUTERMOST probe still inside the
 *   time budget and the next one past it, and linearly interpolate the
 *   distance at which drive time crosses the target.
 *
 *   Pass 2 (refine and self-check). One probe per bearing at exactly that
 *   interpolated distance. The boundary becomes measured rather than inferred,
 *   and the gap between the predicted 8.0 minutes and the drive time actually
 *   measured there is a reported error figure. The polygon carries its own
 *   accuracy number.
 *
 * ── Why the probe is pluggable ───────────────────────────────────────────
 *
 * The same algorithm runs against Mireye (`mireyeProbe`) and against the local
 * OSRM graph (`osrmProbe`). That is what makes the Phase 4 IoU meaningful: two
 * polygons built by one algorithm over two different routing engines differ
 * only because the engines disagree about the road network - not because one
 * side used a smarter shape-fitting trick. Comparing a vendor isochrone to a
 * home-made one would measure the algorithms; this measures the geography.
 */

export const DEFAULT_BEARINGS = 16;

/**
 * Bracketing radii in miles: spread to straddle a plausible urban 8-minute
 * drive from a dense-grid worst case to an arterial best case.
 */
export const DEFAULT_COARSE_RADII_MI = [0.4, 1.2, 2.4, 4.0];

/**
 * One round of "how long does it take to drive from the site to each of these
 * points". Implemented by Mireye and by local OSRM; the builder does not care
 * which, and cannot tell.
 */
export type DurationProbe = (
  origin: LatLng,
  targets: LatLng[],
  maxMinutes: number,
) => Promise<
  SourceResult<{
    /** Index-aligned with `targets`. null = no route found. */
    durationsMinutes: (number | null)[];
    /** What the engine charged for, where it says. */
    paidDrivingCalcs?: number;
    notes?: string[];
  }>
>;

export interface BearingSample {
  distanceMi: number;
  durationMinutes: number | null;
  pass: 1 | 2;
}

export type BearingFlag =
  | "interpolated"
  | "refined"
  /** Every probe on this bearing was inside the budget - the true edge is
   *  further out than we probed, so this bearing is clipped short. */
  | "truncated_outward"
  /** Even the innermost probe was over budget. Boundary pinned near the site. */
  | "clipped_inward"
  /** No probe on this bearing produced a drive time at all - water, private
   *  road, no route. Drawn at the innermost radius, and said out loud. */
  | "unreachable";

export interface BearingResult {
  bearingDeg: number;
  boundaryDistanceMi: number;
  flag: BearingFlag;
  samples: BearingSample[];
  measuredMinutesAtBoundary: number | null;
  /** |measured − target| at the point we actually drew. The self-check. */
  errorMinutes: number | null;
}

export interface IsochroneResult {
  minutes: number;
  origin: LatLng;
  geojson: GeoJSON.Polygon;
  naiveCircle: GeoJSON.Polygon;
  naiveRadiusMiles: number;

  areaSqMi: number;
  naiveAreaSqMi: number;

  bearings: BearingResult[];
  probesTested: number;
  paidDrivingCalcs: number;

  accuracy: {
    meanErrorMinutes: number;
    maxErrorMinutes: number;
    refinedBearings: number;
  };

  method: string;
  notes: string[];
}

export interface BuildOptions {
  bearings?: number;
  coarseRadiiMi?: number[];
  naiveRadiusMiles?: number;
  /** Skip pass 2 to halve the probe count when credits are tight. */
  refine?: boolean;
  /** Named in `method`, so a polygon always says what drew it. */
  engineLabel?: string;
}

export async function buildIsochrone(
  origin: LatLng,
  minutes: number,
  probe: DurationProbe,
  options: BuildOptions = {},
): Promise<SourceResult<IsochroneResult>> {
  const bearingCount = options.bearings ?? DEFAULT_BEARINGS;
  const coarseRadii = options.coarseRadiiMi ?? DEFAULT_COARSE_RADII_MI;
  const naiveRadiusMiles = options.naiveRadiusMiles ?? 5;
  const refine = options.refine ?? true;
  const engineLabel = options.engineLabel ?? "routing engine";

  const bearingDegs = Array.from(
    { length: bearingCount },
    (_, i) => (i * 360) / bearingCount,
  );

  // --- Pass 1: bracket ------------------------------------------------------
  const coarseProbes: Array<{ bearingIdx: number; distanceMi: number; point: LatLng }> = [];
  for (let b = 0; b < bearingCount; b++) {
    for (const r of coarseRadii) {
      coarseProbes.push({
        bearingIdx: b,
        distanceMi: r,
        point: destinationPoint(origin, bearingDegs[b], r * METERS_PER_MILE),
      });
    }
  }

  const pass1 = await probe(
    origin,
    coarseProbes.map((p) => p.point),
    minutes,
  );
  if (!pass1.ok) {
    return refuse({
      ...pass1.refusal,
      message: `Trade area bracketing pass failed: ${pass1.refusal.message}`,
    });
  }

  const samplesByBearing: BearingSample[][] = Array.from(
    { length: bearingCount },
    () => [],
  );
  coarseProbes.forEach((probePoint, i) => {
    samplesByBearing[probePoint.bearingIdx].push({
      distanceMi: probePoint.distanceMi,
      durationMinutes: pass1.data.durationsMinutes[i] ?? null,
      pass: 1,
    });
  });

  const bearings: BearingResult[] = bearingDegs.map((deg, b) => {
    const samples = [...samplesByBearing[b]].sort((x, y) => x.distanceMi - y.distanceMi);
    const { distanceMi, flag } = interpolateBoundary(samples, minutes);
    return {
      bearingDeg: deg,
      boundaryDistanceMi: distanceMi,
      flag,
      samples,
      measuredMinutesAtBoundary: null,
      errorMinutes: null,
    };
  });

  let paidDrivingCalcs = pass1.data.paidDrivingCalcs ?? coarseProbes.length;
  let probesTested = coarseProbes.length;
  const notes = [...(pass1.data.notes ?? [])];

  // --- Pass 2: refine and self-check ---------------------------------------
  if (refine) {
    // Two kinds of bearing earn a second probe, and they get different targets:
    //   interpolated       - probe AT the interpolated boundary, to measure it.
    //   truncated_outward  - every bracketing probe came back inside the
    //                        budget, so the real edge is beyond our outermost
    //                        ring. Extrapolate outward and probe there, rather
    //                        than silently clipping the shed at 4 miles.
    const refinable = bearings.filter(
      (br) =>
        (br.flag === "interpolated" || br.flag === "truncated_outward") &&
        br.boundaryDistanceMi > 0,
    );

    if (refinable.length > 0) {
      const pass2Targets = refinable.map((br) => {
        if (br.flag !== "truncated_outward") return br.boundaryDistanceMi;
        const outer = br.samples
          .filter((s) => s.durationMinutes !== null)
          .at(-1) as BearingSample & { durationMinutes: number };
        // Distance scales roughly with time along an open corridor. Capped at
        // 2.5x so one freeway bearing can't throw the probe into the next county.
        const scaled = outer.distanceMi * (minutes / Math.max(outer.durationMinutes, 0.5));
        return Math.min(scaled, outer.distanceMi * 2.5);
      });

      const pass2 = await probe(
        origin,
        refinable.map((br, i) =>
          destinationPoint(origin, br.bearingDeg, pass2Targets[i] * METERS_PER_MILE),
        ),
        minutes,
      );

      if (pass2.ok) {
        refinable.forEach((br, i) => {
          const measured = pass2.data.durationsMinutes[i] ?? null;
          br.samples.push({
            distanceMi: pass2Targets[i],
            durationMinutes: measured,
            pass: 2,
          });
          br.measuredMinutesAtBoundary = measured;
          br.errorMinutes = measured === null ? null : Math.abs(measured - minutes);
          br.flag = "refined";
          br.boundaryDistanceMi = pass2Targets[i];

          // The measurement supersedes the estimate: re-interpolate with the
          // extra point, which is by construction the closest sample to the
          // crossing we have.
          const resorted = [...br.samples].sort((x, y) => x.distanceMi - y.distanceMi);
          const { distanceMi } = interpolateBoundary(resorted, minutes);
          if (distanceMi > 0) br.boundaryDistanceMi = distanceMi;
        });

        paidDrivingCalcs += pass2.data.paidDrivingCalcs ?? refinable.length;
        probesTested += refinable.length;
        notes.push(...(pass2.data.notes ?? []));
      } else {
        // A failed refinement is not fatal. We still have a bracketed polygon;
        // say it is interpolated rather than throwing the whole thing away.
        notes.push(
          `Refinement pass failed (${pass2.refusal.code}); boundary is interpolated, not measured.`,
        );
      }
    }
  }

  // --- Assemble -------------------------------------------------------------
  const ring = bearings.map((br) => {
    const p = destinationPoint(origin, br.bearingDeg, br.boundaryDistanceMi * METERS_PER_MILE);
    return [p.lng, p.lat];
  });
  ring.push(ring[0]);

  const naiveRing = circleRing(origin, naiveRadiusMiles);
  const errors = bearings
    .map((b) => b.errorMinutes)
    .filter((e): e is number => e !== null);

  return ok(
    {
      minutes,
      origin,
      geojson: polygon(ring),
      naiveCircle: polygon(naiveRing),
      naiveRadiusMiles,
      areaSqMi: ringAreaSqMi(ring),
      naiveAreaSqMi: ringAreaSqMi(naiveRing),
      bearings,
      probesTested,
      paidDrivingCalcs,
      accuracy: {
        meanErrorMinutes:
          errors.length > 0 ? errors.reduce((s, v) => s + v, 0) / errors.length : 0,
        maxErrorMinutes: errors.length > 0 ? Math.max(...errors) : 0,
        refinedBearings: errors.length,
      },
      method:
        `Derived, not vendor-supplied. ${bearingCount} bearings x ${coarseRadii.length} bracketing radii ` +
        `via ${engineLabel}; boundary linearly interpolated from measured drive times` +
        (refine ? `, then re-measured with one probe per bearing at the interpolated distance.` : `.`),
      notes,
    },
    {
      source: `Derived isochrone - ${engineLabel}`,
      fetchedAt: new Date().toISOString(),
      confidence: "medium",
      mocked: false,
      note:
        "No routing provider in this stack returns polygon geometry. This boundary is computed " +
        "by us from measured drive times and is labelled derived wherever it appears.",
    },
  );
}

/**
 * Walks a bearing's distance→duration curve outward and finds where drive time
 * crosses the budget.
 *
 * Deliberately takes the OUTERMOST in-budget sample, not the first
 * out-of-budget one. Drive time is not monotonic in straight-line distance - a
 * probe can land on the wrong side of Lady Bird Lake at 1.2 mi and back on a
 * fast arterial at 2.4 mi - and stopping at the first crossing would clip the
 * shed at the first obstacle rather than at its real edge.
 */
export function interpolateBoundary(
  samples: BearingSample[],
  targetMinutes: number,
): { distanceMi: number; flag: BearingFlag } {
  const usable = samples.filter((s) => s.durationMinutes !== null) as Array<
    BearingSample & { durationMinutes: number }
  >;

  if (usable.length === 0) {
    return { distanceMi: samples[0]?.distanceMi ?? 0, flag: "unreachable" };
  }

  const inside = usable.filter((s) => s.durationMinutes <= targetMinutes);
  if (inside.length === 0) {
    // Even the closest probe is over budget. Pin the boundary at a fraction of
    // the innermost radius scaled by how far over it ran, rather than at zero.
    const nearest = usable[0];
    const scale = Math.min(1, targetMinutes / Math.max(nearest.durationMinutes, 0.1));
    return { distanceMi: nearest.distanceMi * scale, flag: "clipped_inward" };
  }

  const outermostInside = inside[inside.length - 1];
  const beyond = usable.find(
    (s) => s.distanceMi > outermostInside.distanceMi && s.durationMinutes > targetMinutes,
  );

  if (!beyond) {
    return { distanceMi: outermostInside.distanceMi, flag: "truncated_outward" };
  }

  const span = beyond.durationMinutes - outermostInside.durationMinutes;
  const t = span <= 0 ? 0 : (targetMinutes - outermostInside.durationMinutes) / span;
  return {
    distanceMi:
      outermostInside.distanceMi + t * (beyond.distanceMi - outermostInside.distanceMi),
    flag: "interpolated",
  };
}
