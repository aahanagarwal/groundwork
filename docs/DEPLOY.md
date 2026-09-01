# Deploying Groundwork (Vercel)

The app was built to run from files under its own directory. Serverless hosts
mount the deployment read-only and only `/tmp` is writable, so every runtime
write had to be redirected. That work is done — this note is what you set, and
why it now works.

## What makes it work

- **All runtime writes go to `/tmp` on serverless.** `lib/paths.ts` decides
  writable-vs-bundled in one place; the store, the weather cache, the call
  ledger, and any recorded Mireye fixtures all write under `/tmp/groundwork`
  there, and the project directory locally (unchanged).
- **A committed store seed carries the demo.** `data/seed/store/` holds the
  resolved 13 addresses — sites, trade areas, world events, tills. On a cold
  serverless start the writable store is empty, so reads fall back to the seed
  and the pages render with no recomputation and no credits spent.
- **The data is bundled into the functions.** `next.config.ts`
  (`outputFileTracingIncludes`) forces the seed, the Mireye fixtures, and the
  scenarios into each route's serverless bundle, since Next cannot trace files
  opened by a runtime-built path.

Per-viewer state written during a session (a check-in, an approved action)
lands in `/tmp` and does not persist across instances. That is fine for the
demo. For durable multi-user state, set `DATABASE_URL` — the Prisma schema
already exists and `backend()` switches to Postgres automatically.

## Environment variables to set in Vercel

Required for a clean demo:

| Variable | Value | Why |
| --- | --- | --- |
| `MIREYE_MODE` | `replay` | Serve the committed fixtures; never call out or try to write one |

Optional — the app degrades gracefully without each:

| Variable | Value | Effect if unset |
| --- | --- | --- |
| `MIREYE_API_KEY` | your token | Unused in replay for the seeded addresses; only needed to resolve a *new* address live |
| `LLM_PROVIDER` | `groq` or `openai` | Defaults to `openai` |
| `GROQ_API_KEY` | your key | Agents render their measured half and say "no model configured" for the written half |
| `OPENAI_API_KEY` | your key | Same graceful degrade |

Do **not** set `DATABASE_URL` unless you actually have a Postgres — a bad URL
forces the Postgres backend and breaks the file store.

## Build settings

Defaults are correct: build `next build`, output the standard `.next`. No
special install step. The 284 MB local OSRM graph in `data/osm/` is gitignored
and is not needed in production — with `MIREYE_MODE=replay` the trade areas come
from the committed fixtures, not from local routing.

## One-line sanity check before you trust it

Simulate the read-only filesystem locally: point the writable root at an empty
temp dir and set `VERCEL=1`, so nothing can fall through to the real
`data/store`.

```bash
VERCEL=1 MIREYE_MODE=replay GROUNDWORK_WRITABLE_DIR="$(mktemp -d)" npm run build && npm start
```

If the site pages render, so will Vercel.
