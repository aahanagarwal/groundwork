# Groundwork

**An autonomous business consultant that explains and steers a local business's revenue using the physical facts of its address.**

A small business owner sees one number at close of day. They control two of its four hidden factors — conversion and basket size. The other two, how many people could physically reach them today and how much they wanted the category today, are exogenous and publicly measurable from road networks, weather and events.

Groundwork's whole value is constructing the counterfactual: what today would have looked like had the street behaved normally. Everything in this repo exists to answer, with a citation on every claim: **was that me, or was that the street?**

---

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3400>. **No secrets are required to run the demo.** Without keys the app runs in a degraded but honest mode — see "What's real vs mocked" below. Nothing is silently faked.

### Optional configuration

Copy `.env.example` to `.env` and fill in what you have:

| Variable         | Effect if absent                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MIREYE_API_KEY` | Mireye calls replay from the **recorded fixtures already in this repo** — real parcels and real polygons, at zero cost — and refuse for anything not recorded. The trade area falls back to the local OSRM router and labels itself accordingly. |
| `OPENAI_API_KEY` | The brief is written by a deterministic template instead of a model. The template is the reference the model version is judged against, so this is a floor, not a failure.                                                                       |
| `DATABASE_URL`   | State is written to JSON files under `data/store/` instead of Postgres. Same shapes, same keys.                                                                                                                                                  |

The demo city is Austin, TX, with three seeded food-and-beverage addresses. Switch scenarios from the header of any site page.

### Recording fresh Mireye data

Everything the demo needs is already recorded, so this is only for new addresses:

```bash
npm run mireye:resolve            # ~316 credits per address (300 is the parcel)
npm run mireye:isochrone <slug>   # 960 credits per trade area
npm run mireye:iou                # free — local OSRM vs Mireye, by IoU
```

Costs are exact, not estimates — the quoter has been checked against the bill and matches to the credit. A parcel also consumes one of 80 monthly parcel records, which runs out well before the credits do.

### The local router

Phase 4's counterfactual runs on a local OSRM graph over an Austin OSM extract.

```bash
brew install osrm-backend osmium-tool
osrm-routed --algorithm mld --port 5010 data/osm/Austin.osrm
```

The graph itself is built once with `osrm-extract` → `osrm-partition` → `osrm-customize`. The MLD pipeline matters: `osrm-customize` re-runs in about 0.02 seconds, so closing a road for a counterfactual is effectively instant rather than a graph rebuild.

---

## What's real vs mocked

The distinction is visible in the product, not just in this file. Every cited value carries a badge — filled for live sources, hollow for fixtures — and clicking any number opens the full provenance record.

| Layer                                                          | Source                                      | Status                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Ground** — parcel, county, tract, flood zone, market context | Mireye `/v1/lookup`                         | **Real, recorded.** Genuine parcel ids, boundary geometry, Austin zoning codes and Travis County market data for all three addresses. |
| **Ground** — drive-time trade area                             | Mireye `/v1/proximity` `op: screen`         | **Real, recorded.** All three polygons built from live Mireye drive times. Falls back to local OSRM without a key, labelled.          |
| **World** — heat and rain                                      | Open-Meteo ERA5 archive + 1991–2020 normals | **Real, always.** No key needed.                                                                                                      |
| **World** — road closures, permits, competitors, events        | Scenario fixtures in `data/scenarios/`      | **Mocked.** Shaped like a real client, hand-editable.                                                                                 |
| **Ledger** — daily tickets, basket size, ad spend              | Seeded generator                            | **Mocked.** Square/Shopify/QuickBooks are not connected.                                                                              |
| **Reasoning** — narration                                      | OpenAI, or a deterministic template         | **Real** with a key. Never computes a number either way.                                                                              |
| **Act layer** — ad campaign, alerts                            | Rendered drafts                             | **Simulated.** No credential exists in this build that could dispatch anything.                                                       |

### Weather is real, and that mattered

Wiring the live feed in changed the answer, which is the point of wiring it in. The road-closure scenario originally authored its own rain on 9–10 July. Austin's actual 2026 weather had no rain then — it rained 11–16 July. With authored rain the closure absorbed the entire dip; with real rain the split moved and the rain days that genuinely fell inside the window took their own (small, honestly banded) share.

So the scenarios no longer author weather at all. They declare a _response coefficient_ — how hard this business reacts to a unit of heat or rain — and the drivers themselves come from Open-Meteo. The till and the world layer now tell the same story because they are built from the same observations.

---

## Scenarios

Three, in `data/scenarios/`, hand-editable JSON:

- **`quiet-month`** — nothing happened. Exists to prove the engine says "I don't know" when it doesn't. Confidence should come out LOW with ε taking nearly all of a small residual.
- **`road-closure-dip`** — the dossier's flagship. Nine days of resurfacing on S Congress, real Austin rain inside the same window, and a hidden in-shop failure no feed carries.
- **`heatwave-competitor`** — a real 43.5 °C heat spell and a new coffee bar 380 m away, pulling opposite ways on one series.

Each file carries an `expectation` field written by the author: what the engine _should_ conclude. It is shown in the Ops view so an operator can tell drift from a real finding.

### Hidden events

Each scenario may declare `hiddenEvents` — things that moved the till but that no data source carries: a broken grinder, a barista who left. The generator applies them; the world layer never sees them. Without these the demo would be dishonest, because a street whose every event is in our feed is a street that does not exist, and an engine that explains 100% of every dip is an engine nobody should believe.

---

## Verify it yourself

```bash
npx tsx scripts/check-attribution.ts   # engine vs the generator's ground truth
npx tsx scripts/check-isochrone.ts     # polygon shape and boundary accuracy
npx tsx scripts/check-weather.ts       # real observations vs 30-year normals
npx tsx scripts/check-pipeline.ts      # the whole path, end to end
```

`check-attribution.ts` is the gate that matters: it prints what the engine recovered next to what the generator actually did. The engine never sees the generator's effect sizes.

---

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the shape of the system, the join, the physics engine, and the extension points.
- [`DATA_FLOW.md`](./DATA_FLOW.md) — one address traced end to end, with the real object at each hop.
- [`API_FLOW.md`](./API_FLOW.md) — every route this app exposes, and exactly how Mireye and OpenAI are called.

## Not claimed

- No causality from one location. Every figure says "accounts for", carries a band, and names what it cannot explain.
- No foot-traffic data. None is purchased and none is modelled.
- No coverage outside Austin, TX. Permits and closures are per-jurisdiction and we do not pretend otherwise.
- No money moves. No auth system either — that is a v2 item, noted deliberately rather than forgotten.
