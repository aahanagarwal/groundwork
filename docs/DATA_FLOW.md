# Data flow

One address, traced end to end, with the real shape at each hop. Numbers below are an actual run of `npx tsx scripts/check-pipeline.ts` with no Mireye key present.

**Input:** `jos-coffee` → `1300 S Congress Ave, Austin, TX 78704`, scenario `road-closure-dip`.

---

## 1. Resolve

`resolveSite(slug)` → Mireye `/v1/lookup`.

With a key this returns a parcel-grade coordinate, `geometry_wkt` for the outline, county/tract/CBSA, flood zone and `county_market`. Without one it refuses `no_api_key`, and only for the three seeded addresses does it fall back:

```jsonc
{
  "slug": "jos-coffee",
  "resolved": true,
  "disposition": "resolved",
  "lat": 30.2515, "lng": -97.7494,
  "matchMethod": "seeded_fallback",
  "approximate": true,                     // ← surfaced in the masthead
  "provenance": {
    "location": {
      "source": "Groundwork seeded coordinate (no Mireye key present)",
      "confidence": "low",
      "mocked": true,
      "note": "Hand-checked approximate rooftop coordinate. NOT a parcel match."
    }
  }
}
```

Any address that is *not* one of the three is refused outright. We do not invent a location.

## 2. Trade area

`ensureTradeArea` checks the store first - a persisted polygon costs nothing and the stage note says so. On a miss it runs the two-pass builder.

```
trade area: osrm  19.6 sq mi  vs 78 sq mi circle
80 probes, boundary accurate to 0.53 min on average
```

```jsonc
{
  "engine": "osrm",                        // "mireye" when a key is present
  "minutes": 8,
  "areaSqMi": 19.57, "naiveAreaSqMi": 78.5,
  "probesTested": 80, "paidDrivingCalcs": 0,
  "accuracyMeanErrorMinutes": 0.53,
  "accuracyMaxErrorMinutes": 1.72,
  "polygonGeoJson": { "type": "Polygon", "coordinates": [[ /* 17 points */ ]] },
  "method": "Derived, not vendor-supplied. 16 bearings x 4 bracketing radii …"
}
```

Per-bearing detail is kept for the methodology drawer. Jo's reaches **1.50 mi east** (I-35) and **3.60 mi south-southwest** (open S Congress corridor) - a 2.4× anisotropy that a circle cannot express.

## 3. World ingest

Weather is fetched **before** the ledger, because the ledger is generated from it.

```
weather: 18 heat/rain drivers derived from real Open-Meteo observations
         against 30-year normals
```

Real Austin 2026: the hottest day in the window was **22 July at 43.5 °C apparent max against a 38.1 °C normal - +5.4 °C, 2.45 SD**.

```jsonc
{
  "kind": "rain",
  "label": "Rain, 24.9mm",
  "startDate": "2026-07-14", "endDate": "2026-07-14",
  "magnitude": 1.0,                        // 25mm = full-strength rain driver
  "source": "Open-Meteo (ERA5)",
  "meta": { "precipitationMm": 24.9, "normalForDateMm": 1.94, "anomalyMm": 22.96 },
  "polygonMembership": {
    "filtered": false, "inside": true, "distanceM": 0,
    "reason": "Sampled at the parcel centroid - inside the trade area by construction."
  },
  "provenance": { "mocked": false, "confidence": "high", "…": "…" }
}
```

Scenario events (the closure, the competitor) join here and are filtered against the polygon. **Every row records why it survived or didn't**, so the citation drawer can show a reader that a closure two miles the wrong way was considered and rejected - not merely absent.

```
world_ingest: 20 of 20 drivers kept after filtering to the 8-minute polygon
```

## 4. Ledger

Generated from the baseline spec **plus the real weather drivers**, each scaled by the scenario's response coefficient, plus `hiddenEvents` that no feed carries.

```jsonc
{ "date": "2026-07-09", "tickets": 172, "basketSizeUsd": 9.31,
  "revenueUsd": 1601.32, "adSpendUsd": 48, "grossMarginPct": 0.62,
  "source": "Square Orders API (seeded fixture)" }
```

## 5. Attribution

```
ATTRIBUTION 2026-07-06..2026-07-14   -22.0%   confidence medium

  S Congress Ave resurfacing …            -17.4 pts  [-22.1 .. -12.7]
  Rain, 24.9mm                             -1.3 pts  [ -2.8 ..   0.1]
  Rain, 10.0mm                             -0.7 pts  [ -1.7 ..   0.4]
  Rain, 11.9mm                             -0.3 pts  [ -1.4 ..   0.9]
  unexplained                              -2.2 pts
```

```jsonc
{
  "computedAt": "2026-08-20T…",
  "observedTickets": 1590, "baselineTickets": 2038, "deltaPct": -22.0,
  "unexplainedPoints": -2.2,
  "basketSizeDeltaPct": 0.2,               // flat → reach, not price
  "confidence": "medium",
  "confidenceReasons": [
    "9-day window - long enough to see a pattern.",
    "50 quiet days available to set the baseline against.",
    "The drivers track the day-to-day movement (R² 0.72).",
    "10% of the movement is unaccounted for.",
    "Something was happening on every single day of this window, so there are no quiet days inside it to check the drivers against. Treat the total as solid and the split between drivers as an estimate."
  ],
  "diagnostics": { "rSquared": 0.72, "ridge": …, "saturatedWindow": true, … }
}
```

The 2.2 unexplained points are **real**: the scenario hides a three-day espresso grinder failure that no permit, forecast or feed carries. The engine cannot see it, does not attribute it, and reports it as unexplained. That is the design working.

### Why the split moved when weather went live

Originally the scenario authored its own rain on 9–10 July. Austin's actual 2026 weather had none then - it rained 11–16 July. Running the live feed against a ledger built from *authored* rain gave the closure **−20.8 pts** and the real rain days ~0, because they lined up with nothing.

The fix was not to reconcile the numbers but to remove the contradiction: scenarios no longer author weather at all. They declare a response coefficient, and the drivers come from Open-Meteo. Ledger and world layer are now built from the same observations, and the split fell to a defensible **−17.4 / −1.3 / −0.7 / −0.3 / ε −2.2**.

## 6. Modules, then the gate

`advertisingModule` reads the attribution object and the persisted polygon:

```jsonc
{
  "module": "advertising",
  "title": "Move $177 of ad budget off the closed approach",
  "costUsd": 177, "expectedValueUsd": 177, "horizon": "9 days",
  "requiresApproval": true, "status": "pending",
  "payload": {
    "_warning": "DRAFT ONLY. Never submitted to any ad platform.",
    "platform": "meta.marketing.v21",
    "campaign": { "status": "PAUSED", "spend_cap_cents": 17700 },
    "targeting": { "geo_locations": { "custom_locations": [
      { "name": "8-min drive area, Jo's Coffee", "polygon": [ /* 17 vertices */ ] }
    ]}}
  },
  "evidence": [ /* closure permit, trade area, derivation */ ]
}
```

**Expected value equals the recovered spend, and nothing more.** The tempting version divides total tickets by total ad spend - that credits every walk-in and regular to the ad account and produced a $3,800 return on a $177 move on the first pass. We hold no click data, no matched conversions and no holdout, so we cannot say what share of tickets ads drive, and we do not guess. What we *can* say is that budget aimed at a severed approach returns zero at any conversion rate.

`threatWatchModule` produces an alert, `requiresApproval: false` - alerts are not spend and fire without asking anyone.

## 7. Narration

The narrator receives the finished object. Every figure below was already in it:

> **Your Saturdays aren't broken. The closure took 17 of the 22 points.**
>
> Ticket count fell 22.0% from Jul 6 to Jul 14 - 1,590 against an expected 2,038. That expectation comes from your own quiet days, not an industry average.
>
> […] 2.2 points - 10% of the move - we cannot account for. No permit, forecast or feed we hold covers it. That is the part worth checking inside the shop.
>
> One caveat you should hear: something was happening on every single day of this window, so there are no quiet days inside it to check the drivers against. The total is solid. The split between the drivers is an estimate.
>
> Basket size held flat at +0%. The people who reached you spent what they always spend. This was reach, not price - so discounting would be answering a question nobody asked.

## 8. Stage report

Every stage reports independently, and a failure stops only what depends on it:

```
ok   resolve        Seeded coordinate - no Mireye key present, not a parcel match.
ok   trade_area     Drawn from 80 probes; boundary accurate to 0.53 min on average.
ok   weather        18 heat/rain drivers from real observations vs 30-year normals.
ok   world_ingest   20 of 20 drivers kept after filtering to the 8-minute polygon.
ok   ledger         90 days of till data (seeded).
ok   attribution    -22.0% against baseline over 9 days, confidence medium.
```

A missing permit feed must not take down the revenue chart, and it doesn't.
