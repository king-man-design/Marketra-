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

    const result = await askMarketra({ business, history, message });

    if (result._rate_limited) {
      return res.status(429).json({
        error: "rate_limited",
        message: result.diagnosis,
      });
    }

    if (sessionId) await saveTurn(sessionId, resolvedBusinessId, message, result);

    res.json(result);
  } catch (err) {
    console.error("[/api/marketing]", err);
    res.status(500).json({ error: "MARKETRA failed to respond. Check server logs." });
  }
});

module.exports = router;
