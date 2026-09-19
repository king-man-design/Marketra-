const { createClient } = require("@supabase/supabase-js");

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

async function getBusiness(businessId) {
  if (!supabase || !businessId) return null;
  const { data, error } = await supabase
    .from("businesses")
    .select("*, products(*)")
    .eq("id", businessId)
    .single();
  if (error) return null;
  return data;
}

async function getRecentHistory(businessId, limit = 3) {
  if (!supabase || !businessId) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("user_message, ai_response, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  // Flatten to Anthropic message format, oldest first.
  return data.reverse().flatMap((row) => [
    { role: "user", content: row.user_message },
    { role: "assistant", content: JSON.stringify(row.ai_response) },
  ]);
}

async function saveTurn(businessId, userMessage, aiResponse) {
  if (!supabase || !businessId) return;
  await supabase.from("conversations").insert({
    business_id: businessId,
    user_message: userMessage,
    ai_response: aiResponse,
  });
}

async function upsertBusiness(profile) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("businesses")
    .upsert(profile)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = { getBusiness, getRecentHistory, saveTurn, upsertBusiness };
