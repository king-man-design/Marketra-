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
 * conversation history + the new user message. Retries transient Gemini failures (429/5xx) with bounded exponential
 * backoff. Returns parsed JSON matching the shape defined in
 * marketing-system.txt, or a clean internal flag the route can turn into
 * an appropriate HTTP response.
 */
async function askMarketra({ business, history = [], message, allowWebSearch = false, socialData = null, outcomes = null }) {
  const businessBlock = business
    ? `BUSINESS PROFILE:\n${JSON.stringify(business, null, 2)}`
    : "BUSINESS PROFILE: none provided yet — ask for the essentials before diagnosing.";

  // Labeled explicitly so the model (and, via the "evidence" field, the
  // end user) can always tell whether a number is real connected-account
  // data or whether none exists — never blur the two.
  const socialBlock =
    socialData && socialData.length
      ? `CONNECTED SOCIAL ACCOUNT DATA (REAL, from InsightIQ/Phyllo — use this, do not invent numbers beyond it):\n${JSON.stringify(socialData, null, 2)}`
      : "CONNECTED SOCIAL ACCOUNT DATA: none available. Do not invent engagement, follower, reach, or performance numbers. Any recommendation must be labeled as profile-based or general, not based on social analytics.";

  const outcomeBlock =
    outcomes && outcomes.length
      ? `RECENT MARKETING OUTCOMES (REAL, manually recorded results from prior actions — use as historical context, do not treat as platform analytics):\n${JSON.stringify(outcomes, null, 2)}`
      : "RECENT MARKETING OUTCOMES: none recorded yet. Measurement is pending for executed recommendations.";

  // Gemini uses "model" instead of "assistant" for the AI's own turns.
  const contents = [
    ...history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: `${businessBlock}\n\n${socialBlock}\n\n${outcomeBlock}\n\nUSER MESSAGE:\n${message}` }] },
  ];

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    // Grounding (googleSearch) has its own, much tighter free-tier quota
    // than plain generation — only attach it when explicitly requested.
    ...(allowWebSearch && { tools: [{ googleSearch: {} }] }),
  };
  const model = process.env.AI_MODEL || "gemini-3.6-flash";

  let response;
  // Gemini can temporarily return 503 (service unavailable) or 429
  // (rate limited). Retry transient failures with exponential backoff.
  // Keep the total number of attempts bounded so a slow upstream cannot
  // hold the user's request open indefinitely.
  const maxAttempts = 4; // 1 initial attempt + up to 3 retries
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await ai.models.generateContent({ model, contents, config });
      break; // success
    } catch (err) {
      const status = getStatusCode(err);
      const isRetryable = retryableStatuses.has(Number(status));
      const isLastAttempt = attempt === maxAttempts;

      if (!isRetryable || isLastAttempt) {
        if (isRetryable) {
          console.error(
            `[ai.js] Gemini ${status} after ${maxAttempts} attempts; giving up.`
          );
          return {
            _temporary_unavailable: true,
            diagnosis:
              "Marketra AI is temporarily busy. Please try again in a moment.",
          };
        }

        // Permanent errors such as invalid API keys, invalid requests,
        // or invalid models should fail immediately rather than wasting
        // more quota/time on retries.
        throw err;
      }

      // Exponential backoff: ~1s, ~2s, ~4s, with small jitter.
      // This also handles 429s without hammering an already busy service.
      const baseDelay = 1000 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelay + jitter;

      console.warn(
        `[ai.js] Gemini ${status} temporary error, retrying in ${delay}ms ` +
          `(attempt ${attempt}/${maxAttempts})`
      );
      await sleep(delay);
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
