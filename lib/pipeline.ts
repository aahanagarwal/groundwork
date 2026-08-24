import {
  attribute,
  type AttributionEvent,
  type AttributionResult,
} from "@/lib/attribution/decompose";
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
import { loadScenario, loadScenarios, type Scenario } from "@/lib/scenarios";
import { haversineMeters, pointInRing } from "@/lib/geo";
import { deriveWeatherEvents } from "@/lib/world/derive-events";
import {
  fetchNormals,
  fetchObserved,
  scoreAnomalies,
} from "@/lib/world/weather";

/**
 * THE PIPELINE — one function that walks the whole diagram.
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
      ? "Seeded coordinate — no Mireye key present, so this is not a parcel match."
      : `Parcel matched via ${site.matchMethod ?? "Mireye /v1/lookup"}.`,
  });

  // --- 2. TRADE AREA --------------------------------------------------------
  const tradeArea = await ensureTradeArea(site, stages);

  // --- 3. WORLD INGEST ------------------------------------------------------
  const scenarioEvents = loadScenarioEvents(site, scenario);
  const liveWeatherEvents = await loadLiveWeather(site, scenario, stages);

  // Scenario weather is a stand-in for the live feed. When the live feed
  // answers, it wins — but only for the kinds it actually covers, so a
  // scenario's road closure and competitor survive.
  const weatherKinds = new Set(["heat", "rain"]);
  const events = [
    ...scenarioEvents.filter(
      (e) => !(liveWeatherEvents.length > 0 && weatherKinds.has(e.kind)),
    ),
    ...liveWeatherEvents,
  ]
    .filter((e) => e.enabled)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const filtered = filterByPolygon(events, site, tradeArea);
  stages.push({
    stage: "world_ingest",
    ok: true,
    note:
      `${filtered.length} of ${events.length} drivers kept` +
      (tradeArea
        ? ` after filtering to the ${tradeArea.minutes}-minute polygon.`
        : " (no polygon yet, so nothing was spatially filtered)."),
  });

  // --- 4. LEDGER ------------------------------------------------------------
  const ledger = loadLedger(site, scenario, liveWeatherEvents);
  stages.push({
    stage: "ledger",
    ok: true,
    note: `${ledger.length} days of till data (seeded — Square/QuickBooks are not connected in this build).`,
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
        message:
          "No till data for this site and scenario, so there is nothing to explain.",
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
      scenarios: loadScenarios().map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
      })),
      tradeArea,
      events: filtered,
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
 * which — a polygon never pretends to be from an engine that didn't draw it.
 */
async function ensureTradeArea(
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

  // Both engines' polygons are kept side by side — the OSRM one is the
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
      note: `Persisted ${existing.engine} polygon from ${existing.computedAt.slice(0, 10)} — no credits spent on this view.`,
    });
    return existing;
  }

  const origin = { lat: site.lat, lng: site.lng };
  const useMireye = config.mireye.mode !== "replay";
  const probe = useMireye ? mireyeProbe("isochrone", site.id) : osrmProbe();
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
    const fallback = await buildIsochrone(
      origin,
      TRADE_AREA_MINUTES,
      osrmProbe(),
      {
        naiveRadiusMiles: NAIVE_RADIUS_MILES,
        engineLabel: "local OSRM (Austin extract)",
      },
    );
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

function loadScenarioEvents(
  site: SiteRecord,
  scenario: Scenario,
): WorldEventRecord[] {
  const stored = worldEvents.filter(
    (e) => e.siteId === site.id && e.scenarioKey === scenario.key,
  );
  if (stored.length > 0) return stored;

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
      note: "Scenario fixture — stands in for a live permit / 511 / events feed.",
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
    const refusal = observed.ok
      ? (normals as { refusal: Refusal }).refusal
      : observed.refusal;
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
): WorldEventRecord[] {
  if (!tradeArea || site.lat === null || site.lng === null) return events;
  const ring = tradeArea.polygonGeoJson.coordinates[0];

  return events.filter((event) => {
    const at = event.meta?.["at"] as { lat: number; lng: number } | undefined;
    if (!at) {
      // No geometry on this event — it was authored for this address, or it is
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
      distanceM: haversineMeters({ lat: site.lat!, lng: site.lng! }, at),
      reason: inside
        ? `Inside the ${tradeArea.minutes}-minute drive polygon.`
        : `Outside the ${tradeArea.minutes}-minute drive polygon — discarded rather than passed downstream.`,
    };
    return inside;
  });
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
