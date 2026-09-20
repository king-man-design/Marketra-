const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "marketing-system.txt"),
  "utf-8"
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function askMarketra({ business, history = [], message, allowWebSearch = false }) {
  const businessBlock = business
    ? `BUSINESS PROFILE:\n${JSON.stringify(business, null, 2)}`
    : "BUSINESS PROFILE: none provided yet — ask for the essentials before diagnosing.";

  const contents = [
    ...history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    })),
    { role: "user", parts: [{ text: `${businessBlock}\n\nUSER MESSAGE:\n${message}` }] },
  ];

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: allowWebSearch ? [{ googleSearch: {} }] : undefined,
  };
  const model = process.env.AI_MODEL || "gemini-3.6-flash";

  let response;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await ai.models.generateContent({ model, contents, config });
      break;
    } catch (err) {
      const status = getStatusCode(err);
      const isLastAttempt = attempt === maxAttempts;

      if (status === 429 && !isLastAttempt) {
        console.warn(`[ai.js] 429 rate limit, retrying in 3s (attempt ${attempt}/${maxAttempts})`);
        await sleep(3000);
        continue;
      }

      if (status === 429) {
        return {
          _rate_limited: true,
          diagnosis: "MARKETRA has hit its daily AI usage limit. Please try again later.",
        };
      }

      throw err;
    }
  }

  const text = (response.text || "").trim();
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
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
