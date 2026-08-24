import { mireye } from "@/lib/mireye/client";
import { config } from "@/lib/config";
import type { Provenance, SourceResult } from "@/lib/datasource";
import { ok, refuse } from "@/lib/datasource";
import { sites, type SiteRecord } from "@/lib/domain";
import { demoSiteBySlug, DEMO_SITES } from "@/lib/demo-sites";

/**
 * THE RESOLVER — address in, parcel out, or an honest refusal.
 *
 * Mireye's /v1/lookup already refuses rather than guessing, and returns its
 * verdict as `disposition: resolved | clarify | no_match`. We adopt that
 * vocabulary wholesale instead of inventing a parallel one: a `clarify` comes
 * back with up to three candidates for the user to pick between, and a
 * `no_match` comes back with a reason. Neither is an error — both are
 * designed states.
 *
 * The failure this guards against is not "no match found". It is a confident
 * match on the wrong place: Mireye's own docs record "1412 market street"
 * matching a town in West Virginia at confidence 1.0. That is why every
 * address in this app carries its city and state, and why a coarse match is a
 * refusal rather than a coordinate.
 *
 * Without a key, the three seeded demo addresses fall back to hand-checked
 * coordinates flagged `approximate: true`, and every other address is refused.
 * We will not invent a location for an address we cannot resolve.
 */

/** Site facts worth having about a food-and-beverage address, from the
 *  catalogue at docs.mireye.ai/api-reference/field-catalog. */
export const SITE_FIELDS = [
  "nearest_cafe_distance_m",
  "nearest_cafe_name",
  "nearest_restaurant_distance_m",
  "nearest_restaurant_name",
  "nearest_bar_distance_m",
  "poi_count_1km",
  "nearest_school_distance_m",
  "nearest_school_name",
  "nearest_major_road_name",
  "nearest_major_road_distance_m",
  "nearest_road_class",
  "roads_within_500m_count",
  "tract_population",
  "tract_civilian_labor_force",
  "county_median_household_income",
  "housing_units_within_1km",
] as const;

function emptySite(
  slug: string,
  label: string,
  inputAddress: string,
): SiteRecord {
  return {
    id: slug,
    slug,
    label,
    inputAddress,
    resolved: false,
    disposition: null,
    resolvedAddress: null,
    lat: null,
    lng: null,
    confidence: null,
    matchMethod: null,
    accuracyType: null,
    county: null,
    countyFips: null,
    state: null,
    tractGeoid: null,
    cbsaName: null,
    timezone: null,
    elevationM: null,
    femaFloodZone: null,
    withinFloodplain: null,
    parcelId: null,
    parcelApn: null,
    parcelAreaM2: null,
    parcelOwner: null,
    parcelZoning: null,
    parcelGeoJson: null,
    countyMarket: null,
    siteFields: null,
    provenance: {},
    resolvedAt: null,
    approximate: false,
  };
}

/**
 * Regrid parcel geometry arrives as WKT. Only POLYGON and MULTIPOLYGON are
 * handled — anything else returns null rather than a mangled shape, because a
 * wrong parcel outline on the map is worse than no outline.
 */
export function wktToGeoJson(
  wkt: string | null | undefined,
): GeoJSON.Geometry | null {
  if (!wkt) return null;
  const text = wkt.trim().toUpperCase();

  const parseRings = (body: string): number[][][] =>
    body
      .split(/\)\s*,\s*\(/)
      .map((ring) =>
        ring
          .replace(/[()]/g, "")
          .split(",")
          .map((pair) => {
            const [lng, lat] = pair.trim().split(/\s+/).map(Number);
            return [lng, lat];
          })
          .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
      )
      .filter((ring) => ring.length >= 4);

  try {
    if (text.startsWith("POLYGON")) {
      const body = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
      const coordinates = parseRings(body);
      return coordinates.length ? { type: "Polygon", coordinates } : null;
    }
    if (text.startsWith("MULTIPOLYGON")) {
      const body = wkt.slice(wkt.indexOf("((") + 1, wkt.lastIndexOf(")"));
      const polygons = body
        .split(/\)\s*\)\s*,\s*\(\s*\(/)
        .map((chunk) => parseRings(chunk))
        .filter((rings) => rings.length > 0);
      return polygons.length
        ? { type: "MultiPolygon", coordinates: polygons }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveSite(
  slugOrAddress: string,
  opts: { force?: boolean } = {},
): Promise<SourceResult<SiteRecord>> {
  const demo = demoSiteBySlug(slugOrAddress);
  const address = demo?.address ?? slugOrAddress;
  const slug = demo?.slug ?? slugify(address);
  const label = demo?.label ?? address;

  // Ground-layer facts are fetched once per address and kept forever. This is
  // the rule that makes a 90-day backtest cost the same as a one-day run.
  const existing = sites.find((s) => s.slug === slug);
  if (existing?.resolved && !opts.force) {
    return ok(existing, {
      source: "Groundwork store (persisted resolve)",
      fetchedAt: existing.resolvedAt ?? new Date().toISOString(),
      confidence: "high",
      mocked: false,
      note: "Resolved once and persisted. No credits spent on repeat views.",
    });
  }

  const lookup = await mireye.lookup(
    { input: address },
    { agent: "resolver", siteId: slug },
  );

  // --- No key / no fixture: seeded fallback, clearly flagged ---------------
  if (!lookup.ok) {
    if (
      demo &&
      (lookup.refusal.code === "no_api_key" ||
        lookup.refusal.code === "fixture_missing")
    ) {
      const record: SiteRecord = {
        ...emptySite(slug, label, address),
        resolved: true,
        disposition: "resolved",
        resolvedAddress: demo.address,
        lat: demo.fallbackAt.lat,
        lng: demo.fallbackAt.lng,
        confidence: null,
        matchMethod: "seeded_fallback",
        county: "Travis County",
        state: "Texas",
        cbsaName: "Austin-Round Rock-San Marcos, TX Metro Area",
        timezone: "America/Chicago",
        approximate: true,
        resolvedAt: new Date().toISOString(),
        provenance: {
          location: {
            source: "Groundwork seeded coordinate (no Mireye key present)",
            fetchedAt: new Date().toISOString(),
            confidence: "low",
            mocked: true,
            note:
              "Hand-checked approximate rooftop coordinate for a demo address. NOT a parcel match. " +
              "Add MIREYE_API_KEY to replace this with a real /v1/lookup result.",
          },
        },
      };
      sites.put(record);
      return ok(record, record.provenance.location);
    }
    return refuse(lookup.refusal);
  }

  const data = lookup.data;

  // --- Mireye's own refusal vocabulary, passed straight through ------------
  if (data.disposition === "clarify") {
    return refuse({
      code: "clarify",
      message: `"${address}" matches more than one place. Mireye will not silently pick one.`,
      retryable: false,
      hint: data.hint ?? "Choose the intended address, or add a ZIP code.",
      candidates: (data.candidates ?? []).map((c) => ({
        label: c.resolved_address,
        value: c.resolved_address,
        confidence: c.confidence,
      })),
    });
  }

  if (data.disposition === "no_match") {
    return refuse({
      code: data.reason ?? "no_match",
      message: `Mireye could not match "${address}" to a place it trusts.`,
      retryable: false,
      hint:
        data.hint ?? "Check the street name, and include the city and state.",
    });
  }

  const groundProvenance: Provenance = {
    source: "Mireye /v1/lookup",
    sourceUrl: "https://docs.mireye.ai/api-reference/lookup",
    fetchedAt: new Date().toISOString(),
    confidence: (data.confidence ?? 0) >= 0.9 ? "high" : "medium",
    mocked: false,
    note: data.match_method ? `match: ${data.match_method}` : undefined,
  };

  const record: SiteRecord = {
    ...emptySite(slug, label, address),
    resolved: true,
    disposition: "resolved",
    resolvedAddress: data.resolved_address ?? address,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    confidence: data.confidence ?? null,
    matchMethod: data.match_method ?? null,
    county: data.county ?? null,
    countyFips: data.county_fips ?? null,
    state: data.state ?? null,
    tractGeoid: data.tract_geoid ?? null,
    cbsaName: data.cbsa_name ?? null,
    timezone: data.timezone ?? null,
    elevationM: data.elevation_m ?? null,
    femaFloodZone: data.fema_flood_zone ?? null,
    withinFloodplain: data.within_floodplain ?? null,
    parcelId: data.parcel?.parcel_id ?? null,
    parcelApn: data.parcel?.apn ?? null,
    parcelAreaM2: data.parcel?.area_m2 ?? null,
    parcelOwner: data.parcel?.owner ?? null,
    parcelZoning: data.parcel?.zoning ?? null,
    parcelGeoJson:
      (data.parcel?.geometry as GeoJSON.Geometry | undefined) ??
      wktToGeoJson(data.parcel?.geometry_wkt),
    countyMarket: (data.county_market as Record<string, number | null>) ?? null,
    resolvedAt: new Date().toISOString(),
    provenance: { location: groundProvenance, parcel: groundProvenance },
  };

  // A parcel that was eligible but did not come back is worth saying out loud
  // rather than rendering as a blank field.
  if (data.parcel_unavailable) {
    record.provenance.parcel = {
      ...groundProvenance,
      confidence: "low",
      note: `Parcel unavailable: ${data.parcel_unavailable_reason ?? "reason not given"}`,
    };
  }

  // --- Site fields, on the world-ingest budget -----------------------------
  if (record.lat !== null && record.lng !== null) {
    const fields = await mireye.fetchFields(
      { lat: record.lat, lng: record.lng, fields: [...SITE_FIELDS] },
      { agent: "world_ingest", siteId: slug },
    );
    if (fields.ok) {
      record.siteFields = fields.data.fields as Record<string, unknown>;
      record.provenance.siteFields = fields.provenance;
    }
    // A failed field fetch is not fatal — the parcel still resolved.
  }

  sites.put(record);
  return ok(record, groundProvenance);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Resolves every seeded demo address. Used by the seed script. */
export async function resolveAllDemoSites(): Promise<SiteRecord[]> {
  const out: SiteRecord[] = [];
  for (const site of DEMO_SITES) {
    const result = await resolveSite(site.slug);
    if (result.ok) out.push(result.data);
  }
  return out;
}

export { config };
