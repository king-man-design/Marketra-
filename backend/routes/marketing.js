const express = require("express");
const { askMarketra } = require("../ai");
const { getBusiness, getRecentHistory, saveTurn, upsertBusiness } = require("../business");

const router = express.Router();

// POST /api/marketing — main chat/diagnosis endpoint
router.post("/marketing", async (req, res) => {
  try {
    const { message, businessId, business: inlineBusiness } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const business = businessId ? await getBusiness(businessId) : inlineBusiness;
    const history = businessId ? await getRecentHistory(businessId) : [];

    const result = await askMarketra({ business, history, message });

    if (result._rate_limited) {
      return res.status(429).json({
        error: "rate_limited",
        message: result.diagnosis,
      });
    }

    if (businessId) await saveTurn(businessId, message, result);

    res.json(result);
  } catch (err) {
    console.error("[/api/marketing]", err);
    res.status(500).json({ error: "MARKETRA failed to respond. Check server logs." });
  }
});

// POST /api/business — create or update the business profile (memory)
router.post("/business", async (req, res) => {
  try {
    const saved = await upsertBusiness(req.body);
    res.json(saved);
  } catch (err) {
    console.error("[/api/business]", err);
    res.status(500).json({ error: "Could not save business profile." });
  }
});

// GET /api/business/:id — fetch a business profile
router.get("/business/:id", async (req, res) => {
  const business = await getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: "Not found" });
  res.json(business);
});

module.exports = router;
