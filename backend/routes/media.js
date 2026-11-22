const express = require("express");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../authMiddleware");
const { isValidUuid } = require("../validate");
const { getBusiness } = require("../business");
const { transcribeAudio, analyzeVideo, saveUpload, removeTemporaryFile } = require("../services/media");

const router = express.Router();
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many media requests. Please slow down." },
});

const AUDIO_TYPES = new Set(["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/x-m4a"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);
const MAX_BYTES = 50 * 1024 * 1024;

function decodeMedia(data, allowedTypes) {
  if (!data || typeof data !== "object") throw new Error("Media payload is missing.");
  const mimeType = String(data.mimeType || "").toLowerCase();
  if (!allowedTypes.has(mimeType)) throw new Error(`Unsupported media type: ${mimeType || "unknown"}`);
  if (typeof data.data !== "string" || !data.data) throw new Error("Media data is missing.");
  const buffer = Buffer.from(data.data, "base64");
  if (!buffer.length) throw new Error("Media data is empty.");
  if (buffer.length > MAX_BYTES) throw new Error("Media file is too large. Maximum size is 50 MB.");
  return { buffer, mimeType, name: String(data.name || "media.bin").slice(0, 180) };
}

async function getOwnedBusiness(businessId, userId) {
  if (!businessId) return null;
  if (!isValidUuid(businessId)) {
    const err = new Error("Invalid businessId."); err.statusCode = 400; throw err;
  }
  if (supabase) {
    const { data: owned, error } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!owned) {
      const err = new Error("Not your business."); err.statusCode = 403; throw err;
    }
  }
  return getBusiness(businessId);
}

router.post("/transcribe", mediaLimiter, requireAuth, async (req, res) => {
  let tempPath = null;
  try {
    const media = decodeMedia(req.body, AUDIO_TYPES);
    tempPath = await saveUpload(media.buffer, media.name);
    const transcript = await transcribeAudio(tempPath, media.mimeType);
    return res.json({ transcript });
  } catch (err) {
    console.error("[media/transcribe]", err);
    return res.status(err.statusCode || (err.message.includes("Unsupported") || err.message.includes("too large") ? 400 : 500)).json({
      error: err.message || "Could not transcribe the audio.",
    });
  } finally {
    if (tempPath) await removeTemporaryFile(tempPath);
  }
});

router.post("/analyze-video", mediaLimiter, requireAuth, async (req, res) => {
  let tempPath = null;
  try {
    const media = decodeMedia(req.body, VIDEO_TYPES);
    const business = req.body?.businessId ? await getOwnedBusiness(req.body.businessId, req.userId) : null;
    tempPath = await saveUpload(media.buffer, media.name);
    const analysis = await analyzeVideo(tempPath, media.mimeType, business);
    return res.json({ analysis });
  } catch (err) {
    console.error("[media/analyze-video]", err);
    return res.status(err.statusCode || (err.message.includes("Unsupported") || err.message.includes("too large") ? 400 : 500)).json({
      error: err.message || "Could not analyze the video.",
    });
  } finally {
    if (tempPath) await removeTemporaryFile(tempPath);
  }
});

module.exports = router;
