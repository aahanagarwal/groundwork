import { config } from "@/lib/config";
import { record, type AgentId } from "@/lib/telemetry/ledger";

/**
 * ONE WAY TO TALK TO A LANGUAGE MODEL
 *
 * Two problems this solves, and the second is the reason it exists.
 *
 * PROVIDER. Groq serves an OpenAI-compatible API, so the only differences
 * that matter are a base URL, a key and a model name. Putting those three
 * behind one accessor means testing on Groq and shipping on OpenAI is an env
 * change rather than an edit to every agent - and nothing in an agent has to
 * know which one answered.
 *
 * VISIBILITY. Every Mireye call lands in the ledger, so the Ops view can prove
 * what the ground layer cost. The model calls had no such record at all, which
 * is why the reasoning layer was invisible: with no key set, the agents
 * returned their fallbacks silently and there was no way to tell from any
 * screen whether they had run, failed, or never been wired up. Model calls are
 * recorded here on the same ledger, at zero credits, so an agent that did
 * nothing says so.
 *
 * Tokens are not credits and are deliberately not priced here. The Budget
 * Broker guards a metered third-party balance; inventing a dollar figure for
 * tokens would put a number on the same screen that means something different.
 * The ledger carries the token counts the provider reports and stops there.
 */

export type Provider = "openai" | "groq";

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  baseUrl?: string;
  /** The careful model - reasoning and narration. */
  model: string;
  /** The cheaper model - modules, chores, structured extraction. */
  modelCheap: string;
  enabled: boolean;
}

/**
 * Groq's OpenAI-compatible surface. Same SDK, same request shape; only the
 * host and the model catalogue differ.
 */
const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

export function llmConfig(): LlmConfig {
  const provider = (process.env.LLM_PROVIDER?.trim() || "openai") as Provider;

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY?.trim() ?? "";
    return {
      provider,
      apiKey,
      baseUrl: process.env.GROQ_BASE_URL?.trim() || GROQ_DEFAULT_BASE_URL,
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      modelCheap:
        process.env.GROQ_MODEL_CHEAP?.trim() ||
        process.env.GROQ_MODEL?.trim() ||
        "llama-3.1-8b-instant",
      enabled: apiKey.length > 0,
    };
  }

  return {
    provider: "openai",
    apiKey: config.openai.apiKey,
    baseUrl: undefined,
    model: config.openai.model,
    modelCheap: config.openai.modelCheap,
    enabled: config.openai.enabled,
  };
}

export interface CompleteOptions {
  agent: AgentId;
  system: string;
  user: string;
  /** Prefer the cheap model where the task is extraction rather than judgement. */
  cheap?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object back. */
  json?: boolean;
  siteId?: string;
  timeoutMs?: number;
}

export interface CompleteResult {
  ok: boolean;
  text: string;
  model: string;
  provider: Provider;
  /** Why nothing came back, when nothing did. Rendered, never thrown. */
  reason?: "no_key" | "error" | "empty";
  detail?: string;
}

/**
 * One completion, with the failure path treated as a first-class outcome.
 *
 * Every caller here has a deterministic fallback that is already correct - the
 * model improves readability, it does not supply facts. So an outage returns a
 * flagged result rather than throwing, and the surface renders the fallback.
 * The one thing that must never happen is silence: a call that did not happen
 * is written to the ledger too, with the reason.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const cfg = llmConfig();
  const model = opts.cheap ? cfg.modelCheap : cfg.model;
  const started = Date.now();

  const base = {
    agent: opts.agent,
    endpoint: `${cfg.provider}/chat · ${opts.agent}`,
    siteId: opts.siteId ?? null,
    // Model calls cost tokens, not Mireye credits. Zero here is the honest
    // figure for the column this ledger actually reports.
    creditsEstimated: 0,
    creditsActual: 0,
    cacheHit: false,
  };

  if (!cfg.enabled) {
    record({
      ...base,
      mode: "refused",
      durationMs: 0,
      refused: true,
      refusalCode: "no_llm_key",
      request: { model, system: opts.system.slice(0, 400) },
    });
    return {
      ok: false,
      text: "",
      model,
      provider: cfg.provider,
      reason: "no_key",
      detail:
        cfg.provider === "groq"
          ? "GROQ_API_KEY is not set"
          : "OPENAI_API_KEY is not set",
    };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    });

    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature ?? 0.4,
        max_completion_tokens: opts.maxTokens ?? 700,
        ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      },
      { timeout: opts.timeoutMs ?? 45_000 },
    );

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    record({
      ...base,
      mode: "live",
      durationMs: Date.now() - started,
      refused: text.length === 0,
      refusalCode: text.length === 0 ? "empty_completion" : null,
      fieldsReturned: [
        `model:${model}`,
        `prompt_tokens:${response.usage?.prompt_tokens ?? "?"}`,
        `completion_tokens:${response.usage?.completion_tokens ?? "?"}`,
      ],
      request: { model, system: opts.system.slice(0, 400) },
      response: { text: text.slice(0, 2000) },
    });

    if (!text) {
      return { ok: false, text: "", model, provider: cfg.provider, reason: "empty" };
    }
    return { ok: true, text, model, provider: cfg.provider };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record({
      ...base,
      mode: "live",
      durationMs: Date.now() - started,
      refused: true,
      refusalCode: "llm_error",
      request: { model, system: opts.system.slice(0, 400) },
      response: { error: detail.slice(0, 500) },
    });
    return { ok: false, text: "", model, provider: cfg.provider, reason: "error", detail };
  }
}

/** `complete`, with the JSON parsed and a typed fallback when it isn't valid. */
export async function completeJson<T>(
  opts: Omit<CompleteOptions, "json">,
  fallback: T,
): Promise<{ data: T; ok: boolean; result: CompleteResult }> {
  const result = await complete({ ...opts, json: true });
  if (!result.ok) return { data: fallback, ok: false, result };
  try {
    return { data: JSON.parse(result.text) as T, ok: true, result };
  } catch {
    // A model that returns prose where JSON was demanded has not answered the
    // question, and guessing at its intent is how bad data gets in.
    return { data: fallback, ok: false, result: { ...result, ok: false, reason: "empty" } };
  }
}
