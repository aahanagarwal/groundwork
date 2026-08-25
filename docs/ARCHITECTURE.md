# Architecture

```
                     ┌──────────────────┐
   address ─────────▶│  BUDGET BROKER   │  per-agent daily credit ceilings
                     │  cache-first     │  quote before spend
                     │  logs every call │  → the ledger (telemetry layer)
                     └────────┬─────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     ▼                        ▼                        ▼
┌───────────┐        ┌────────────────┐       ┌─────────────────┐
│ RESOLVER  │        │  WORLD INGEST  │       │  LEDGER INGEST  │
│ Mireye    │        │  weather (live)│       │  seeded till    │
│ /v1/lookup│        │  closures,     │       │  generated from │
│ → parcel  │        │  permits,      │       │  the same world │
│ → polygon │        │  competitors   │       │  events         │
│ (derived) │        │  filtered by ◀─┼───────┤                 │
└─────┬─────┘        │  the polygon   │       └────────┬────────┘
      │ typed        └───────┬────────┘                │
      │ refusal              │                         │
      └──────────┬───────────┴─────────────────────────┘
                 ▼
     ┌─────────────────────────────────────┐
     │   COUNTERFACTUAL ROUTER (local)     │  OSRM/MLD on an Austin OSM extract
     │   sever closed edges → P_closed     │  validated against Mireye by IoU
     └────────────────┬────────────────────┘
                      ▼
     ┌─────────────────────────────────────┐
     │      ATTRIBUTION ENGINE             │  ← deterministic, no model
     │  simultaneous partial effects       │
     │  confidence bands, honest ε         │
     │  saturated-window flag              │
     └────────────────┬────────────────────┘
                      ▼
     ┌─────────────────────────────────────┐
     │        NARRATOR (model, or template)│
     │  narrates the object; cannot        │
     │  assert an uncited number           │
     └────────────────┬────────────────────┘
                      ▼
     ┌─────────────┬───────────────┬────────────────┐
     │ ADVERTISING │  THREAT WATCH │  BRIEF          │
     └─────────────┴───────────────┴────────────────┘
                      ▼
            APPROVAL GATE - nothing auto-executes
```

## The join

Three ingest paths meet at **one parcel key and one date**. That join is the product; everything else is plumbing.

- The **ground** is stable for years and anchors the geography: parcel, drive polygon, terrain, access.
- The **world** is the moving ground: the closure, the storm, the concert, the competitor's permit.
- The **ledger** is the outcome.

Join all three and you can answer the one question no software answers.

---

## The physics engine

Groundwork's "physics" is a demand model with one exogenous term that is genuinely physical: **who can reach the door**. Three layers.

### 1. Reachability - the drive shed

Mireye has **no isochrone endpoint**. Verified against the live OpenAPI spec at `api.mireye.com/v1/openapi.json` (Mireye Earth 0.15.0): the four `/v1/proximity` ops return legs, rankings, screen verdicts and labor-shed scalars. `labor_shed` knows which census tracts sit inside a shed but returns only the summed counts, never tract ids or geometry. Nothing returns a polygon.

So the polygon is **derived, and labelled derived everywhere it appears**:

1. **Bracket.** Probe points on 16 compass bearings at 4 radii each (0.4, 1.2, 2.4, 4.0 mi). One `op: "screen"` call, parcel as the sole anchor. `screen` is the right op precisely because it does not discard failures - every non-survivor returns in `screened_out` carrying its own best duration, so one call yields a full distance→drive-time curve along all 16 bearings rather than a yes/no.
2. **Interpolate.** Per bearing, take the **outermost** in-budget probe and the next one past it, and interpolate where drive time crosses the target. Outermost, not first-crossing: drive time is not monotonic in straight-line distance - a probe can land on the wrong side of Lady Bird Lake at 1.2 mi and back on a fast arterial at 2.4 mi - and stopping at the first crossing clips the shed at the first obstacle rather than its real edge.
3. **Refine and self-check.** One probe per bearing at exactly the interpolated distance. The boundary becomes measured rather than inferred, and the gap between the predicted 8.0 minutes and the drive time actually found there is a **reported error figure**. The polygon carries its own error bar. Bearings where every probe came back in-budget are extrapolated outward instead, so a freeway bearing is not silently clipped at 4 miles.

80 probes, ~960 credits, computed **once per address and persisted forever**. That persistence is what makes a 90-day backtest cost the same as a one-day run.

The probe is **pluggable** (`DurationProbe`). The identical algorithm runs against Mireye and against local OSRM, which is what makes the IoU comparison meaningful: two polygons from one algorithm over two routing engines differ only because the engines disagree about the road network. Comparing a vendor isochrone against a home-made one would measure the algorithms; this measures the geography.

Measured against the **live Mireye API** on three real Austin parcels: **16.7–24.0 mi² against a 78 mi² five-mile circle (69–79% smaller)**, anisotropy 1.8–2.5×, mean boundary error **±0.48–0.89 min** against the 8-minute target, worst case ±3.13 min. 80 paid driving calls each, ~3.5s per polygon.

**The quote was exact.** Estimated 960 credits, actual 960, on all three - delta zero. That is the number that makes "credit-safe by construction" a claim rather than a hope.

### 2. Exposure - anomalies, never thresholds

A weather driver is an **anomaly against that coordinate's own 1991–2020 normals**, not a raw threshold. "It was 38 °C" is not a driver; Austin is 38 °C most of July. "It was 5.4 °C hotter than this date normally is" is a driver.

Normals are 30 years of daily ERA5 collapsed to day-of-year mean and standard deviation, smoothed ±7 days so one freak 14 July in 2003 doesn't define what 14 July is supposed to look like.

Two shape decisions, both deliberate:

- **Heat is a run, not a day.** The retail effect of a hot spell is cumulative - people stop going out on day four in a way they don't on day one - so consecutive anomalous days merge into one event. Entering them as independent daily dummies would let the regression average the effect away.
- **Rain is a day.** Its effect is not cumulative; a wet Tuesday and a wet Friday a fortnight apart are two separate shocks.

Magnitude is the normalised anomaly, capped at 1. It means "how much of this driver was present" - *not* "how bad was it for the shop". That second question is what the fitted coefficient answers, and conflating them is how you end up asserting your own assumptions back at yourself.

### 3. Attribution - the counterfactual

**No language model computes a number.** This is enforced structurally: the engine is pure functions in `lib/attribution/`, and the narrator receives the finished object.

**Baseline.** Trailing 28-day level × day-of-week factor, both fitted **only on days when nothing was happening**. The exclusion is the whole ballgame: a baseline fitted through the closure absorbs the closure, and the engine then confidently reports that nothing happened.

**Decomposition.** One regression of daily residuals on driver magnitude, all drivers entering **simultaneously** - not sequential subtraction - so each coefficient is a partial effect with the others held constant. Fitted over the **whole** series, not just the window being explained, because a driver is only separable from an overlapping one on the days where they differ. That is exactly how the heat spell and the competitor are told apart: the competitor persists after the heat breaks.

**Shrinkage, and why it is not just regularisation.** Plain least squares on indicator regressors forces residuals to sum to zero within each driver's own day-set. When the window being explained *is* that day-set - "why did tickets drop during the nine days the road was shut" - the drivers then account for exactly 100% of the movement as an accounting identity, and **ε comes out at 0.0 no matter what really happened**. This was a real bug, found by noticing that `unexplained` was suspiciously exactly `-0.0` in two independent scenarios.

The fix is a purposeful ridge penalty at 0.25 of the design's mean diagonal. Each coefficient shrinks toward zero in proportion to how little independent evidence supports it, and the shrunk-away weight **falls through to ε rather than being handed to whichever driver happened to be active**.

**Bands.** 95% intervals from the coefficient standard errors, scaled by how much of the driver fell inside the window. These are the SEs of the *shrunk* estimator: they describe where this estimator would land on repeated samples and do not include the bias the shrinkage deliberately introduces. Stated here rather than buried.

**Confidence** is a grade with its reasons written out in plain English, including a **saturated-window** flag when every day in the window had something happening - in which case the total is solid and the split between drivers is an estimate, and the brief says so in those words.

**ε is never redistributed.** It renders as a bar like any other, in the same units at the same scale, hatched so it reads differently but never smaller.

---

## Credit safety by construction

Every Mireye call goes through the Budget Broker, in this order:

1. **Cache.** A recorded response for this exact request body short-circuits everything. A hit is still recorded - hit rate is a headline metric.
2. **Quote.** Price the call from Mireye's published formula: `max(op_floor, 12 × paid_driving_calcs) + 1 per address-form locator`.
3. **Grant.** Per-agent, per-day ceilings. A denial is a typed `Refusal` the UI renders as a designed state, never a thrown error.
4. **Record.** Ledger row whatever happened: hit, miss, success, refusal, timeout.

Ceilings differ by agent because the agents differ in risk. Threat Watch runs unattended on a schedule and gets the tightest budget - nothing that runs while nobody is watching gets a large one. Every `/v1/proximity` call also carries `max_credits`, which Mireye checks *before* the driving matrix is charged, so belt and braces: the broker protects the daily total, `max_credits` protects the single request.

---

## Refusal is a first-class state

Mireye's `/v1/lookup` already refuses rather than guessing, returning `disposition: resolved | clarify | no_match`. We adopt that vocabulary wholesale instead of inventing a parallel one. A `clarify` comes back with up to three candidates to pick between; a `no_match` comes back with a reason. Neither is an error and neither renders as one.

The failure this guards against is not "no match found". It is a confident match on the wrong place - Mireye's own docs record `"1412 market street"` matching a town in West Virginia at confidence 1.0. That is why every address here carries its city and state, and why a coarse match is a refusal rather than a coordinate.

Without a key, the three seeded addresses fall back to hand-checked coordinates flagged `approximate: true` and shown as such in the masthead. **Every other address is refused.** We do not invent a location for an address we cannot resolve.

---

## Extension points

Everything is behind `DataSource<Req, Res>`, which returns `SourceResult<T>` - data with provenance, or a typed refusal. Swapping a fixture for a real client means writing one object with that shape.

| Today | Swap in | Where |
| --- | --- | --- |
| Seeded till | Square Orders, Shopify Admin, QuickBooks | `lib/pipeline.ts` → `loadLedger` |
| Scenario closures | Austin 511 / city open data | `lib/world/` |
| Scenario permits | Shovels API, PermitStack | `lib/world/` |
| Scenario competitors | Overture Places, Google Places | `lib/world/` |
| Draft ad payload | Meta Marketing API write path | `lib/modules/index.ts` |
| File store | Postgres | `lib/store.ts` - `backend()` |

The Prisma schema in `prisma/schema.prisma` is the shape of record for both backends.

## Validation: the local counterfactual against the authority

Both polygons are built by the **same** code over the same probe grid - only the routing engine differs - so the gap measures the road-network model, not two implementations. Run on the three real parcels:

| Site | Mireye | Local OSRM | IoU |
| --- | --- | --- | --- |
| Jo's Coffee | 16.72 mi² | 19.57 mi² | **0.844** |
| Radio Coffee & Beer | 23.98 mi² | 24.25 mi² | **0.773** |
| Franklin Barbecue | 23.74 mi² | 24.48 mi² | **0.905** |

Mean **0.84**. OSRM runs consistently a little wider, which is what you would expect from free-flow speeds on the stock car profile against durations that "reflect typical traffic" - OSRM does not model congestion, so it thinks you can get further in eight minutes.

Caveat worth stating: the OSRM polygons here were computed at hand-checked approximate coordinates, before the real parcel match existed. Radio Coffee's was ~600 m out, which is the likeliest reason it scores lowest. Recomputing OSRM at the resolved coordinates is free and would tighten the comparison.

## What the credits actually went on

| Operation | Estimated | Actual |
| --- | --- | --- |
| Resolve an address (`/v1/lookup`, `include_parcel`) | 300 | 300 |
| Site fields (`/v1/fetch`, 16 fields) | 16 | 16 |
| Trade area (80 probes, two passes) | 960 | 960 |

The resolve price was the surprise, and it was a real bug: the client estimated **5** credits and the true figure is **300**, because `include_parcel` buys a per-record-licensed county parcel. 900 of the first 3,828 credits went on three address resolutions nobody had priced. Now read from `GET /v1/meta/plans` and mirrored in `lib/mireye/credits.ts`.

**Parcel records are the real scarce resource**, capped at 80/month on Build separately from credits - the credit balance will look healthy long after the parcel allowance is gone.

## Known gaps

- **Pooled β across a validation cohort is not fitted yet.** Driver coefficients are estimated per-site from ~90 days, which cannot identify `β_closure` from a single closure event. The bikeshare cohort and held-out recovery MAE are specified but not built.
- **`ClosureImpact` via edge severing is designed, not wired.** The MLD pipeline makes it cheap (0.02 s re-customize); the closure→OSM-way mapping is the missing piece.
- **`labor_shed` is not called**, so reachable population is not reported. It is a separate paid op (25-credit floor plus routed tracts).
