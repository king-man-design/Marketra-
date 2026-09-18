const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "marketing-system.txt"),
  "utf-8"
);

/**
 * Calls the AI with the marketing system prompt + business memory +
 * conversation history + the new user message. Returns parsed JSON
 * matching the shape defined in marketing-system.txt.
 */
async function askMarketra({ business, history = [], message, allowWebSearch = true }) {
  const businessBlock = business
    ? `BUSINESS PROFILE:\n${JSON.stringify(business, null, 2)}`
    : "BUSINESS PROFILE: none provided yet — ask for the essentials before diagnosing.";

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: `${businessBlock}\n\nUSER MESSAGE:\n${message}` },
  ];

  const response = await client.messages.create({
    model: process.env.AI_MODEL || "claude-sonnet-4-6",
    max_tokens: 1800,
    system: SYSTEM_PROMPT,
    messages,
    tools: allowWebSearch
      ? [{ type: "web_search_20250305", name: "web_search" }]
      : undefined,
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // The model didn't return clean JSON — surface the raw text rather
    // than crash, so the frontend can still show something useful.
    return {
      diagnosis: text,
      current_stage: "unknown",
      priority: { title: "Review AI response", reason: "Response was not valid JSON." },
      today: [],
      next: [],
      metrics: [],
      decision_rule: "",
      assumptions: [],
      _parse_error: true,
    };
  }
}

module.exports = { askMarketra };
