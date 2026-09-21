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

async function getRecentHistory(sessionId, limit = 3) {
  if (!supabase || !sessionId) return [];
  const { data, error } = await supabase
    .from("conversations")
    .select("user_message, ai_response, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  return data.reverse().flatMap((row) => [
    { role: "user", content: row.user_message },
    { role: "assistant", content: JSON.stringify(row.ai_response) },
  ]);
}

async function saveTurn(sessionId, businessId, userMessage, aiResponse) {
  if (!supabase || !sessionId) return;
  await supabase.from("conversations").insert({
    session_id: sessionId,
    business_id: businessId || null,
    user_message: userMessage,
    ai_response: aiResponse,
  });
}

module.exports = { getBusiness, getRecentHistory, saveTurn };
