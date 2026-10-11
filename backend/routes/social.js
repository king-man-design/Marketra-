const express = require("express");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../authMiddleware");
const { requestSocialCrawl, getPlatform, cleanHandle } = require("../providers/socialcrawl");
const { normalizeSocialResponse } = require("../services/socialNormalizer");

const router = express.Router();
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;
const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many social-data requests. Please wait a minute." },
});

function sendError(res, err) {
  const status = Number.isInteger(err.status) ? err.status : 502;
  if (status >= 500) console.error("[socialcrawl] request failed:", err.message);
  return res.status(status).json({ error: status >= 500 ? "SocialCrawl request failed. Check the API key, service status, and credit balance." : err.message, providerType: err.providerType || undefined });
}

// GET /api/social/accounts — list only profiles saved by the authenticated user.
router.get("/accounts", requireAuth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase is not configured." });
  try {
    const { data, error } = await supabase.from("social_accounts")
      .select("id, platform, handle, connection_status, profile_data, last_sync_at, created_at")
      .eq("marketra_user_id", req.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (err) { return sendError(res, err); }
});

// POST /api/social/profile — fetch one public profile and save a snapshot.
router.post("/profile", socialLimiter, requireAuth, async (req, res) => {
  try {
    const platform = getPlatform(req.body?.platform).key;
    const handle = cleanHandle(req.body?.handle);
    const profile = await requestSocialCrawl(platform, "profile", handle, { trim: true });
    const normalized = normalizeSocialResponse(profile, platform, handle);
    const saved = {
      marketra_user_id: req.userId,
      platform,
      handle,
      connection_status: "connected",
      profile_data: { provider_response: profile, normalized },
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (supabase) {
      const { data, error } = await supabase.from("social_accounts")
        .upsert(saved, { onConflict: "marketra_user_id,platform,handle" })
        .select("id, platform, handle, connection_status, profile_data, last_sync_at, created_at")
        .single();
      if (error) throw error;
      return res.json({ account: data, profile: normalized, raw: profile, credits_used: profile.credits_used ?? null, credits_remaining: profile.credits_remaining ?? null });
    }
    return res.json({ account: { platform, handle, connection_status: "connected", profile_data: { provider_response: profile, normalized } }, profile: normalized, raw: profile, credits_used: profile.credits_used ?? null, credits_remaining: profile.credits_remaining ?? null, warning: "Profile fetched but not saved because Supabase service credentials are not configured." });
  } catch (err) { return sendError(res, err); }
});

// POST /api/social/posts — explicitly fetch a recent public-content page (typically 1 credit).
router.post("/posts", socialLimiter, requireAuth, async (req, res) => {
  try {
    const platform = getPlatform(req.body?.platform).key;
    const handle = cleanHandle(req.body?.handle);
    const result = await requestSocialCrawl(platform, "posts", handle, { trim: true });
    return res.json({ platform, handle, result, credits_used: result.credits_used ?? null, credits_remaining: result.credits_remaining ?? null });
  } catch (err) { return sendError(res, err); }
});

// POST /api/social/analyze — fetch the provider's combined profile+recent-content view where documented.
router.post("/analyze", socialLimiter, requireAuth, async (req, res) => {
  try {
    const platform = getPlatform(req.body?.platform).key;
    const handle = cleanHandle(req.body?.handle);
    const kind = ["instagram", "youtube", "twitter"].includes(platform) ? "full" : "profile";
    const result = await requestSocialCrawl(platform, kind, handle, kind === "full" ? { posts: 10, trim: true } : { trim: true });
    return res.json({ platform, handle, result, credits_used: result.credits_used ?? null, credits_remaining: result.credits_remaining ?? null });
  } catch (err) { return sendError(res, err); }
});

// DELETE /api/social/accounts/:id — remove only a saved profile owned by this user.
router.delete("/accounts/:id", requireAuth, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase is not configured." });
  const id = String(req.params.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: "Invalid account id." });
  try {
    const { data, error } = await supabase.from("social_accounts").delete().eq("id", id).eq("marketra_user_id", req.userId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Social profile not found." });
    return res.json({ deleted: true });
  } catch (err) { return sendError(res, err); }
});

module.exports = router;
