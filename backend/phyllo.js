const { createClient } = require("@supabase/supabase-js");

const PHYLLO_BASE_URL = process.env.PHYLLO_BASE_URL || "https://api.sandbox.insightiq.ai/v1";
const CLIENT_ID = process.env.PHYLLO_CLIENT_ID;
const CLIENT_SECRET = process.env.PHYLLO_CLIENT_SECRET;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

function authHeader() {
  // ⚠️ STILL UNCONFIRMED: the base URL and endpoint paths below have been
  // verified against InsightIQ's docs, but the authentication MECHANISM
  // itself (HTTP Basic with client_id:client_secret) has not — confirm
  // this against their current Authentication page before relying on it.
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}

/**
 * Finds this Marketra user's existing Phyllo user, or creates one.
 * Uses the Marketra user's own stable ID as the external identifier,
 * never a social handle. Stores the mapping in social_accounts.
 *
 * Path confirmed as {PHYLLO_BASE_URL}/users. ⚠️ STILL UNCONFIRMED: the
 * exact request body field names (`name` + `external_id` is a guess) and
 * the response shape (assumed to have a plain `.id` field below).
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
 * Path confirmed as {PHYLLO_BASE_URL}/sdk-tokens. ⚠️ STILL UNCONFIRMED:
 * the required body's `products` array values ("IDENTITY"/"ENGAGEMENT"
 * are guesses) and the response field name for the token itself.
 */
async function createSdkToken(phylloUserId) {
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
 * Path confirmed as {PHYLLO_BASE_URL}/profiles/{accountId}. ⚠️ STILL
 * UNCONFIRMED: the response field names below (work_platform, reputation,
 * etc.) are a best-effort guess at a common shape, not verified.
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
