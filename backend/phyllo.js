const { createClient } = require("@supabase/supabase-js");

const PHYLLO_BASE_URL = process.env.PHYLLO_BASE_URL || "https://api.sandbox.getphyllo.com";
const CLIENT_ID = process.env.PHYLLO_CLIENT_ID;
const CLIENT_SECRET = process.env.PHYLLO_CLIENT_SECRET;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

function authHeader() {
  // Phyllo's docs, last time this pattern was common, used HTTP Basic
  // auth with client_id:client_secret. CONFIRM this against their
  // current Authentication page before relying on it — if they've
  // moved to a bearer-token/OAuth flow this needs to change.
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

/**
 * Finds this Marketra user's existing Phyllo user, or creates one.
 * Uses the Marketra user's own stable ID as the external identifier,
 * never a social handle. Stores the mapping in social_accounts.
 *
 * ⚠️ CONFIRM against Phyllo's current "Create User" docs: exact path,
 * whether it's POST /v1/users, required body fields (they've used
 * `name` + `external_id` historically — verify current field names).
 */
async function getOrCreatePhylloUser(marketraUserId) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: existing } = await supabase
    .from("social_accounts")
    .select("phyllo_user_id")
    .eq("marketra_user_id", marketraUserId)
    .limit(1)
    .maybeSingle();

  if (existing?.phyllo_user_id) return existing.phyllo_user_id;

  // --- CONFIRM THIS CALL against current Phyllo docs ---
  const res = await fetch(`${PHYLLO_BASE_URL}/users`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      name: `marketra-user-${marketraUserId}`,
      external_id: marketraUserId,
    }),
  });
  if (!res.ok) {
    throw new Error(`Phyllo create-user failed: ${res.status} ${await res.text()}`);
  }
  const user = await res.json();
  // Expecting something like { id: "phyllo-user-uuid", ... } — confirm
  // the actual response field name for the user id.
  return user.id;
}

/**
 * Requests an SDK token for this user, used by the frontend Connect
 * widget. Never returns anything but the token itself to the caller.
 *
 * ⚠️ CONFIRM against Phyllo's current "SDK Token" docs: exact path
 * (historically POST /v1/sdk-tokens), required body (user_id, products
 * array, etc.), and current supported "products"/scopes list.
 */
async function createSdkToken(phylloUserId) {
  // --- CONFIRM THIS CALL against current Phyllo docs ---
  const res = await fetch(`${PHYLLO_BASE_URL}/sdk-tokens`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      user_id: phylloUserId,
      products: ["IDENTITY", "ENGAGEMENT"], // confirm current product names
    }),
  });
  if (!res.ok) {
    throw new Error(`Phyllo sdk-token failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.sdk_token; // confirm actual field name
}

/**
 * Fetches normalized profile/analytics data for a connected account.
 *
 * ⚠️ CONFIRM the exact endpoint and field names — this is a best-effort
 * shape based on common patterns, not a verified current Phyllo response.
 */
async function getProfileAnalytics(phylloAccountId) {
  const res = await fetch(`${PHYLLO_BASE_URL}/profiles/${phylloAccountId}`, {
    headers: authHeader(),
  });
  if (!res.ok) {
    throw new Error(`Phyllo profile fetch failed: ${res.status} ${await res.text()}`);
  }
  const raw = await res.json();

  return {
    platform: raw.work_platform?.name ?? raw.platform ?? null,
    username: raw.username ?? null,
    followers: raw.reputation?.follower_count ?? raw.follower_count ?? null,
    engagement_rate: raw.reputation?.engagement_rate ?? null,
    content_count: raw.reputation?.content_count ?? null,
    average_views: raw.reputation?.average_views ?? null,
    last_updated: new Date().toISOString(),
  };
}

module.exports = { getOrCreatePhylloUser, createSdkToken, getProfileAnalytics };
