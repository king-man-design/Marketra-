const express = require("express");
const { askMarketra } = require("../ai");
const { getBusiness, getRecentHistory, saveTurn } = require("../business");

const router = express.Router();

// POST /api/marketing — the only thing that needs the backend at all,
// since it's the only place GEMINI_API_KEY lives. Business profile and
// chat history CRUD now happen directly from the frontend via
// supabase-js, protected by Row Level Security.
router.post("/marketing", async (req, res) => {
  try {
    const { message, businessId, sessionId, business: inlineBusiness } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const business = businessId ? await getBusiness(businessId) : inlineBusiness;
    const history = sessionId ? await getRecentHistory(sessionId) : [];

    const result = await askMarketra({ business, history, message });

    if (result._rate_limited) {
      return res.status(429).json({
        error: "rate_limited",
        message: result.diagnosis,
      });
    }

    if (sessionId) await saveTurn(sessionId, businessId, message, result);

    res.json(result);
  } catch (err) {
    console.error("[/api/marketing]", err);
    res.status(500).json({ error: "MARKETRA failed to respond. Check server logs." });
  }
});

module.exports = router;
