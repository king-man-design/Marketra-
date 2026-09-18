const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "marketing-system.txt"),
  "utf-8"
);

async function askMarketra({ business, history = [], message, allowWebSearch = true }) {
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

  const response = await ai.models.generateContent({
    model: process.env.AI_MODEL || "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: allowWebSearch ? [{ googleSearch: {} }] : undefined,
    },
  });

  const text = (response.text || "").trim();
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return {
      diagnosis: text,
      current_stage: "unknown",
      priority: { title: "Review AI response", reason: "Response was not valid JSON." },
      today: [], next: [], metrics: [], decision_rule: "", assumptions: [],
      _parse_error: true,
    };
  }
}

module.exports = { askMarketra };
