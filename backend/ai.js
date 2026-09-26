const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "marketing-system.txt"),
  "utf-8"
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pull the HTTP status out of whatever shape @google/genai throws.
function getStatusCode(err) {
  if (err?.status) return err.status;
  if (err?.error?.code) return err.error.code;
  try {
    const parsed = JSON.parse(err?.message || "{}");
    return parsed?.error?.code;
  } catch {
    return undefined;
  }
}

/**
 * Calls Gemini with the marketing system prompt + business memory +
 * conversation history + the new user message. Retries once on a 429
 * (rate limit) after a short delay — this recovers per-minute (RPM)
 * limits, though not an exhausted daily (RPD) quota. Returns parsed
 * JSON matching the shape defined in marketing-system.txt, or a
 * _rate_limited flag the route can turn into a clean 429 response.
 */
async function askMarketra({ business, history = [], message, allowWebSearch = false }) {
  const businessBlock = business
    ? `BUSINESS PROFILE:\n${JSON.stringify(business, null, 2)}`
    : "BUSINESS PROFILE: none provided yet — ask for the essentials before diagnosing.";

  // Gemini uses "model" instead of "assistant" for the AI's own turns.
  const contents = [
    ...history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: `${businessBlock}\n\nUSER MESSAGE:\n${message}` }] },
  ];

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    // Grounding (googleSearch) has its own, much tighter free-tier quota
    // than plain generation — only attach it when explicitly requested.
    ...(allowWebSearch && { tools: [{ googleSearch: {} }] }),
  };
  const model = process.env.AI_MODEL || "gemini-3.6-flash";

  let response;
  const maxAttempts = 2; // one real attempt + one retry
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await ai.models.generateContent({ model, contents, config });
      break; // success
    } catch (err) {
      const status = getStatusCode(err);
      const isLastAttempt = attempt === maxAttempts;

      if (status === 429 && !isLastAttempt) {
        console.warn(`[ai.js] 429 rate limit, retrying in 3s (attempt ${attempt}/${maxAttempts})`);
        await sleep(3000);
        continue;
      }

      if (status === 429) {
        // Retry didn't help — this is a real quota exhaustion, not a
        // transient blip. Return a clean, distinguishable result
        // instead of throwing a raw stack trace up to the route.
        return {
          _rate_limited: true,
          diagnosis: "MARKETRA has hit its daily AI usage limit. Please try again later.",
        };
      }

      // Not a rate-limit error — no point retrying, surface it.
      throw err;
    }
  }

  const text = (response.text || "").trim();
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
