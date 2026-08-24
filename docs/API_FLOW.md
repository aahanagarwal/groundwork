# API flow

Every route this app exposes, and exactly how the two external integrations are called.

## Internal routes

| Route               | Method | Purpose                                                       |
| ------------------- | ------ | ------------------------------------------------------------- |
| `/`                 | page   | Address picker. Three seeded Austin addresses.                |
| `/site/[slug]`      | page   | The consultant surface. `?scenario=` switches scenario.       |
| `/ops`              | page   | Instrumentation. Credits, cache, refusals, method disclosure. |
| `/api/stats`        | GET    | The stat sheet as JSON.                                       |
| `/api/actions/[id]` | POST   | The approval gate.                                            |

### `POST /api/actions/[id]`

```jsonc
// request
{ "decision": "approved" }          // or "rejected"

// response
{
  "action": { "id": "…", "status": "approved", "decidedAt": "2026-08-20T…" },
  "dispatched": false,
  "note": "Recorded in Groundwork only. Nothing was sent to any external platform."
}
```

`dispatched` is hardcoded `false` and is not a placeholder for a future `true` in this build. No credential exists here that could post to an ad platform, place an order or publish anything. Approving marks a draft approved and stops.

Returns `400` if `decision` is not one of the two literals, `404` if no such action.

### `GET /api/stats`

Aggregates the call ledger. Reports `mode` (which secrets are present, which backend answered), `totals` (calls, cache hit rate, credits, refusal rate, decisions per call), `endpoints` (per-endpoint calls/cache/refusals/credits/mean and p95 latency), `refusalsByCode`, `budgets` (per-agent ceiling and spend today), `decisions`, and `tradeAreas` — including `creditsDelta`, estimate versus actual, which is the figure that says whether the quote can be trusted.

---

## Mireye Earth

Base `https://api.mireye.com`. Auth `Authorization: Bearer $MIREYE_API_KEY`. No query-parameter keys, no custom headers.

All calls route through `lib/mireye/client.ts` → cache → quote → broker → record. There is no second path.

### `POST /v1/lookup` — the resolver entry point

```jsonc
{ "input": "1300 S Congress Ave, Austin, TX 78704", "include_parcel": true }
```

Returns `disposition: resolved | clarify | no_match`. On `resolved`: coordinate, `resolved_address`, `county_fips`, `tract_geoid`, `cbsa_name`, `timezone`, `elevation_m`, `fema_flood_zone`, a `county_market` block of ten federal metrics, and a `parcel` object carrying `geometry_wkt` — which is what puts a real parcel outline on the map.

Mapped directly onto our `Refusal` type. `clarify` carries up to three `candidates`, rendered as a "did you mean" list; `no_match` carries a `reason`. **We do not build a parallel refusal vocabulary.**

Estimated at 5 credits.

### `POST /v1/proximity` (`op: "screen"`) — the trade area

```jsonc
{
  "op": "screen",
  "origins": ["30.2515,-97.7494", "…"], // 64 probes, then 16
  "anchors": ["30.251500,-97.749400"],
  "max_minutes": 8,
  "max_credits": 1200,
}
```

Coordinate locators only — never addresses. Coordinates skip Mireye's geocoding gate and cost no extra credit; an address locator adds one credit each and risks a confident match on the wrong place.

`screen` rather than `distance` because it returns the near misses: `screened_out` carries each non-survivor's own best duration, which is exactly the data the boundary interpolation needs. Same matrix, same price, strictly more information.

Priced at `max(5, 12 × origins × anchors)`. Two passes: 64 probes then 16 = 80 driving calcs ≈ **960 credits**, once per address, persisted forever.

`max_credits` is sent on every call. Mireye checks it _before_ charging the driving matrix, so an accidental 500-probe request returns a priced 422 rather than a bill.

### `POST /v1/fetch` — site fields

Sixteen catalogue fields chosen for a food-and-beverage address: `nearest_cafe_distance_m`, `nearest_restaurant_*`, `poi_count_1km`, `nearest_school_distance_m` (the dossier's "school lets out at 14:30" is real data), `nearest_major_road_*`, `tract_population`, `county_median_household_income`.

Each field arrives with its own `source`, `source_url`, `confidence` and `dataset_vintage` — which is why citation is cheap here: our `Provenance` type mirrors that shape. A failed fetch is **not fatal**; the parcel still resolved.

### Error handling

Mireye's envelope is `{"detail": {"error", "message", "retryable"}}`. Mapped code-for-code, with a caller-facing hint attached for the ones a demo operator will actually hit: `address_too_coarse`, `address_not_found`, `address_form_unsupported`, `low_confidence_resolution`, `shed_too_large`, `proximity_request_exceeds_budget_share`, `geocode_budget_exhausted`.

Rate limits: V1 has no metered request quotas — the constraint is credits, which is what the broker governs. Timeouts: 130 s for `/v1/ask` (server-bounded at 110 s; the docs are explicit that a short client timeout aborts requests that keep running _and billing_), 70 s for `/v1/fetch`.

---

## Open-Meteo

`https://archive-api.open-meteo.com/v1/archive`. No key, no auth, no budget-broker involvement — but still logged, so the ledger is a complete record rather than a Mireye-only one.

Two calls per site, both cached to disk keyed by coordinate:

- observed daily `apparent_temperature_max`, `temperature_2m_max`, `precipitation_sum` for the window
- `1991-01-01` → `2020-12-31` at the same coordinate, collapsed into day-of-year normals

Normals do not change, so re-downloading eleven thousand days per page load would be silly.

---

## OpenAI

Called from exactly one place: `lib/agent/narrate.ts`.

Model ids are env-configurable — `OPENAI_MODEL` (`gpt-5.6-sol`, planner and narration), `OPENAI_MODEL_MODULES` (`gpt-5.6-terra`), `OPENAI_MODEL_CHEAP` (`gpt-5.6-luna`).

The system prompt states the constraints as absolutes:

1. Narrate **only** the attribution object provided. Do not compute, estimate or state any number, percentage or dollar figure not already in it.
2. Do not assert a causal claim the object does not support. If a driver's band crosses zero, say it may have done nothing.
3. If ε is large or the window is flagged saturated, say so plainly. "I can't fully explain this one" is the required framing.
4. Never say "caused". Say "accounts for", "consistent with", "lines up with".

The user message carries the attribution object, the filtered world events, site metadata, and **the deterministic template's output as a reference narration** — factually correct, not to be contradicted, only to be improved for readability.

Two safeguards behind that: the template renders if the model is absent, errors or times out, so a model outage never takes down the brief; and the UI shows **who wrote the sentences you are reading** ("written by template" / "written by gpt-5.6-sol"), because a reader is entitled to know.
