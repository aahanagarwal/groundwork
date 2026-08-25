import { mireye } from "@/lib/mireye/client";
import type { AgentId } from "@/lib/telemetry/ledger";
import { ok, refuse } from "@/lib/datasource";
import type { LatLng } from "@/lib/geo";
import type { DurationProbe } from "./builder";

/**
 * The two routing engines, behind one interface.
 *
 * Both answer exactly one question - "how long to drive from the site to each
 * of these points" - so the isochrone builder is identical across them and any
 * difference in the polygons is a difference in the road network model, not in
 * our maths. That is what makes the IoU comparison mean something.
 */

const OSRM_BASE = process.env.OSRM_URL?.trim() || "http://127.0.0.1:5010";

/**
 * Mireye /v1/proximity, op: screen.
 *
 * `screen` rather than `distance` because it does not throw away the misses:
 * `screened_out` carries every non-survivor's own best duration, which is
 * exactly the near-miss data the boundary interpolation needs. `distance`
 * would return the same matrix at the same price with no verdict attached, so
 * `screen` is strictly more information for the same credits.
 */
export function mireyeProbe(agent: AgentId, siteId?: string): DurationProbe {
  return async (origin: LatLng, targets: LatLng[], maxMinutes: number) => {
    const locator = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

    const result = await mireye.screen(
      {
        // Coordinate locators skip Mireye's geocoding gate and cost no extra
        // credit; an address locator would add one credit each.
        origins: targets.map(locator),
        anchors: [locator(origin)],
        max_minutes: maxMinutes,
      },
      { agent, siteId },
    );

    if (!result.ok) return refuse(result.refusal);

    const durationsMinutes: (number | null)[] = new Array(targets.length).fill(null);
    for (const s of result.data.survivors) {
      durationsMinutes[s.origin_index] = s.best_duration_minutes;
    }
    for (const s of result.data.screened_out) {
      durationsMinutes[s.origin_index] = s.best_duration_minutes;
    }

    return ok(
      {
        durationsMinutes,
        paidDrivingCalcs: result.data.paid_driving_calcs,
        notes: result.data.notes ?? [],
      },
      result.provenance,
    );
  };
}

/**
 * Local OSRM over the Austin OSM extract.
 *
 * Free, instant, and - crucially - a graph we control, so a road closure is a
 * segment-speed override rather than a vendor feature we do not have. This is
 * the counterfactual engine; Mireye remains the authority the counterfactual
 * is validated against.
 */
export function osrmProbe(baseUrl: string = OSRM_BASE): DurationProbe {
  return async (origin: LatLng, targets: LatLng[]) => {
    // OSRM's table service takes lng,lat. Source 0 is the site; every target
    // is a destination, so one request is one row of the matrix.
    const coords = [origin, ...targets]
      .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(";");
    const destinations = targets.map((_, i) => i + 1).join(";");
    const url = `${baseUrl}/table/v1/driving/${coords}?sources=0&destinations=${destinations}&annotations=duration`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      return refuse({
        code: "osrm_unreachable",
        message:
          error instanceof Error ? error.message : "The local router did not respond.",
        retryable: true,
        hint: `Start it with: osrm-routed --algorithm mld --port 5010 data/osm/Austin.osrm`,
      });
    }

    if (!response.ok) {
      return refuse({
        code: `osrm_http_${response.status}`,
        message: `Local OSRM returned ${response.status}.`,
        retryable: response.status >= 500,
      });
    }

    const body = (await response.json()) as {
      code: string;
      durations?: number[][];
      message?: string;
    };

    if (body.code !== "Ok" || !body.durations?.[0]) {
      return refuse({
        code: `osrm_${body.code?.toLowerCase() ?? "error"}`,
        message: body.message ?? "The local router could not build the matrix.",
        retryable: false,
      });
    }

    return ok(
      {
        // OSRM reports seconds; null where no route exists.
        durationsMinutes: body.durations[0].map((s) =>
          s === null || s === undefined ? null : s / 60,
        ),
        paidDrivingCalcs: 0,
        notes: [
          "Local OSRM over an Austin OSM extract. Free-flow speeds from the stock car profile - no traffic model.",
        ],
      },
      {
        source: "Local OSRM (Austin OSM extract)",
        sourceUrl: "https://project-osrm.org/",
        fetchedAt: new Date().toISOString(),
        confidence: "medium",
        mocked: false,
        note: "Counterfactual engine. Validated against the Mireye-derived polygon by IoU.",
      },
    );
  };
}
