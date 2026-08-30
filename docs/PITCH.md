# Groundwork — the pitch

## The one line

Every ad tool a local business uses targets a 5-mile circle. We measured that
circle against the real 8-minute drive, and most of it is water, freeway, or
hillside nobody can drive through. Groundwork is the attribution engine that
tells a shop owner, in customers and dollars, what actually moved their sales —
and every number it shows is measured, cited, and refusable.

## The problem, told so it lands

**One owner, one Tuesday.** Sales are down 22%. She has to decide with her own
money — cut prices, cut a shift, pour cash into ads — and she has no idea
whether it was her fault or the world's. The road closure three blocks away?
The heatwave? The new café that opened? Or something she did? She is about to
make a bet-the-month decision on a coin flip she cannot see.

**Why nobody has solved it.** Square, Shopify, Google Analytics can all tell
you *what* happened. None can tell you *why*, because why requires a
counterfactual: what would sales have been if the road had not closed? You
cannot A/B test reality — there is only one timeline. That is an inference
problem, not a dashboard, which is why every local business flies blind.

**The scale.** Tens of millions of these businesses. Each makes this decision
every week, and collectively they burn billions on ads aimed at a circle where
most of the area cannot reach the front door. Big chains have data-science
teams for exactly this. The corner shop has a gut feeling. It is the largest
information asymmetry in commerce.

The villain to name out loud: *tools that tell you what happened and call it
insight.*

## The solution

The reason this is solvable now and not five years ago is that the missing
ingredient was ground truth about the physical world — exactly where a parcel
is, who can drive there in 8 minutes, what is on the street. Groundwork does
what the chains pay analysts for:

1. Build a statistical baseline of a normal week, from days when nothing was
   happening on the street.
2. Subtract the measurable forces — closures, weather, competitors — each one
   measured, each with a confidence band.
3. Hand the owner the answer in the only units that matter: customers and
   dollars, with a grade. "This wasn't you, it was the street. Here's the
   number, and here's the one thing to do."

The discipline is the moat: the engine **refuses to claim a number it cannot
measure.** A competitor open for years is collinear with the baseline, so it is
reported as "already inside your baseline," not faked. A two-day heatwave comes
back "unproven," on purpose.

## The sub-agents

All five run behind one provider-agnostic layer (`lib/agent/llm.ts`) — flip an
env var between OpenAI and Groq, no code change. Each computes its facts
deterministically and lets the model only phrase them; every panel renders its
measured half even with no model configured, and says on screen when the
written half is missing.

| Agent | File | What it does | Hard rule |
| --- | --- | --- | --- |
| **Narrator** | `lib/agent/narrate.ts` | Turns the attribution object into a plain-English brief | May only narrate numbers already in the object; if a band crosses zero it must say "may have done nothing" |
| **Research** | `lib/agent/researcher.ts` | Works only on the *unexplained* residual — hypotheses + questions for the owner | Everything is a labelled guess; the check-in turns a guess into evidence |
| **Week Ahead** | `lib/agent/week-ahead.ts` | Carries measured, still-running drivers forward 28 days | No forecasting model — arithmetic on the engine's output; unmeasured drivers get no projection |
| **Advertising** | `lib/agent/ad-copy.ts` | Reach-vs-price diagnosis (deterministic) + ad copy (model) | Copy never states a figure and never names a competitor |
| **Decision modules** | `lib/modules/index.ts` | Propose an action with a cost and expected value | Stop at an approval gate; nothing auto-submits |

The advertising split is the sharpest demo: the **strategy is arithmetic**
(tickets down but basket flat → a reach problem, so discounting would give away
margin on customers who never left), and the **model only writes the sentence**
— fenced so it never states a number and never names a rival (naming your
competitor in your own ad is free advertising for them).

## The Mireye integration

Groundwork is built entirely on the Mireye Earth API. Without ground truth,
"the circle is wrong" is an opinion; with it, the claim is *10 square miles
versus 78, measured.* Mireye is not a dependency here — it is the reason the
core thesis is true instead of merely plausible.

Every external call goes through one client (`lib/mireye/client.ts`) with a
four-step contract — **cache → quote → grant → record** — and there are exactly
four call sites:

| Endpoint | Where | Buys | Approx cost |
| --- | --- | --- | --- |
| `/v1/lookup` | `lib/resolver.ts` | Address → real parcel (rooftop coordinate, county, geometry) | 300 credits |
| `/v1/fetch` | `lib/resolver.ts` | Site fields around the parcel | ~16 credits |
| `/v1/proximity` · `screen` | `lib/isochrone/probes.ts` | The 8-minute drive shed | ~960 credits |
| `/v1/proximity` · `distance` | `lib/pipeline.ts` | Competitor drive-times | 12 credits/leg |

**The drive shed is derived, not fetched.** Mireye has no isochrone endpoint,
so the trade area is built from the `proximity/screen` primitive: an 80-probe,
two-pass sweep — 16 compass bearings × probes at four radii — then interpolate
the boundary where the 8-minute drive time runs out, and re-probe to self-check
the error bar. `screen` rather than `distance` because it returns the
near-misses too (`screened_out` carries each point's own best duration), which
is exactly the boundary data the interpolation needs — same credits, strictly
more information.

**Credit safety by construction.** There is no Mireye usage endpoint, so the
app keeps its own append-only ledger (`lib/telemetry/ledger.ts`) and a Budget
Broker (`lib/mireye/budget.ts`) with per-agent daily ceilings. Every call is
priced from Mireye's published formula, mirrored in `lib/mireye/credits.ts`,
*before* it is made. Expensive facts (parcels, drive sheds) are fetched once per
address and cached forever, so a 90-day backtest costs the same as a one-day
run. Live responses are recorded as fixtures so the demo runs offline, without a
key, and without spending credits.

Notes worth knowing, learned the hard way:

- `/v1/lookup` bills 300 credits *with* `include_parcel` (per-record-licensed
  county data) versus 1 without it. Validate a candidate address with
  `include_parcel:false` before committing a full resolve.
- Parcel records are also capped separately (80/month on Build) — the real
  scarce resource, and the credit balance looks healthy long after it is gone.
- `api.mireye.com` publishes an AAAA record that does not route on some
  networks; Node's fetch stalls on it while curl falls back. The client forces
  IPv4 (`GROUNDWORK_FORCE_IPV4`).

## The demo set

13 real Austin addresses, each resolved live at rooftop accuracy, each chosen to
break the circle a *different* way — water, freeway, parkland, one-way grid,
arterial, congestion. Mozart's on Lake Austin is the sharpest: a 10.0 mi²
drive shed against a 78 mi² circle. Home Slice, 200m from Jo's Coffee, is the
control — when two tills that close disagree, the cause is not geography.
