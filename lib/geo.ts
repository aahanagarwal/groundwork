/**
 * Small geodesic helpers. No dependency — everything here is a few lines of
 * spherical trigonometry and adding a mapping library for it would be silly.
 */

const EARTH_RADIUS_M = 6_371_008.8;
export const METERS_PER_MILE = 1609.344;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Point at `distanceM` from `origin` along a compass `bearingDeg`. */
export function destinationPoint(
  origin: LatLng,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );

  return {
    lat: toDeg(phi2),
    // Normalise into [-180, 180].
    lng: ((toDeg(lambda2) + 540) % 360) - 180,
  };
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lng - a.lng);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** A GeoJSON ring approximating a circle. The naive comparison object. */
export function circleRing(
  center: LatLng,
  radiusMiles: number,
  steps = 96,
): number[][] {
  const radiusM = radiusMiles * METERS_PER_MILE;
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const p = destinationPoint(center, (i * 360) / steps, radiusM);
    ring.push([p.lng, p.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Spherical excess area of a closed ring, in square miles. Accurate enough at
 * neighbourhood scale that the polygon-vs-circle comparison is honest, which
 * is all it is used for.
 */
export function ringAreaSqMi(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total +=
      toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  const areaM2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return areaM2 / (METERS_PER_MILE * METERS_PER_MILE);
}

export function polygon(ring: number[][]): GeoJSON.Polygon {
  return { type: "Polygon", coordinates: [ring] };
}

/** Ray casting. Used to count which naive-circle tracts fall outside the shed. */
export function pointInRing(point: LatLng, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Intersection-over-union of two polygons that are star-shaped about a common
 * centre — which both of our isochrones are, by construction: one boundary
 * point per compass bearing, radiating from the same site.
 *
 * That lets us skip general polygon clipping entirely and work in polar
 * coordinates, where the answer is exact rather than approximate:
 *
 *     intersection = 1/2 * integral of min(rA, rB)^2 dtheta
 *     union        = 1/2 * integral of max(rA, rB)^2 dtheta
 *
 * Used for two things: reporting how far a drive shed departs from a circle,
 * and the Phase 4 credibility number — how closely the local OSRM
 * counterfactual reproduces the Mireye-derived polygon.
 */
export function starPolygonIoU(
  ringA: number[][],
  ringB: number[][],
  center: LatLng,
  samples = 720,
): { iou: number; intersectionSqMi: number; unionSqMi: number } {
  const radiusAt = (ring: number[][], bearingDeg: number): number => {
    // Ring vertices are ordered by bearing, so interpolate between the two
    // that straddle this angle.
    const pts = ring.slice(0, -1).map((c) => {
      const p = { lat: c[1], lng: c[0] };
      const dLng = toRad(p.lng - center.lng) * Math.cos(toRad(center.lat));
      const dLat = toRad(p.lat - center.lat);
      let bearing = (toDeg(Math.atan2(dLng, dLat)) + 360) % 360;
      if (bearing === 360) bearing = 0;
      return { bearing, r: haversineMeters(center, p) };
    });
    pts.sort((x, y) => x.bearing - y.bearing);

    const target = ((bearingDeg % 360) + 360) % 360;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const span = (b.bearing - a.bearing + 360) % 360;
      const offset = (target - a.bearing + 360) % 360;
      if (span > 0 && offset <= span) {
        return a.r + (offset / span) * (b.r - a.r);
      }
    }
    return pts[0]?.r ?? 0;
  };

  const dTheta = (2 * Math.PI) / samples;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < samples; i++) {
    const bearing = (i * 360) / samples;
    const rA = radiusAt(ringA, bearing);
    const rB = radiusAt(ringB, bearing);
    inter += 0.5 * Math.min(rA, rB) ** 2 * dTheta;
    union += 0.5 * Math.max(rA, rB) ** 2 * dTheta;
  }

  const toSqMi = (m2: number) => m2 / (METERS_PER_MILE * METERS_PER_MILE);
  return {
    iou: union > 0 ? inter / union : 0,
    intersectionSqMi: toSqMi(inter),
    unionSqMi: toSqMi(union),
  };
}
