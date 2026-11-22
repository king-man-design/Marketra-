const fs = require("fs");
const path = require("path");
const os = require("os");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function uploadToGemini(filePath, mimeType) {
  return ai.files.upload({ file: filePath, config: { mimeType } });
}

async function waitForFileReady(file) {
  let current = file;
  for (let i = 0; i < 30; i++) {
    if (!current?.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") throw new Error("Gemini failed to process the uploaded media.");
    await sleep(2000);
    current = await ai.files.get({ name: current.name });
  }
  throw new Error("Media processing timed out.");
}

async function generateFromMedia(file, mimeType, instruction) {
  const response = await ai.models.generateContent({
    model: process.env.AI_MEDIA_MODEL || process.env.AI_MODEL || "gemini-3.6-flash",
    contents: [{ role: "user", parts: [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType || mimeType } },
      { text: instruction },
    ]}],
    config: { responseMimeType: "text/plain" },
  });
  return typeof response.text === "string" ? response.text.trim() : "";
}

async function transcribeAudio(filePath, mimeType) {
  const ready = await waitForFileReady(await uploadToGemini(filePath, mimeType));
  return generateFromMedia(ready, mimeType,
    "Transcribe the spoken audio exactly as clearly as possible. Return only the transcript. Do not add explanations, summaries, labels, or commentary. Preserve the speaker's wording and natural language.");
}

async function analyzeVideo(filePath, mimeType, business) {
  const ready = await waitForFileReady(await uploadToGemini(filePath, mimeType));
  const businessContext = business ? `\nBUSINESS PROFILE:\n${JSON.stringify(business, null, 2)}\n` : "";
  return generateFromMedia(ready, mimeType, `${businessContext}
Analyze this marketing video for MARKETRA.

Evaluate the hook and first 3 seconds, product/service visibility, offer clarity, message clarity, visual quality, pacing, branding, CTA, target-customer fit, trust/credibility, conversion potential, strengths, weaknesses, and exact improvements. Mention specific scenes or moments when useful. Give practical advice for a small/local business.

Return only the final analysis in ordinary readable text. Do not return JSON. Do not explain your reasoning. Do not add a preamble.`);
}

async function saveUpload(buffer, originalName) {
  const extension = path.extname(originalName || "") || ".bin";
  const tempPath = path.join(os.tmpdir(), `marketra-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  await fs.promises.writeFile(tempPath, buffer);
  return tempPath;
}

async function removeTemporaryFile(filePath) {
  try { await fs.promises.unlink(filePath); } catch {}
}

module.exports = { transcribeAudio, analyzeVideo, saveUpload, removeTemporaryFile };
