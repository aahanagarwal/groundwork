import type { WorldEventRecord } from "@/lib/domain";
import type { WeatherAnomaly } from "./weather";
import type { Provenance } from "@/lib/datasource";

/**
 * Turns a scored weather series into driver rows the attribution engine can
 * regress on.
 *
 * The judgement calls here are deliberate and few:
 *
 *   · A driver is an ANOMALY, never a threshold. 38 degrees in Austin in July
 *     is Tuesday. A day is only a heat event if it is meaningfully hotter than
 *     that date normally is at this coordinate.
 *   · Heat is a RUN, not a day. The retail effect of a hot spell is cumulative
 *     - people stop going out on day four in a way they don't on day one - so
 *     consecutive hot days are merged into one event rather than entered as
 *     independent daily dummies, which would let the regression average the
 *     effect away.
 *   · Rain is a DAY. Its effect is not cumulative; a wet Tuesday and a wet
 *     Friday a fortnight apart are two separate shocks.
 *   · Magnitude is the normalised anomaly, capped at 1. It is what the
 *     regression's design matrix is scaled by, so it has to mean "how much of
 *     this driver was present", not "how bad was it for the shop" - that
 *     second question is what the fitted coefficient answers.
 */

/** Standard deviations above the day-of-year normal to count as a heat event. */
export const HEAT_Z_THRESHOLD = 1.0;
/** Minimum consecutive days. A single warm afternoon is not a heat spell. */
export const HEAT_MIN_RUN_DAYS = 2;
/** Millimetres in a day before rain plausibly moves a coffee shop's footfall. */
export const RAIN_MM_THRESHOLD = 5;

function provenanceFor(note: string): Provenance {
  return {
    source: "Open-Meteo historical archive (ERA5) vs 1991–2020 normals",
    sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
    fetchedAt: new Date().toISOString(),
    confidence: "high",
    mocked: false,
    note,
  };
}

export function deriveWeatherEvents(
  anomalies: WeatherAnomaly[],
  siteId: string,
  scenarioKey: string,
): WorldEventRecord[] {
  const events: WorldEventRecord[] = [];
  const sorted = [...anomalies].sort((a, b) => a.date.localeCompare(b.date));

  // --- Heat: merge consecutive anomalous days into one spell ---------------
  let run: WeatherAnomaly[] = [];
  const flushRun = () => {
    if (run.length >= HEAT_MIN_RUN_DAYS) {
      const zs = run.map((d) => d.heatZ ?? 0);
      const meanZ = zs.reduce((s, v) => s + v, 0) / zs.length;
      const peak = Math.max(...run.map((d) => d.apparentMaxC ?? 0));
      const meanAnomaly =
        run.reduce((s, d) => s + (d.heatAnomalyC ?? 0), 0) / run.length;

      events.push({
        id: `${siteId}-heat-${run[0].date}`,
        siteId,
        scenarioKey,
        kind: "heat",
        label: `Heat spell, ${run.length} days averaging ${meanAnomaly.toFixed(1)}C above normal`,
        startDate: run[0].date,
        endDate: run[run.length - 1].date,
        // Two standard deviations is treated as a full-strength heat driver.
        magnitude: Math.min(1, meanZ / 2),
        enabled: true,
        source: "Open-Meteo (ERA5) vs 1991–2020 normals",
        sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
        meta: {
          days: run.length,
          peakApparentMaxC: Number(peak.toFixed(1)),
          meanAnomalyC: Number(meanAnomaly.toFixed(2)),
          meanZ: Number(meanZ.toFixed(2)),
          normalForPeriodC: Number((run[0].normalApparentMaxC ?? 0).toFixed(1)),
        },
        polygonMembership: {
          filtered: false,
          inside: true,
          distanceM: 0,
          reason:
            "Weather is sampled at the parcel centroid, so it is inside the trade area by construction - no spatial filter applies.",
        },
        provenance: provenanceFor(
          `${run.length}-day spell, mean ${meanZ.toFixed(2)} SD above the 30-year normal for these dates`,
        ),
      });
    }
    run = [];
  };

  for (const day of sorted) {
    if ((day.heatZ ?? 0) >= HEAT_Z_THRESHOLD) run.push(day);
    else flushRun();
  }
  flushRun();

  // --- Rain: one event per wet day -----------------------------------------
  for (const day of sorted) {
    const mm = day.precipitationMm ?? 0;
    if (mm < RAIN_MM_THRESHOLD) continue;
    events.push({
      id: `${siteId}-rain-${day.date}`,
      siteId,
      scenarioKey,
      kind: "rain",
      label: `Rain, ${mm.toFixed(1)}mm`,
      startDate: day.date,
      endDate: day.date,
      // 25mm - an inch - is treated as a full-strength rain driver.
      magnitude: Math.min(1, mm / 25),
      enabled: true,
      source: "Open-Meteo (ERA5)",
      sourceUrl: "https://open-meteo.com/en/docs/historical-weather-api",
      meta: {
        precipitationMm: mm,
        normalForDateMm: Number((day.normalPrecipitationMm ?? 0).toFixed(2)),
        anomalyMm: Number((day.precipitationAnomalyMm ?? 0).toFixed(2)),
      },
      polygonMembership: {
        filtered: false,
        inside: true,
        distanceM: 0,
        reason:
          "Sampled at the parcel centroid - inside the trade area by construction.",
      },
      provenance: provenanceFor(`${mm.toFixed(1)}mm at the parcel centroid`),
    });
  }

  return events.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
