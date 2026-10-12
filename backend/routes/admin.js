const express = require("express");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { requireAuth } = require("../authMiddleware");

const router = express.Router();
const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const adminIds = new Set((process.env.ADMIN_USER_IDS || "").split(",").map((v) => v.trim()).filter(Boolean));
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many admin requests. Try again shortly." } });

async function requireAdmin(req, res, next) {
  if (!supabaseAdmin) return res.status(503).json({ error: "Admin service is not configured." });
  if (!adminIds.size) return res.status(503).json({ error: "No administrators are configured." });
  if (!adminIds.has(req.userId)) return res.status(403).json({ error: "Administrator access required." });
  next();
}
router.use(adminLimiter, requireAuth, requireAdmin);

function dayStart(offsetDays = 0) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - offsetDays); return d.toISOString();
}
function safeUser(user, subscription) {
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || null,
    signupDate: user.created_at || null,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    lastSignIn: user.last_sign_in_at || null,
    fullName: typeof meta.full_name === "string" ? meta.full_name.slice(0, 120) : null,
    plan: subscription?.plan || "free",
    subscriptionStatus: subscription?.status || "none",
    currentPeriodEnd: subscription?.current_period_end || null,
    billingProvider: subscription?.provider || null,
    aiUsage: null
  };
}

async function loadUsers(page, perPage) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
  if (error) throw error;
  return data;
}
async function loadUsersForOverview() {
  const users = []; let total = 0;
  for (let page = 1; page <= 20; page++) {
    const result = await loadUsers(page, 1000);
    total = result.total ?? total;
    users.push(...(result.users || []));
    if (!(result.users || []).length || users.length >= total || (result.users || []).length < 1000) break;
  }
  return { users, total, complete: users.length >= total };
}
async function loadSubscriptions(userIds) {
  if (!userIds.length) return new Map();
  const { data, error } = await supabaseAdmin.from("user_subscriptions")
    .select("user_id, plan, status, current_period_end, provider, updated_at")
    .in("user_id", userIds);
  if (error && error.code === "42P01") return new Map();
  if (error) throw error;
  const result = new Map();
  for (const row of data || []) {
    const existing = result.get(row.user_id);
    if (!existing || new Date(row.updated_at || 0) > new Date(existing.updated_at || 0)) result.set(row.user_id, row);
  }
  return result;
}

router.get("/overview", async (req, res) => {
  try {
    const first = await loadUsersForOverview();
    const users = first.users || [];
    const subs = await loadSubscriptions(users.map((u) => u.id));
    const today = dayStart(0), week = dayStart(6), month = new Date(); month.setUTCDate(1); month.setUTCHours(0,0,0,0);
    const count = (fn) => users.filter(fn).length;
    const userRows = users.map((u) => safeUser(u, subs.get(u.id)));
    const revenueResult = await supabaseAdmin.from("user_subscriptions").select("monthly_amount, currency, status").eq("status", "active");
    let mrr = null;
    if (!revenueResult.error) {
      const rows = revenueResult.data || [];
      const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));
      if (rows.every((r) => Number.isFinite(Number(r.monthly_amount))) && currencies.size <= 1) {
        mrr = rows.reduce((sum, r) => sum + Number(r.monthly_amount), 0);
      }
    } else if (revenueResult.error.code !== "42P01") throw revenueResult.error;
    let businesses = null, conversations = null;
    const [businessCount, conversationCount] = await Promise.all([
      supabaseAdmin.from("businesses").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("conversations").select("id", { count: "exact", head: true })
    ]);
    if (!businessCount.error) businesses = businessCount.count;
    if (!conversationCount.error) conversations = conversationCount.count;
    res.json({
      generatedAt: new Date().toISOString(),
      users: {
        total: first.total ?? users.length,
        countCoverageComplete: first.complete,
        free: count((u) => (subs.get(u.id)?.plan || "free") === "free"),
        pro: count((u) => subs.get(u.id)?.plan === "pro"),
        business: count((u) => subs.get(u.id)?.plan === "business"),
        trial: count((u) => subs.get(u.id)?.status === "trialing"),
        activeSubscriptions: count((u) => subs.get(u.id)?.status === "active"),
        cancelledSubscriptions: count((u) => ["cancelled", "canceled"].includes(subs.get(u.id)?.status)),
        signupsToday: count((u) => u.created_at >= today),
        signupsThisWeek: count((u) => u.created_at >= week),
        signupsThisMonth: count((u) => u.created_at >= month.toISOString()),
        verified: count((u) => Boolean(u.email_confirmed_at || u.confirmed_at))
      },
      mrr: { amount: mrr, currency: revenueResult.data?.[0]?.currency || null, source: mrr === null ? "unavailable" : "user_subscriptions" },
      usage: { businesses, conversations, aiRequests: null, note: "AI request usage is not tracked in the current schema." }
    });
  } catch (err) {
    console.error("[admin overview]", err.message);
    res.status(500).json({ error: "Could not load admin overview." });
  }
});

router.get("/users", async (req, res) => {
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const perPage = Math.max(1, Math.min(50, Number.parseInt(req.query.perPage, 10) || 20));
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120).toLowerCase() : "";
  const plan = ["free", "pro", "business"].includes(req.query.plan) ? req.query.plan : "all";
  const status = ["none", "active", "trialing", "cancelled", "canceled", "past_due"].includes(req.query.status) ? req.query.status : "all";
  try {
    // Supabase Auth Admin API paginates users; cap scan to avoid unbounded work.
    const maxPages = 20, all = [];
    let total = 0;
    for (let p = 1; p <= maxPages; p++) {
      const result = await loadUsers(p, 1000); total = result.total ?? total;
      all.push(...(result.users || []));
      if (!(result.users || []).length || all.length >= total || (result.users || []).length < 1000) break;
    }
    const subs = await loadSubscriptions(all.map((u) => u.id));
    let rows = all.map((u) => safeUser(u, subs.get(u.id)));
    if (search) rows = rows.filter((u) => (u.email || "").toLowerCase().includes(search) || u.id.toLowerCase().includes(search) || (u.fullName || "").toLowerCase().includes(search));
    if (plan !== "all") rows = rows.filter((u) => u.plan === plan);
    if (status !== "all") rows = rows.filter((u) => u.subscriptionStatus === status);
    const filteredTotal = rows.length;
    rows = rows.slice((page - 1) * perPage, page * perPage);
    res.json({ users: rows, page, perPage, total: filteredTotal, authTotal: total, hasMore: page * perPage < filteredTotal || all.length < total });
  } catch (err) {
    console.error("[admin users]", err.message);
    res.status(500).json({ error: "Could not load users." });
  }
});

router.get("/users/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: "Invalid user ID." });
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
    if (error || !data?.user) return res.status(404).json({ error: "User not found." });
    const subs = await loadSubscriptions([id]);
    const user = safeUser(data.user, subs.get(id));
    const { count: businessCount, error: businessError } = await supabaseAdmin.from("businesses").select("id", { count: "exact", head: true }).eq("user_id", id);
    if (businessError) throw businessError;
    res.json({ user: { ...user, businessCount, aiUsage: null } });
  } catch (err) {
    console.error("[admin user detail]", err.message);
    res.status(500).json({ error: "Could not load user details." });
  }
});
module.exports = router;
