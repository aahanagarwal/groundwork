import { NextResponse } from "next/server";
import { resolveSite } from "@/lib/resolver";
import { demoSiteBySlug } from "@/lib/demo-sites";
import { ensureTradeArea, type DashboardStageStatus } from "@/lib/pipeline";
import { writeScenario } from "@/lib/scenarios";
import {
  buildScenario,
  defaultWindow,
  generateSyntheticEvents,
  validateDraft,
  type ScenarioDraft,
} from "@/lib/agent/scenario-builder";

/**
 * Step 2 of "Create a new use case" - the one request that turns a validated
 * draft into a scenario a shop owner can open.
 *
 * Two modes, both handled here rather than as separate routes because they
 * share every step except location resolution:
 *
 *   "new"      - a brand-new business. The address is resolved live through
 *                Mireye, exactly the same call the three seeded demo sites
 *                already go through (lib/resolver.ts, unmodified). A low-
 *                confidence or unmatchable address is refused, never guessed.
 *
 *   "existing" - Aahan's addition: attach a new scenario to one of the
 *                already-seeded sites instead of creating a new business.
 *                `resolveSite` on an already-resolved slug is a cache hit -
 *                zero Mireye cost - and the trade area is already persisted,
 *                so this path only ever pays for event generation (which
 *                costs no Mireye credits at all - see lib/agent/llm.ts).
 *
 * Nothing here is written until validation passes. A failed step returns a
 * field-level error or a refusal; nothing partially writes to disk.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    mode?: "new" | "existing";
    existingSlug?: string;
    draft?: ScenarioDraft;
  };

  if (body.mode !== "new" && body.mode !== "existing") {
    return NextResponse.json({ error: "mode must be \"new\" or \"existing\"." }, { status: 400 });
  }
  if (!body.draft) {
    return NextResponse.json({ error: "Missing draft." }, { status: 400 });
  }
  if (body.mode === "existing" && !body.existingSlug) {
    return NextResponse.json(
      { error: "existingSlug is required when mode is \"existing\"." },
      { status: 400 },
    );
  }

  const draft = body.draft;
  const window = defaultWindow();
  const fieldErrors = validateDraft(draft, {
    requireAddress: body.mode === "new",
    windowStart: window.start,
    windowEnd: window.end,
  });
  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 422 });
  }

  // --- Resolve the location --------------------------------------------------
  const stages: DashboardStageStatus[] = [];
  const resolved =
    body.mode === "existing"
      ? await resolveSite(body.existingSlug!)
      : await resolveSite(draft.address);

  if (!resolved.ok) {
    return NextResponse.json(
      {
        fieldErrors: {
          address: resolved.refusal.hint
            ? `${resolved.refusal.message} ${resolved.refusal.hint}`
            : resolved.refusal.message,
        },
      },
      { status: 422 },
    );
  }
  const site = resolved.data;

  // --- Trade area --------------------------------------------------------
  // Reused as-is from the pipeline every demo site already goes through.
  // For an existing site this is a persisted-record cache hit; for a new one
  // it draws the isochrone live.
  const tradeArea = await ensureTradeArea(site, stages);
  if (!tradeArea) {
    const failed = stages.find((s) => s.stage === "trade_area" && !s.ok);
    return NextResponse.json(
      {
        fieldErrors: {
          address:
            failed?.refusal?.message ??
            "Could not draw a drive-time area for this address.",
        },
      },
      { status: 422 },
    );
  }

  // --- Synthetic events ----------------------------------------------------
  const businessLabel =
    body.mode === "existing" ? site.label : draft.businessLabel;
  const category =
    (body.mode === "existing" && demoSiteBySlug(body.existingSlug!)?.category) ||
    "Local business";
  const analysisWindow =
    draft.analysisWindowStart && draft.analysisWindowEnd
      ? { start: draft.analysisWindowStart, end: draft.analysisWindowEnd }
      : null;

  const generated = await generateSyntheticEvents({
    businessLabel,
    address: site.resolvedAddress ?? site.inputAddress,
    category,
    windowStart: window.start,
    windowEnd: window.end,
    analysisWindowStart: analysisWindow?.start ?? window.end,
    analysisWindowEnd: analysisWindow?.end ?? window.end,
  });

  // --- Assemble and persist ------------------------------------------------
  const scenario = buildScenario({
    draft: { ...draft, businessLabel },
    siteSlug: site.slug,
    generated,
  });
  writeScenario(scenario);

  return NextResponse.json({
    ok: true,
    slug: site.slug,
    scenarioKey: scenario.key,
    eventsGenerated: generated.events.length,
    hiddenEventsGenerated: generated.hiddenEvents.length,
    eventsUnavailable: generated.unavailable ?? null,
  });
}
