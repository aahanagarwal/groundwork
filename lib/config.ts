/**
 * Every environment-derived knob in one place, so a demo operator can find
 * what to change without reading application code.
 */

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export type MireyeMode = "record" | "replay" | "live";

export const config = {
  mireye: {
    apiKey: str("MIREYE_API_KEY"),
    baseUrl: str("MIREYE_BASE_URL", "https://api.mireye.com"),
    maxCreditsPerCall: int("MIREYE_MAX_CREDITS_PER_CALL", 1200),
    /**
     * Without a key there is nothing to record or call, so we fall back to
     * replay rather than failing — the demo must always be walkable.
     */
    get mode(): MireyeMode {
      const requested = str("MIREYE_MODE", "record") as MireyeMode;
      if (!this.apiKey) return "replay";
      return ["record", "replay", "live"].includes(requested)
        ? requested
        : "record";
    },
  },

  openai: {
    apiKey: str("OPENAI_API_KEY"),
    /** Planner + attribution narration. The expensive, careful one. */
    model: str("OPENAI_MODEL", "gpt-5.6-sol"),
    /** The six decision modules. */
    modelModules: str("OPENAI_MODEL_MODULES", "gpt-5.6-terra"),
    /** Titles, summaries, and other chores. */
    modelCheap: str("OPENAI_MODEL_CHEAP", "gpt-5.6-luna"),
    get enabled(): boolean {
      return this.apiKey.length > 0;
    },
  },

  demo: {
    defaultScenario: str("GROUNDWORK_DEFAULT_SCENARIO", "road-closure-dip"),
  },
} as const;

/**
 * The trade area the whole product is built on. The dossier's number is eight
 * minutes; it is a constant here rather than a literal scattered through the
 * modules because every module inherits the same polygon.
 */
export const TRADE_AREA_MINUTES = 8;

/**
 * The naive comparison we draw the real polygon against. Five miles is the
 * radius a franchise ad-buy tool would default to.
 */
export const NAIVE_RADIUS_MILES = 5;
