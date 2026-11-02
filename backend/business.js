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

  return data.reverse().flatMap((row) => {
    const turns = [];
    if (typeof row.user_message === "string" && row.user_message.trim()) {
      turns.push({ role: "user", content: row.user_message });
    }

    // Do not feed legacy structured/JSON responses back to Gemini as examples.
    // That can teach the model to keep answering in the old dashboard schema.
    const saved = row.ai_response;
    let assistantText = typeof saved === "string" ? saved : null;
    if (assistantText) {
      const trimmed = assistantText.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          assistantText = parsed.answer || parsed.response || parsed.message || parsed.text || parsed.content || null;
        } catch {
          assistantText = null;
        }
      }
    } else if (saved && typeof saved === "object") {
      assistantText = saved.answer || saved.response || saved.message || saved.text || saved.content || null;
    }

    // Keep only genuine plain-text assistant turns. Ignore old schema objects.
    if (typeof assistantText === "string" && assistantText.trim() &&
        !assistantText.trim().startsWith("{") && !assistantText.trim().startsWith("[")) {
      turns.push({ role: "assistant", content: assistantText });
    }
    return turns;
  });
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
