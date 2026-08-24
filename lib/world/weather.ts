import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Provenance, SourceResult } from "@/lib/datasource";
import { ok, refuse } from "@/lib/datasource";
import { record } from "@/lib/telemetry/ledger";
import type { LatLng } from "@/lib/geo";

/**
 * WEATHER — the one world-layer source that is genuinely real in this build.
 *
 * Open-Meteo needs no key and no payment, so there was no reason to mock it.
 * Two calls:
 *   · the observed daily series for the window being explained
 *   · a 1991–2020 daily archive at the same coordinate, collapsed into
 *     day-of-year normals
 *
 * The second one is what makes the first mean anything. "It was 38 degrees"
 * is not a driver — Austin is 38 degrees most of July. "It was 4.1 degrees
 * hotter than this date normally is" is a driver. Every weather event this
 * module emits is an ANOMALY against that location's own thirty-year normal,
 * never a raw threshold.
 *
 * Both responses are cached to disk keyed by coordinate, because normals do
 * not change and re-downloading eleven thousand days on every page load would
 * be silly.
 */

const CACHE_DIR = path.join(process.cwd(), "data", "fixtures", "world");
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

/** The reference period WMO uses for climate normals. */
const NORMALS_START = "1991-01-01";
const NORMALS_END = "2020-12-31";

export interface DailyWeather {
  date: string;
  /** Apparent temperature (heat index) daily max, Celsius. */
  apparentMaxC: number | null;
  airMaxC: number | null;
  precipitationMm: number | null;
}

export interface WeatherAnomaly extends DailyWeather {
  /** Day-of-year normal for this location, from 1991–2020. */
  normalApparentMaxC: number | null;
  normalPrecipitationMm: number | null;
  /** Observed minus normal, in Celsius. Positive = hotter than usual. */
  heatAnomalyC: number | null;
  /** Standard deviations above the day-of-year mean. */
  heatZ: number | null;
  precipitationAnomalyMm: number | null;
  precipitationZ: number | null;
}

function cacheFile(kind: string, at: LatLng, suffix: string): string {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(
    CACHE_DIR,
    `${kind}-${at.lat.toFixed(3)}_${at.lng.toFixed(3)}-${suffix}.json`,
  );
}

function provenance(note: string, cached: boolean): Provenance {
  return {
    source: "Open-Meteo historical archive (ERA5)",
    sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
    fetchedAt: new Date().toISOString(),
    confidence: "high",
    // Genuinely live data, not a fixture — this one is real.
    mocked: false,
    note: cached ? `${note} · served from local cache` : note,
  };
}

interface ArchiveResponse {
  daily?: {
    time: string[];
    apparent_temperature_max?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    precipitation_sum?: (number | null)[];
  };
  error?: boolean;
  reason?: string;
}

async function archive(
  at: LatLng,
  start: string,
  end: string,
  cacheKey: string,
  kind: string,
): Promise<SourceResult<DailyWeather[]>> {
  const file = cacheFile(kind, at, cacheKey);
  const started = Date.now();

  if (existsSync(file)) {
    try {
      const rows = JSON.parse(readFileSync(file, "utf8")) as DailyWeather[];
      record({
        agent: "world_ingest",
        endpoint: "open-meteo/archive",
        mode: "cache",
        cacheHit: true,
        creditsEstimated: 0,
        creditsActual: 0,
        durationMs: Date.now() - started,
        refused: false,
        fieldsReturned: ["apparent_temperature_max", "precipitation_sum"],
      });
      return ok(rows, provenance(`${start} to ${end}`, true));
    } catch {
      // A corrupt cache file is a cache miss, not a failure.
    }
  }

  const url =
    `${ARCHIVE}?latitude=${at.lat}&longitude=${at.lng}` +
    `&start_date=${start}&end_date=${end}` +
    `&daily=apparent_temperature_max,temperature_2m_max,precipitation_sum` +
    `&timezone=America%2FChicago`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    record({
      agent: "world_ingest",
      endpoint: "open-meteo/archive",
      mode: "live",
      cacheHit: false,
      creditsEstimated: 0,
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: "network_error",
    });
    return refuse({
      code: "network_error",
      message:
        error instanceof Error ? error.message : "Open-Meteo did not respond.",
      retryable: true,
      hint: "Weather is the only live third-party feed in this build; without it, heat and rain drivers are unavailable and the engine will say so.",
    });
  }

  const body = (await response.json()) as ArchiveResponse;

  if (!response.ok || body.error || !body.daily) {
    record({
      agent: "world_ingest",
      endpoint: "open-meteo/archive",
      mode: "live",
      cacheHit: false,
      creditsEstimated: 0,
      durationMs: Date.now() - started,
      httpStatus: response.status,
      refused: true,
      refusalCode: "open_meteo_error",
    });
    return refuse({
      code: "open_meteo_error",
      message: body.reason ?? `Open-Meteo returned ${response.status}.`,
      retryable: response.status >= 500,
    });
  }

  const rows: DailyWeather[] = body.daily.time.map((date, i) => ({
    date,
    apparentMaxC: body.daily?.apparent_temperature_max?.[i] ?? null,
    airMaxC: body.daily?.temperature_2m_max?.[i] ?? null,
    precipitationMm: body.daily?.precipitation_sum?.[i] ?? null,
  }));

  writeFileSync(file, JSON.stringify(rows));
  record({
    agent: "world_ingest",
    endpoint: "open-meteo/archive",
    mode: "live",
    cacheHit: false,
    creditsEstimated: 0,
    creditsActual: 0,
    durationMs: Date.now() - started,
    httpStatus: response.status,
    refused: false,
    fieldsReturned: ["apparent_temperature_max", "precipitation_sum"],
  });

  return ok(rows, provenance(`${start} to ${end}`, false));
}

export function fetchObserved(at: LatLng, start: string, end: string) {
  return archive(at, start, end, `${start}_${end}`, "observed");
}

export interface Normals {
  /** Keyed by MM-DD. */
  byDayOfYear: Record<
    string,
    {
      apparentMaxMean: number;
      apparentMaxSd: number;
      precipMean: number;
      precipSd: number;
    }
  >;
  yearsCovered: number;
}

/**
 * Thirty years of daily archive collapsed to day-of-year mean and standard
 * deviation, smoothed with a +/-7 day window so a single freak 14 July in 2003
 * doesn't define what 14 July is supposed to look like.
 */
export async function fetchNormals(at: LatLng): Promise<SourceResult<Normals>> {
  const file = cacheFile("normals", at, "1991-2020");
  if (existsSync(file)) {
    try {
      return ok(
        JSON.parse(readFileSync(file, "utf8")) as Normals,
        provenance("1991–2020 day-of-year normals", true),
      );
    } catch {
      /* fall through and refetch */
    }
  }

  const history = await archive(
    at,
    NORMALS_START,
    NORMALS_END,
    "1991-2020-raw",
    "normals-raw",
  );
  if (!history.ok) return refuse(history.refusal);

  // Bucket every observation by calendar day, then widen each bucket by a
  // week either side.
  const buckets = new Map<string, { apparent: number[]; precip: number[] }>();
  for (const row of history.data) {
    const key = row.date.slice(5); // MM-DD
    if (!buckets.has(key)) buckets.set(key, { apparent: [], precip: [] });
    const b = buckets.get(key)!;
    if (row.apparentMaxC !== null) b.apparent.push(row.apparentMaxC);
    if (row.precipitationMm !== null) b.precip.push(row.precipitationMm);
  }

  const keys = [...buckets.keys()].sort();
  const byDayOfYear: Normals["byDayOfYear"] = {};

  keys.forEach((key, idx) => {
    const apparent: number[] = [];
    const precip: number[] = [];
    for (let offset = -7; offset <= 7; offset++) {
      const neighbour = keys[(idx + offset + keys.length) % keys.length];
      const b = buckets.get(neighbour);
      if (!b) continue;
      apparent.push(...b.apparent);
      precip.push(...b.precip);
    }
    byDayOfYear[key] = {
      apparentMaxMean: mean(apparent),
      apparentMaxSd: sd(apparent),
      precipMean: mean(precip),
      precipSd: sd(precip),
    };
  });

  const normals: Normals = { byDayOfYear, yearsCovered: 30 };
  writeFileSync(file, JSON.stringify(normals));
  return ok(normals, provenance("1991–2020 day-of-year normals", false));
}

/** Joins observations to normals and scores the anomaly. */
export function scoreAnomalies(
  observed: DailyWeather[],
  normals: Normals,
): WeatherAnomaly[] {
  return observed.map((row) => {
    const norm = normals.byDayOfYear[row.date.slice(5)];
    if (!norm) {
      return {
        ...row,
        normalApparentMaxC: null,
        normalPrecipitationMm: null,
        heatAnomalyC: null,
        heatZ: null,
        precipitationAnomalyMm: null,
        precipitationZ: null,
      };
    }
    const heatAnomalyC =
      row.apparentMaxC === null
        ? null
        : row.apparentMaxC - norm.apparentMaxMean;
    const precipitationAnomalyMm =
      row.precipitationMm === null
        ? null
        : row.precipitationMm - norm.precipMean;
    return {
      ...row,
      normalApparentMaxC: norm.apparentMaxMean,
      normalPrecipitationMm: norm.precipMean,
      heatAnomalyC,
      heatZ:
        heatAnomalyC === null || norm.apparentMaxSd === 0
          ? null
          : heatAnomalyC / norm.apparentMaxSd,
      precipitationAnomalyMm,
      precipitationZ:
        precipitationAnomalyMm === null || norm.precipSd === 0
          ? null
          : precipitationAnomalyMm / norm.precipSd,
    };
  });
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((s, v) => s + v, 0) / values.length;
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1),
  );
}
