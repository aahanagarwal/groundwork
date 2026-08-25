import { config } from "@/lib/config";
import type { SiteRecord } from "@/lib/domain";

/**
 * MARKET RESEARCH SUB-AGENT
 * 
 * This agent acts as a researcher in the reasoning layer. It simulates continuous 
 * searches across Reddit (e.g., r/Austin) and local business articles to understand 
 * the exact factors that drive day-to-day sales for a specific type of business 
 * in a specific location.
 * 
 * It passes this business-centric context to the Narrator to ensure the final 
 * brief sounds like a local consultant who knows the market, not just a statistician.
 */
export async function getMarketContext(site: SiteRecord): Promise<string> {
  if (!config.openai.enabled) return "";

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: config.openai.apiKey });

  const system = [
    "You are Groundwork's Market Research Sub-Agent.",
    "Your job is to search your knowledge base (simulating recent Reddit threads, local business articles, and industry reports) to determine what exogenous physical factors affect daily sales growth for the provided business.",
    "Specifically, look for localized context based on the address (e.g., if it's Austin, TX: heatwaves, UT Austin game days, South by Southwest (SXSW), ACL festival, I-35 traffic, tech worker RTO policies, parking complaints on r/Austin).",
    "Return exactly 3 concise bullet points of business-centric, local factors that the Narrator should keep in mind when explaining revenue drops or spikes to the owner."
  ].join("\n");

  try {
    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Business Name: ${site.label}\nAddress: ${site.resolvedAddress ?? site.inputAddress}\n\nWhat local, business-specific factors drive foot traffic and sales here?`,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return response.choices[0].message.content ?? "";
  } catch (e) {
    console.error("Market context sub-agent failed:", e);
    return "";
  }
}
