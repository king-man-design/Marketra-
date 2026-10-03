const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../authMiddleware");
const { getOrCreatePhylloUser, createSdkToken, getProfileAnalytics } = require("../phyllo");
const { isValidUuid } = require("../validate");

const router = express.Router();

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Connecting accounts repeatedly is a plausible abuse/scraping vector and
// costs real API calls to Phyllo — cap it per IP.
const connectLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5, // 5 connection attempts / 5 minutes / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many connection attempts. Please wait a few minutes." },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // generous, but stops a runaway/malicious sender from hammering us
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/phyllo/token — authenticated. Never trusts a user id from the
// browser; req.userId comes only from requireAuth's server-side token check.
router.post("/token", connectLimiter, requireAuth, async (req, res) => {
  try {
    const phylloUserId = await getOrCreatePhylloUser(req.userId);

    if (supabase) {
      const { error: accountError } = await supabase
        .from("social_accounts")
        .upsert(
          { marketra_user_id: req.userId, phyllo_user_id: phylloUserId, connection_status: "pending" },
          { onConflict: "phyllo_user_id" }
        );
      if (accountError) throw accountError;
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
router.post("/webhook", webhookLimiter, async (req, res) => {
  try {
    const signatureHeader = req.headers["webhook-signatures"];
    const secret = process.env.PHYLLO_WEBHOOK_SECRET;
    if (!signatureHeader || !secret) {
      console.warn(`[phyllo webhook] missing signature from ${req.ip}`);
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
      console.warn(`[phyllo webhook] invalid signature from ${req.ip}`);
      return res.status(401).json({ error: "Invalid webhook signature." });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString("utf-8"));
    } catch {
      return res.status(400).json({ error: "Malformed JSON body." });
    }

    // Idempotency: InsightIQ/Phyllo webhooks are at-least-once delivery,
    // so the same event can arrive more than once. Order matters here —
    // we CHECK for a prior successful processing first (read-only), do
    // the actual work, and only mark the event as processed AFTER it
    // succeeds. Marking it processed before processing (the previous
    // bug) meant a failed event could never be retried: the row would
    // already exist, so a retry would be silently treated as a duplicate
    // and dropped instead of reprocessed.
    //
    // ⚠️ CONFIRM the actual field name InsightIQ uses for a unique event
    // identifier — assumed here as event.id, falling back to event.event_id.
    const eventId = event?.id || event?.event_id;
    if (!eventId || typeof eventId !== "string") {
      console.error("[phyllo webhook] missing event ID");
      return res.status(400).json({ error: "Missing event ID" });
    }

    if (supabase) {
      const { data: already } = await supabase
        .from("webhook_events")
        .select("event_id")
        .eq("event_id", eventId)
        .maybeSingle();
      if (already) {
        console.log(`[phyllo webhook] duplicate event ${eventId}, skipping`);
        return res.status(200).json({ received: true, duplicate: true });
      }
    }

    const phylloUserId = event?.data?.user_id;
    const phylloAccountId = event?.data?.account_id;
    const eventType = event?.event_type || event?.type;

    if (!supabase) {
      console.error("[phyllo webhook] Supabase is not configured; refusing to acknowledge event");
      return res.status(503).json({ error: "Webhook processing is not configured." });
    }

    const supportedEvent = eventType === "PROFILES.ADDED" || eventType === "PROFILES.UPDATED";

    // We can safely acknowledge event types MARKETRA does not currently
    // process, but only after recording their event ID. This prevents
    // endless provider retries while making it explicit that the event was
    // intentionally ignored rather than silently failing validation.
    if (!supportedEvent) {
      const { error: ignoredError } = await supabase
        .from("webhook_events")
        .insert({ event_id: eventId });
      if (ignoredError && ignoredError.code !== "23505") throw ignoredError;
      return res.status(200).json({ received: true, ignored: true });
    }

    // Supported profile events must contain the identifiers needed to apply
    // the update. Returning non-2xx keeps malformed events retryable instead
    // of permanently acknowledging data MARKETRA could not process.
    if (!phylloUserId || typeof phylloUserId !== "string" || !phylloAccountId || typeof phylloAccountId !== "string") {
      console.error("[phyllo webhook] supported event is missing user/account identifiers");
      return res.status(400).json({ error: "Incomplete webhook event." });
    }

    // phylloUserId only ever gets matched against rows WE created via
    // getOrCreatePhylloUser — a webhook can't invent a new mapping, only
    // update one that already exists, so this can't be used to attach
    // data to an arbitrary account.

    // --- Processing happens here, BEFORE marking the event processed. ---
    // If this throws, we fall into the catch block below, return a
    // non-2xx response, and — critically — never reach the webhook_events
    // insert, so InsightIQ's retry will be handled as a fresh attempt.
    if (supportedEvent) {
      const { error: updateError } = await supabase
        .from("social_accounts")
        .update({
          phyllo_account_id: phylloAccountId || null,
          connection_status: "connected",
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("phyllo_user_id", phylloUserId);
      if (updateError) throw updateError;
    }

    // Only reaching here means processing succeeded — now, and only now,
    // record the event as done. A unique-constraint failure here (23505)
    // means a concurrent duplicate delivery recorded it microseconds
    // ago; since both would have applied the same idempotent update
    // above, that's harmless and not an error worth surfacing.
    //
    // Note: there is no multi-statement database transaction tying the
    // update above and this insert together — supabase-js's REST client
    // doesn't expose one without a custom Postgres function (RPC), which
    // wasn't introduced here to keep this change small. The small window
    // between a successful update and this insert is an accepted
    // limitation: a crash in that exact window would cause one
    // harmless reprocessing on retry (the update is idempotent), not
    // data corruption or a permanently stuck event.
    if (supabase) {
      const { error: markError } = await supabase.from("webhook_events").insert({ event_id: eventId });
      if (markError && markError.code !== "23505") {
        console.error("[phyllo webhook] failed to record processed event (processing itself succeeded):", markError.message);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    // Processing failed — the event was deliberately NOT marked as
    // processed above, so InsightIQ's retry will be handled as a new
    // attempt, not silently dropped as a duplicate.
    console.error("[/api/phyllo/webhook] processing failed, event not marked processed:", err.message);
    res.status(500).json({ error: "Could not process webhook." });
  }
});

// GET /api/phyllo/analytics/:accountId — authenticated, and only returns
// data for an account this user actually owns.
router.get("/analytics/:accountId", requireAuth, async (req, res) => {
  try {
    if (!isValidUuid(req.params.accountId)) {
      return res.status(400).json({ error: "Invalid account id." });
    }
    if (!supabase) return res.status(500).json({ error: "Not configured." });
    const { data: account, error } = await supabase
      .from("social_accounts")
      .select("phyllo_account_id, marketra_user_id")
      .eq("id", req.params.accountId)
      .single();

    if (error || !account || account.marketra_user_id !== req.userId) {
      console.warn(`[phyllo analytics] user ${req.userId} attempted to access account ${req.params.accountId} they do not own`);
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
