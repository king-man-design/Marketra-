const express = require("express");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { askMarketra } = require("../ai");
const { getBusiness, getRecentHistory, saveTurn } = require("../business");
const { requireAuth } = require("../authMiddleware");
const { isValidUuid, isValidMessage } = require("../validate");

const router = express.Router();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// AI generation is expensive (Gemini quota) and a target for abuse —
// cap it per IP. Keyed by IP since this runs before/alongside auth.
const marketingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 requests/minute/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// POST /api/marketing — requires a real logged-in session. businessId AND
// sessionId are both verified server-side against the caller's own user id
// before use — never trusted just because the browser sent them.
router.post("/marketing", marketingLimiter, requireAuth, async (req, res) => {
  const requestStartedAt = Date.now();
  console.info("[marketing] Request accepted after authentication.");
  try {
    const { message, businessId, sessionId } = req.body;

    if (!isValidMessage(message)) {
      return res.status(400).json({ error: "message must be a non-empty string under 4000 characters." });
    }
    if (businessId !== undefined && !isValidUuid(businessId)) {
      return res.status(400).json({ error: "Invalid businessId." });
    }
    if (sessionId !== undefined && !isValidUuid(sessionId)) {
      return res.status(400).json({ error: "Invalid sessionId." });
    }

    if (businessId && supabase) {
      const { data: owned } = await supabase
        .from("businesses")
        .select("id")
        .eq("id", businessId)
        .eq("user_id", req.userId)
        .maybeSingle();
      if (!owned) {
        console.warn(`[marketing] user ${req.userId} attempted to access businessId ${businessId} they do not own`);
        return res.status(403).json({ error: "Not your business." });
      }
    }

    // A session must belong to a business the caller owns — otherwise
    // someone could pass an arbitrary sessionId and read/write into a
    // stranger's conversation history. We also derive the TRUE business
    // for this session from the database here, rather than trusting the
    // browser's businessId independently — a valid session for Business A
    // paired with a client-supplied businessId for Business B (both
    // owned by the same user) would otherwise let the two get mixed.
    let resolvedBusinessId = businessId;
    if (sessionId && supabase) {
      const { data: ownedSession } = await supabase
        .from("chat_sessions")
        .select("id, business_id, businesses!inner(user_id)")
        .eq("id", sessionId)
        .eq("businesses.user_id", req.userId)
        .maybeSingle();
      if (!ownedSession) {
        console.warn(`[marketing] user ${req.userId} attempted to access sessionId ${sessionId} they do not own`);
        return res.status(403).json({ error: "Not your session." });
      }
      resolvedBusinessId = ownedSession.business_id;
    }

    const business = resolvedBusinessId ? await getBusiness(resolvedBusinessId) : null;
    const history = sessionId ? await getRecentHistory(sessionId) : [];

    // Use the latest saved SocialCrawl snapshots. Do not spend API credits on every chat turn.
    let socialData = null;
    if (supabase) {
      try {
        const { data: accounts, error: socialError } = await supabase
          .from("social_accounts")
          .select("platform, handle, profile_data, last_sync_at")
          .eq("marketra_user_id", req.userId)
          .eq("connection_status", "connected")
          .order("last_sync_at", { ascending: false })
          .limit(10);
        if (socialError) throw socialError;
        if (accounts && accounts.length) {
          socialData = accounts.map((account) => ({
            platform: account.platform,
            handle: account.handle,
            last_sync_at: account.last_sync_at,
            data: account.profile_data?.normalized || account.profile_data?.provider_response?.data || account.profile_data || null,
            source: "SocialCrawl public profile snapshot",
          }));
        }
      } catch (err) {
        console.warn("[marketing] could not load saved SocialCrawl data:", err.message);
      }
    }

    console.info("[marketing] Calling Marketra AI.");
    const result = await askMarketra({ business, history, message, socialData, outcomes });

    if (result._temporary_unavailable) {
      console.warn(`[marketing] AI unavailable; returning HTTP 503 after ${Date.now() - requestStartedAt}ms.`);
      return res.status(503).json({
        error: "ai_temporarily_unavailable",
        message: result.diagnosis,
      });
    }

    console.info(`[marketing] AI returned a result after ${Date.now() - requestStartedAt}ms.`);

    if (result._rate_limited) {
      return res.status(429).json({
        error: "rate_limited",
        message: result.diagnosis,
      });
    }

    if (sessionId) await saveTurn(sessionId, resolvedBusinessId, message, result);

    // If the AI returned dashboard-style recommendations for this turn,
    // persist them so the Dashboard doesn't need to re-call the AI on
    // every page load — only on explicit refresh or first use. This
    // reuses the same /api/marketing endpoint rather than adding a new
    // one; whether a turn produced recommendations is simply up to the
    // AI's own judgment of the request, per the system prompt.
    if (Array.isArray(result.recommendations) && result.recommendations.length && resolvedBusinessId && supabase) {
      const validPriorities = new Set(["HIGH", "MEDIUM", "OPPORTUNITY"]);
      const validExecutionOptions = new Set(["generate_content", "create_campaign", "generate_post", "view_strategy"]);
      const rows = result.recommendations
        .filter((r) => r && validPriorities.has(r.priority) && r.problem && r.recommended_action)
        .slice(0, 3)
        .map((r) => ({
          business_id: resolvedBusinessId,
          priority: r.priority,
          problem: String(r.problem).slice(0, 2000),
          evidence: r.evidence ? String(r.evidence).slice(0, 2000) : null,
          recommended_action: String(r.recommended_action).slice(0, 2000),
          expected_goal: r.expected_goal ? String(r.expected_goal).slice(0, 2000) : null,
          execution_options: Array.isArray(r.execution_options)
            ? r.execution_options.filter((o) => validExecutionOptions.has(o))
            : [],
        }));

      if (rows.length) {
        // Replace the open set rather than accumulating forever — this is
        // "today's priorities," not a growing backlog.
        await supabase.from("marketing_recommendations").delete().eq("business_id", resolvedBusinessId).eq("status", "open");
        await supabase.from("marketing_recommendations").insert(rows);
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[/api/marketing] Request failed:", {
      name: err?.name,
      status: err?.status || err?.code,
      message: err?.message,
    });
    res.status(500).json({ error: "MARKETRA failed to respond. Check server logs." });
  }
});

module.exports = router;
