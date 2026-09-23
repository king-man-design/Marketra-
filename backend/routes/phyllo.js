const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../authMiddleware");
const { getOrCreatePhylloUser, createSdkToken, getProfileAnalytics } = require("../phyllo");

const router = express.Router();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// POST /api/phyllo/token — authenticated. Never trusts a user id from the
// browser; req.userId comes only from requireAuth's server-side token check.
router.post("/token", requireAuth, async (req, res) => {
  try {
    const phylloUserId = await getOrCreatePhylloUser(req.userId);

    if (supabase) {
      await supabase
        .from("social_accounts")
        .upsert(
          { marketra_user_id: req.userId, phyllo_user_id: phylloUserId, connection_status: "pending" },
          { onConflict: "phyllo_user_id" }
        );
    }

    const sdkToken = await createSdkToken(phylloUserId);
    res.json({
      sdk_token: sdkToken,
      user_id: phylloUserId,
    });
  } catch (err) {
    console.error("[/api/phyllo/token]", err.message);
    res.status(502).json({ error: "Could not start the connection. Please try again." });
  }
});

// GET /api/phyllo/accounts — authenticated. Returns only the caller's own
// connected accounts.
router.get("/accounts", requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.json([]);
    const { data, error } = await supabase
      .from("social_accounts")
      .select("id, platform, handle, connection_status, last_sync_at, created_at")
      .eq("marketra_user_id", req.userId);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("[/api/phyllo/accounts]", err.message);
    res.status(500).json({ error: "Could not load connected accounts." });
  }
});

// POST /api/phyllo/webhook — verified via signature, not a user session.
router.post("/webhook", async (req, res) => {
  try {
    const signatureHeader = req.headers["webhook-signatures"];
    const secret = process.env.PHYLLO_WEBHOOK_SECRET;
    if (!signatureHeader || !secret) {
      return res.status(401).json({ error: "Missing webhook signature." });
    }

    const signatures = signatureHeader
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    const valid = signatures.some((signature) => {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("hex");

      const received = Buffer.from(signature, "utf8");
      const expectedBuffer = Buffer.from(expected, "utf8");

      return (
        received.length === expectedBuffer.length &&
        crypto.timingSafeEqual(received, expectedBuffer)
      );
    });

    if (!valid) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }

    const event = JSON.parse(req.body.toString("utf-8"));
    const phylloUserId = event?.data?.user_id;
    const phylloAccountId = event?.data?.account_id;
    const eventType = event?.event_type || event?.type;

    if (!phylloUserId || !supabase) {
      return res.status(200).json({ received: true });
    }

    if (eventType === "PROFILES.ADDED" || eventType === "PROFILES.UPDATED") {
      await supabase
        .from("social_accounts")
        .update({
          phyllo_account_id: phylloAccountId || null,
          connection_status: "connected",
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("phyllo_user_id", phylloUserId);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[/api/phyllo/webhook]", err.message);
    res.status(400).json({ error: "Could not process webhook." });
  }
});

// GET /api/phyllo/analytics/:accountId — authenticated, and only returns
// data for an account this user actually owns.
router.get("/analytics/:accountId", requireAuth, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: "Not configured." });
    const { data: account, error } = await supabase
      .from("social_accounts")
      .select("phyllo_account_id, marketra_user_id")
      .eq("id", req.params.accountId)
      .single();

    if (error || !account || account.marketra_user_id !== req.userId) {
      return res.status(404).json({ error: "Account not found." });
    }
    if (!account.phyllo_account_id) {
      return res.status(409).json({ error: "Account is not fully connected yet." });
    }

    const analytics = await getProfileAnalytics(account.phyllo_account_id);
    res.json(analytics);
  } catch (err) {
    console.error("[/api/phyllo/analytics]", err.message);
    res.status(502).json({ error: "Could not fetch analytics right now." });
  }
});

module.exports = router;
