const { createClient } = require("@supabase/supabase-js");

// Server-side client, used only to VERIFY tokens (not to bypass RLS —
// that's a separate service-role client elsewhere for trusted writes).
const supabaseAuth =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

/**
 * Requires a valid Supabase session. Reads the Authorization: Bearer <token>
 * header, verifies it against Supabase's own servers (auth.getUser), and
 * sets req.userId to the REAL, server-confirmed user id.
 *
 * Never trust a userId/businessId the browser sends in the request body for
 * anything security-sensitive — always use req.userId set here instead.
 */
async function requireAuth(req, res, next) {
  try {
    if (!supabaseAuth) {
      return res.status(500).json({ error: "Auth is not configured on the server." });
    }
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      console.warn(`[auth] missing token on ${req.method} ${req.originalUrl} from ${req.ip}`);
      return res.status(401).json({ error: "Missing Authorization header." });
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      console.warn(`[auth] invalid/expired token on ${req.method} ${req.originalUrl} from ${req.ip}`);
      return res.status(401).json({ error: "Invalid or expired session." });
    }

    req.userId = data.user.id;
    next();
  } catch (err) {
    console.error("[requireAuth]", err);
    res.status(500).json({ error: "Authentication check failed." });
  }
}

module.exports = { requireAuth };
