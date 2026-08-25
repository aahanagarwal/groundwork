import type { ProximityOp } from "./types";

/**
 * Mireye's published pricing, mirrored client-side.
 *
 * Two reasons this exists rather than trusting the server:
 *   1. /v1/proximity is the only genuinely expensive call in this app, and the
 *      admin console shows an operator what a recompute will cost *before*
 *      they click. A demo that silently burns a month of credits is a bad demo.
 *   2. Every request carries `max_credits`, and a ceiling you compute yourself
 *      is a ceiling you can reason about.
 *
 * Source: https://docs.mireye.ai/api-reference/proximity#pricing
 *   credits = max(op_floor, 12 x paid_driving_calcs) + 1 per address locator
 *
 * The constants are also published at GET /v1/meta/plans; if Mireye reprices,
 * that endpoint is the truth and this file is stale. It is only ever used for
 * an estimate shown to a human and for a self-imposed ceiling, never for
 * billing, so drift is visible rather than dangerous.
 */

export const CREDITS_PER_DRIVING_CALC = 12;
export const CREDITS_PER_ADDRESS_LOCATOR = 1;
export const CREDITS_PER_GEOCODE = 1;
export const CREDITS_PER_FETCH_FIELD = 1;
export const CREDITS_PER_ASK = 10;

/**
 * The parcel record - by far the most expensive thing this app routinely buys,
 * and the one that surprised us.
 *
 * `/v1/lookup` bills the geocode price (1) WITHOUT `include_parcel`, and the
 * plan's resolve price WITH it. On Build that is 300 credits, because the
 * parcel comes from per-record-licensed county data: billed once per location,
 * not per field, because it is one record.
 *
 * We originally estimated 5 and were wrong by 60x - 900 of the first 3,828
 * credits this app spent went on three address resolutions nobody had priced.
 * Source: GET /v1/meta/plans → credits.parcel_field_group_credits_by_plan.
 *
 * Any /v1/fetch request that touches a `parcel_*` field triggers the same
 * charge on top of the per-field price, which is why the site-field list is
 * deliberately free of them.
 */
export const RESOLVE_CREDITS_BY_PLAN: Record<string, number> = {
  free: 300,
  build: 300,
  growth: 300,
  market: 150,
  scale: 150,
};

/**
 * Parcel records are ALSO capped separately from credits - 80 a month on
 * Build. That is the real scarce resource: the credit balance will look
 * healthy long after the parcel allowance is gone.
 */
export const PARCEL_RECORDS_INCLUDED_BY_PLAN: Record<string, number> = {
  build: 80,
};

export function resolveCredits(plan = "build"): number {
  return RESOLVE_CREDITS_BY_PLAN[plan] ?? RESOLVE_CREDITS_BY_PLAN.build;
}

/** `/v1/lookup`: a geocode, or a licensed parcel record, depending on one flag. */
export function estimateLookupCredits(includeParcel: boolean, plan = "build"): number {
  return includeParcel ? resolveCredits(plan) : CREDITS_PER_GEOCODE;
}

/** `/v1/fetch`: one credit per field, plus the parcel record if any field needs it. */
export function estimateFetchCredits(fields: string[], plan = "build"): number {
  const touchesParcel = fields.some((f) => f.startsWith("parcel_"));
  return fields.length * CREDITS_PER_FETCH_FIELD + (touchesParcel ? resolveCredits(plan) : 0);
}

export const OP_FLOORS = {
  distance: 2,
  nearest: 2,
  screen: 5,
  labor_shed: 25,
} as const;

/** A "lat,lng" string costs nothing to resolve; an address costs a geocode. */
export function isCoordinateLocator(locator: string): boolean {
  return /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(locator);
}

export interface CreditEstimate {
  credits: number;
  drivingCalcs: number;
  addressLocators: number;
  floorApplied: boolean;
  explanation: string;
}

export function estimateProximityCredits(op: ProximityOp): CreditEstimate {
  let drivingCalcs = 0;
  let locators: string[] = [];
  let floor: number;

  switch (op.op) {
    case "screen":
      // The full matrix is always computed, whatever survives.
      drivingCalcs = op.origins.length * op.anchors.length;
      locators = [...op.origins, ...op.anchors];
      floor = OP_FLOORS.screen;
      break;
    case "distance":
      drivingCalcs =
        op.mode === "straightline"
          ? 0
          : op.origins.length * op.destinations.length;
      locators = [...op.origins, ...op.destinations];
      floor = OP_FLOORS.distance;
      break;
    case "labor_shed":
      // Priced from the annulus after a free geometric prefilter, so it is not
      // knowable client-side. This is a worst-case placeholder; call the API
      // with `estimate: true` for the exact figure, which costs nothing.
      drivingCalcs = 0;
      locators = [op.origin];
      floor = OP_FLOORS.labor_shed;
      break;
  }

  const addressLocators = locators.filter((l) => !isCoordinateLocator(l)).length;
  const drivingPart = drivingCalcs * CREDITS_PER_DRIVING_CALC;
  const floorApplied = drivingPart < floor;
  const credits =
    Math.max(floor, drivingPart) + addressLocators * CREDITS_PER_ADDRESS_LOCATOR;

  const explanation =
    op.op === "labor_shed"
      ? `labor_shed is priced from the tract annulus after a free prefilter - the ${floor}-credit floor is the minimum, not the estimate. Call with estimate:true for the exact price at no cost.`
      : `${drivingCalcs} driving calc${drivingCalcs === 1 ? "" : "s"} x ${CREDITS_PER_DRIVING_CALC}` +
        (floorApplied ? ` (below the ${floor}-credit floor)` : "") +
        (addressLocators > 0
          ? ` + ${addressLocators} address locator${addressLocators === 1 ? "" : "s"}`
          : "");

  return { credits, drivingCalcs, addressLocators, floorApplied, explanation };
}
