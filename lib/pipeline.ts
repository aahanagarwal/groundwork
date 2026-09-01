import { attribute, type AttributionEvent, type AttributionResult } from "@/lib/attribution/decompose";
import { buildIsochrone, type IsochroneResult } from "@/lib/isochrone/builder";
import { mireyeProbe, osrmProbe } from "@/lib/isochrone/probes";
import { config, TRADE_AREA_MINUTES, NAIVE_RADIUS_MILES } from "@/lib/config";
import type { Refusal } from "@/lib/datasource";
import {
  ledgerDays,
  tradeAreas,
  worldEvents,
  type LedgerDayRecord,
  type SiteRecord,
  type TradeAreaRecord,
  type WorldEventRecord,
} from "@/lib/domain";
import { generateLedger } from "@/lib/fixtures/generate-ledger";
import { resolveSite } from "@/lib/resolver";
import { mireye } from "@/lib/mireye/client";
import { loadScenario, loadScenarios, type Scenario } from "@/lib/scenarios";
import { haversineMeters, pointInRing, METERS_PER_MILE, type LatLng } from "@/lib/geo";
import { deriveWeatherEvents } from "@/lib/world/derive-events";
import { fetchNormals, fetchObserved, scoreAnomalies } from "@/lib/world/weather";

/**
 * THE PIPELINE - one function that walks the whole diagram.
 *
 *   resolve  →  trade area  →  world ingest (polygon-filtered)  →  ledger
 *            →  attribution  →  the object every surface reads
 *
 * Every stage can refuse, and a refusal at any stage stops the ones that
 * depend on it while leaving the ones that don't intact. A missing permit feed
 * must not take down the revenue chart.
 */

export interface DashboardStageStatus {
  stage: string;
  ok: boolean;
  refusal?: Refusal;
  note?: string;
}

export interface Dashboard {
  site: SiteRecord;
  scenario: Scenario;
  scenarios: Array<{ key: string; name: string; description: string }>;
  tradeArea: TradeAreaRecord | null;
  events: WorldEventRecord[];
  /**
   * Drivers that were considered and then rejected for falling outside the
   * drive polygon. Attribution never sees these - that is the point of the
   * filter - but the map draws them hollow, because "we looked at this and it
   * does not reach you" is the argument the polygon exists to make, and it
   * cannot be made with the rejects thrown away.
   */
  discardedEvents: WorldEventRecord[];
  ledger: LedgerDayRecord[];
  attribution: AttributionResult | null;
  /** Real weather drivers found in the window, kept separate from scenario
   *  events so the UI can show which half of the world layer is live. */
  liveWeatherEvents: WorldEventRecord[];
  stages: DashboardStageStatus[];
}

export async function buildDashboard(
  slug: string,
  scenarioKey: string = config.demo.defaultScenario,
): Promise<{ ok: true; data: Dashboard } | { ok: false; refusal: Refusal }> {
  const stages: DashboardStageStatus[] = [];
  const scenario = loadScenario(scenarioKey);

  // --- 1. RESOLVE -----------------------------------------------------------
  const resolved = await resolveSite(slug);
  if (!resolved.ok) {
    return { ok: false, refusal: resolved.refusal };
  }
  const site = resolved.data;
  stages.push({
    stage: "resolve",
    ok: true,
    note: site.approximate
      ? "Seeded coordinate - no Mireye key present, so this is not a parcel match."
      : `Parcel matched via ${site.matchMethod ?? "Mireye /v1/lookup"}.`,
  });

  // --- 2. TRADE AREA --------------------------------------------------------
  const tradeArea = await ensureTradeArea(site, stages);

  // --- 3. WORLD INGEST ------------------------------------------------------
  const scenarioEvents = loadScenarioEvents(site, scenario);
  const liveWeatherEvents = await loadLiveWeather(site, scenario, stages);

  // Scenario weather is a stand-in for the live feed. When the live feed
  // answers, it wins - but only for the kinds it actually covers, so a
  // scenario's road closure and competitor survive.
  const weatherKinds = new Set(["heat", "rain"]);
  const events = [
    ...scenarioEvents.filter((e) => !(liveWeatherEvents.length > 0 && weatherKinds.has(e.kind))),
    ...liveWeatherEvents,
  ]
    .filter((e) => e.enabled)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Measured before the polygon filter, so a driver that gets rejected can
  // still say how far away it actually was - that rejection is the argument
  // the map makes, and "9.7 miles" makes it better than "outside".
  await ensureDriveTimes(site, events, stages);

  const { kept: filtered, discarded: discardedEvents } = filterByPolygon(
    events,
    site,
    tradeArea,
  );
  stages.push({
    stage: "world_ingest",
    ok: true,
    note:
      `${filtered.length} of ${events.length} drivers kept` +
      (tradeArea ? ` after filtering to the ${tradeArea.minutes}-minute polygon.` : " (no polygon yet, so nothing was spatially filtered)."),
  });

  // --- 4. LEDGER ------------------------------------------------------------
  const ledger = loadLedger(site, scenario, liveWeatherEvents);
  stages.push({
    stage: "ledger",
    ok: true,
    note: `${ledger.length} days of till data (seeded - Square/QuickBooks are not connected in this build).`,
  });

  // --- 5. ATTRIBUTION -------------------------------------------------------
  let attribution: AttributionResult | null = null;
  if (ledger.length > 0) {
    const drivers: AttributionEvent[] = filtered.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      startDate: e.startDate,
      endDate: e.endDate,
      magnitude: e.magnitude,
      source: e.source,
      sourceUrl: e.sourceUrl ?? undefined,
      meta: e.meta,
      provenance: e.provenance,
    }));
    attribution = attribute(
      ledger.map((d) => ({
        date: d.date,
        tickets: d.tickets,
        basketSizeUsd: d.basketSizeUsd,
        revenueUsd: d.revenueUsd,
      })),
      drivers,
      scenario.analysisWindow.start,
      scenario.analysisWindow.end,
    );
    stages.push({
      stage: "attribution",
      ok: true,
      note: `${attribution.deltaPct.toFixed(1)}% against baseline over ${attribution.windowDays} days, confidence ${attribution.confidence}.`,
    });
  } else {
    stages.push({
      stage: "attribution",
      ok: false,
      refusal: {
        code: "no_ledger",
        message: "No till data for this site and scenario, so there is nothing to explain.",
        retryable: false,
        hint: "Run `npm run seed` to generate the demo ledger.",
      },
    });
  }

  return {
    ok: true,
    data: {
      site,
      scenario,
      // The three hand-authored scenarios are shared templates, deliberately
      // offered on every site's picker. A user-built scenario (`custom`)
      // describes one specific business from its own paragraph and has no
      // business appearing as an option anywhere else - see the comment on
      // `Scenario.custom` in lib/scenarios.ts.
      scenarios: loadScenarios()
        .filter((s) => !s.custom || s.site === slug)
        .map((s) => ({
          key: s.key,
          name: s.name,
          description: s.description,
        })),
      tradeArea,
      events: filtered,
      discardedEvents,
      ledger,
      attribution,
      liveWeatherEvents,
      stages,
    },
  };
}

/**
 * The polygon is fetched once per address and kept forever. Mireye draws it
 * when a key is present; local OSRM draws it otherwise, and the record says
 * which - a polygon never pretends to be from an engine that didn't draw it.
 */
export async function ensureTradeArea(
  site: SiteRecord,
  stages: DashboardStageStatus[],
): Promise<TradeAreaRecord | null> {
  if (site.lat === null || site.lng === null) {
    stages.push({
      stage: "trade_area",
      ok: false,
      refusal: {
        code: "no_coordinate",
        message: "The site has no coordinate, so no trade area can be drawn.",
        retryable: false,
      },
    });
    return null;
  }

  // Both engines' polygons are kept side by side - the OSRM one is the
  // counterfactual router and the Mireye one is the authority it is validated
  // against, so overwriting one with the other would destroy the comparison.
  // With a key present the Mireye polygon is what the owner sees; without one,
  // whatever we have.
  const preferredEngine = config.mireye.apiKey ? "mireye" : "osrm";
  const forSite = tradeAreas.filter(
    (t) => t.siteId === site.id && t.minutes === TRADE_AREA_MINUTES,
  );
  const existing =
    forSite.find((t) => t.engine === preferredEngine) ??
    (config.mireye.apiKey ? undefined : forSite[0]);

  if (existing) {
    stages.push({
      stage: "trade_area",
      ok: true,
      note: `Persisted ${existing.engine} polygon from ${existing.computedAt.slice(0, 10)} - no credits spent on this view.`,
    });
    return existing;
  }

  const origin = { lat: site.lat, lng: site.lng };
  const useMireye = config.mireye.mode !== "replay";
  const probe = useMireye
    ? mireyeProbe("isochrone", site.id)
    : osrmProbe();
  const engineLabel = useMireye
    ? "Mireye /v1/proximity (op: screen)"
    : "local OSRM (Austin extract)";

  const built = await buildIsochrone(origin, TRADE_AREA_MINUTES, probe, {
    naiveRadiusMiles: NAIVE_RADIUS_MILES,
    engineLabel,
  });

  if (!built.ok) {
    // Mireye refused; fall back to the local router rather than showing no
    // map at all, and label the fallback.
    const fallback = await buildIsochrone(origin, TRADE_AREA_MINUTES, osrmProbe(), {
      naiveRadiusMiles: NAIVE_RADIUS_MILES,
      engineLabel: "local OSRM (Austin extract)",
    });
    if (!fallback.ok) {
      stages.push({ stage: "trade_area", ok: false, refusal: built.refusal });
      return null;
    }
    stages.push({
      stage: "trade_area",
      ok: true,
      note: `Mireye refused (${built.refusal.code}); drawn with the local router instead.`,
    });
    return persistTradeArea(site, fallback.data, "osrm", fallback.provenance);
  }

  stages.push({
    stage: "trade_area",
    ok: true,
    note: `Drawn from ${built.data.probesTested} probes; boundary accurate to ${built.data.accuracy.meanErrorMinutes.toFixed(2)} min on average.`,
  });
  return persistTradeArea(
    site,
    built.data,
    useMireye ? "mireye" : "osrm",
    built.provenance,
  );
}

function persistTradeArea(
  site: SiteRecord,
  iso: IsochroneResult,
  engine: string,
  provenance: TradeAreaRecord["provenance"],
): TradeAreaRecord {
  const record: TradeAreaRecord = {
    id: `${site.id}-${iso.minutes}-${engine}`,
    siteId: site.id,
    minutes: iso.minutes,
    mode: "driving",
    engine,
    polygonGeoJson: iso.geojson,
    naiveCircleGeoJson: iso.naiveCircle,
    naiveRadiusMiles: iso.naiveRadiusMiles,
    areaSqMi: iso.areaSqMi,
    naiveAreaSqMi: iso.naiveAreaSqMi,
    method: iso.method,
    bearings: iso.bearings.length,
    probesTested: iso.probesTested,
    paidDrivingCalcs: iso.paidDrivingCalcs,
    creditsEstimated: iso.probesTested * 12,
    creditsActual: iso.paidDrivingCalcs * 12,
    accuracyMeanErrorMinutes: iso.accuracy.meanErrorMinutes,
    accuracyMaxErrorMinutes: iso.accuracy.maxErrorMinutes,
    laborForce: null,
    population: null,
    naivePopulation: null,
    detail: iso.bearings,
    provenance,
    computedAt: new Date().toISOString(),
  };
  tradeAreas.put(record);
  return record;
}

/**
 * MEASURE HOW FAR THE DRIVERS ACTUALLY ARE, BY ROAD
 *
 * Everything else in this file already knows that a circle round an address
 * lies about who can reach it - that is what the isochrone is for. Until now
 * the pins on that map contradicted it, because each one reported a
 * straight-line distance. This closes the gap: the same routing engine that
 * draws the polygon also measures the drivers standing inside it.
 *
 * Three properties this has to hold, in priority order:
 *
 *   PERSISTED. A drive time between two fixed points does not change between
 *     page loads, so it is bought once and kept. Without that this would bill
 *     on every render and break the rule the Budget Broker exists to enforce -
 *     a 90-day backtest must not cost more than a one-day run.
 *   BATCHED. One request carrying every origin, not one per competitor.
 *     Mireye prices the matrix by leg either way, but each extra request adds
 *     latency and another chance to be refused halfway through a page.
 *   HONEST WHEN ABSENT. No key, no fixture, or a refusal leaves driveTime as a
 *     haversine reading explicitly labelled as such. A surface may show the
 *     straight line; it may not call it a drive time.
 */
const driveTimesInFlight = new Map<string, Promise<unknown>>();

export async function ensureDriveTimes(
  site: SiteRecord,
  events: WorldEventRecord[],
  stages: DashboardStageStatus[],
  opts: { force?: boolean } = {},
): Promise<WorldEventRecord[]> {
  if (site.lat === null || site.lng === null) return events;
  const origin = { lat: site.lat, lng: site.lng };

  const locatable = events.filter(
    (e) => (e.meta?.["at"] as LatLng | undefined) !== undefined,
  );

  // Retry policy, and it is load-bearing.
  //
  // A routed measurement is kept forever - two fixed points do not move. But a
  // FAILED one used to leave the record on its haversine fallback, which reads
  // as "not measured yet", so the next render tried again. Under a dev server
  // re-rendering on every request that is a retry on every page load: 48 calls
  // where there should have been one, until the Budget Broker started refusing
  // them. The broker did its job, but a component that needs a circuit breaker
  // to be safe is not safe.
  //
  // So a failed attempt is remembered too, and not retried until the window
  // has passed. Transient breakage still heals; a persistent one costs one call
  // an hour instead of one per render.
  const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;
  const unmeasured = locatable.filter((e) => {
    if (opts.force) return true;
    if (e.driveTime?.method === "mireye_distance") return false;
    if (!e.driveTime) return true;
    return Date.now() - Date.parse(e.driveTime.measuredAt) > RETRY_FAILED_AFTER_MS;
  });
  if (unmeasured.length === 0) return events;

  // Concurrent renders of the same page would each fire the same call before
  // any of them persisted a result. One in-flight measurement per site.
  const inflightKey = `${site.id}:${unmeasured.map((e) => e.id).join(",")}`;
  const existing = driveTimesInFlight.get(inflightKey);
  if (existing) {
    await existing;
    return events;
  }

  // The straight line is written first, unconditionally. If the routed call
  // refuses we still have a number and a truthful label for where it came from.
  const now = new Date().toISOString();
  for (const e of unmeasured) {
    const at = e.meta!["at"] as LatLng;
    e.driveTime = {
      minutes: null,
      miles: haversineMeters(origin, at) / METERS_PER_MILE,
      method: "haversine",
      measuredAt: now,
    };
  }

  const locator = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const pending = mireye.distance(
    {
      // Coordinate locators skip Mireye's geocoding gate and cost no extra
      // credit; an address locator would add one apiece.
      origins: unmeasured.map((e) => locator(e.meta!["at"] as LatLng)),
      destinations: [locator(origin)],
      mode: "driving",
    },
    { agent: "world_ingest", siteId: site.id },
  );
  driveTimesInFlight.set(inflightKey, pending);
  let result;
  try {
    result = await pending;
  } finally {
    driveTimesInFlight.delete(inflightKey);
  }

  if (!result.ok) {
    worldEvents.putMany(unmeasured);
    stages.push({
      stage: "drive_times",
      ok: false,
      refusal: result.refusal,
      note: `Falling back to straight-line distance for ${unmeasured.length} driver${unmeasured.length === 1 ? "" : "s"}, labelled as such.`,
    });
    return events;
  }

  for (const leg of result.data.legs) {
    const event = unmeasured[leg.origin_index];
    if (!event) continue;
    // A leg with no duration is unroutable - water, a private road, the wrong
    // side of a barrier. Keeping the haversine reading with its own label is
    // more useful than writing null and losing the fact entirely.
    if (leg.duration_minutes === null) continue;
    event.driveTime = {
      minutes: leg.duration_minutes,
      miles: leg.distance_miles,
      method: "mireye_distance",
      measuredAt: now,
    };
  }

  worldEvents.putMany(unmeasured);
  const routed = unmeasured.filter((e) => e.driveTime?.method === "mireye_distance").length;
  stages.push({
    stage: "drive_times",
    ok: true,
    note: `${routed} of ${unmeasured.length} drivers measured by road via Mireye /v1/proximity distance (${result.data.paid_driving_calcs} paid driving calcs). Persisted - repeat views cost nothing.`,
  });
  return events;
}

/**
 * Fingerprint the authored event block of a scenario.
 *
 * Cheap, order-sensitive, and content-sensitive: adding a competitor, moving a
 * coordinate, or changing a magnitude all produce a different string. That is
 * the whole requirement - it only has to answer "is what I cached still what
 * the fixture says?".
 */
function fixtureFingerprint(scenario: Scenario): string {
  const canonical = JSON.stringify(
    scenario.events.map((e) => [e.kind, e.label, e.startDate, e.endDate, e.magnitude, e.meta ?? null]),
  );
  // djb2. A hash collision here would re-use a stale cache entry, which the
  // next fixture edit corrects - not worth a crypto import.
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) | 0;
  return `${scenario.events.length}-${(h >>> 0).toString(36)}`;
}

function loadScenarioEvents(site: SiteRecord, scenario: Scenario): WorldEventRecord[] {
  const fixtureHash = fixtureFingerprint(scenario);
  const stored = worldEvents.filter(
    (e) => e.siteId === site.id && e.scenarioKey === scenario.key,
  );

  // Only trust the cache when it was seeded from the fixture as it reads now.
  // Without this check, edits to data/scenarios/*.json were silently inert:
  // the competitors added to road-closure-dip never loaded, and because the
  // cached rows predated the `at` coordinates, every map pin was dropped for
  // having no geometry. The map looked empty and the fixture looked fine.
  if (stored.length > 0 && stored.every((e) => e.fixtureHash === fixtureHash)) {
    return stored;
  }
  if (stored.length > 0) {
    worldEvents.remove((e) => e.siteId === site.id && e.scenarioKey === scenario.key);
  }

  const records: WorldEventRecord[] = scenario.events.map((e, i) => ({
    id: `${site.id}-${scenario.key}-${i}`,
    siteId: site.id,
    scenarioKey: scenario.key,
    kind: e.kind,
    label: e.label,
    startDate: e.startDate,
    endDate: e.endDate,
    magnitude: e.magnitude,
    enabled: true,
    source: e.source,
    sourceUrl: e.sourceUrl ?? null,
    meta: (e.meta as Record<string, unknown>) ?? null,
    fixtureHash,
    driveTime: null,
    polygonMembership: {
      filtered: false,
      inside: true,
      distanceM: null,
      reason: "Authored for this address in the scenario fixture.",
    },
    provenance: {
      source: e.source,
      sourceUrl: e.sourceUrl,
      fetchedAt: new Date().toISOString(),
      confidence: "medium",
      mocked: true,
      note: "Scenario fixture - stands in for a live permit / 511 / events feed.",
    },
  }));
  worldEvents.putMany(records);
  return records;
}

async function loadLiveWeather(
  site: SiteRecord,
  scenario: Scenario,
  stages: DashboardStageStatus[],
): Promise<WorldEventRecord[]> {
  if (site.lat === null || site.lng === null) return [];
  const at = { lat: site.lat, lng: site.lng };

  const [observed, normals] = await Promise.all([
    fetchObserved(at, scenario.window.start, scenario.window.end),
    fetchNormals(at),
  ]);

  if (!observed.ok || !normals.ok) {
    const refusal = observed.ok ? (normals as { refusal: Refusal }).refusal : observed.refusal;
    stages.push({
      stage: "weather",
      ok: false,
      refusal,
      note: "Falling back to the scenario's authored weather.",
    });
    return [];
  }

  const scored = scoreAnomalies(observed.data, normals.data);
  const derived = deriveWeatherEvents(scored, site.id, scenario.key);
  stages.push({
    stage: "weather",
    ok: true,
    note: `${derived.length} heat/rain drivers derived from real Open-Meteo observations against ${normals.data.yearsCovered}-year normals.`,
  });
  return derived;
}

/**
 * Drop world events whose geometry falls outside the trade area, and record
 * WHY each one survived or didn't, so the citation drawer can show a reader
 * that a closure two miles the wrong way was considered and rejected.
 */
function filterByPolygon(
  events: WorldEventRecord[],
  site: SiteRecord,
  tradeArea: TradeAreaRecord | null,
): { kept: WorldEventRecord[]; discarded: WorldEventRecord[] } {
  if (!tradeArea || site.lat === null || site.lng === null) {
    return { kept: events, discarded: [] };
  }
  const ring = tradeArea.polygonGeoJson.coordinates[0];
  // Bound locally so the nested predicate keeps the non-null narrowing.
  const minutes = tradeArea.minutes;
  const origin = { lat: site.lat, lng: site.lng };

  const kept: WorldEventRecord[] = [];
  const discarded: WorldEventRecord[] = [];

  for (const event of events) {
    if (survives(event)) kept.push(event);
    else discarded.push(event);
  }
  return { kept, discarded };

  function survives(event: WorldEventRecord): boolean {
    const at = event.meta?.["at"] as { lat: number; lng: number } | undefined;
    if (!at) {
      // No geometry on this event - it was authored for this address, or it is
      // sampled at the parcel itself. Keep it, and say that is why.
      event.polygonMembership = {
        ...event.polygonMembership,
        filtered: false,
        inside: true,
        reason:
          event.polygonMembership?.reason ??
          "No geometry attached; recorded against the parcel itself rather than a point on the street.",
      };
      return true;
    }

    const inside = pointInRing(at, ring);
    event.polygonMembership = {
      filtered: true,
      inside,
      distanceM: haversineMeters(origin, at),
      reason: inside
        ? `Inside the ${minutes}-minute drive polygon.`
        : `Outside the ${minutes}-minute drive polygon - considered, then discarded.`,
    };
    return inside;
  }
}

function loadLedger(
  site: SiteRecord,
  scenario: Scenario,
  liveWeather: WorldEventRecord[],
): LedgerDayRecord[] {
  const stored = ledgerDays.filter(
    (d) => d.siteId === site.id && d.scenarioKey === scenario.key,
  );
  if (stored.length > 0) {
    return stored.sort((a, b) => a.date.localeCompare(b.date));
  }

  const generated = generateLedger(scenario, liveWeather).map((d) => ({
    id: `${site.id}-${scenario.key}-${d.date}`,
    siteId: site.id,
    scenarioKey: scenario.key,
    date: d.date,
    tickets: d.tickets,
    basketSizeUsd: d.basketSizeUsd,
    revenueUsd: d.revenueUsd,
    adSpendUsd: d.adSpendUsd,
    grossMarginPct: d.grossMarginPct,
    source: "Square Orders API (seeded fixture)",
  }));
  ledgerDays.putMany(generated);
  return generated;
}
