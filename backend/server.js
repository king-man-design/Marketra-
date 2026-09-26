require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const marketingRoutes = require("./routes/marketing");
const phylloRoutes = require("./routes/phyllo");

const app = express();

// CSP is disabled here because this server is primarily a JSON API —
// the real frontend is hosted separately on Netlify. Helmet's other
// headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) still
// apply. If you start relying on this server's own static-file fallback
// in production, revisit this and configure a real CSP instead of off.
app.use(helmet({ contentSecurityPolicy: false }));

// Fail toward a known-safe default instead of wide-open "*" if
// CORS_ORIGIN was never set on Render — this app's own Netlify URL,
// rather than every origin on the internet.
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  console.warn(
    "[server] CORS_ORIGIN is not set — falling back to a hardcoded default. " +
    "Set CORS_ORIGIN in Render's environment variables to your real frontend URL."
  );
}
app.use(cors({ origin: corsOrigin || "https://marketraai.netlify.app" }));

app.use(
  "/api/phyllo/webhook",
  express.raw({ type: "application/json", limit: "1mb" })
);

app.use(express.json({ limit: "1mb" }));

// Serve the static frontend (optional — you can also host it separately).
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use("/api", marketingRoutes);
app.use("/api/phyllo", phylloRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MARKETRA backend running on http://localhost:${PORT}`);
});
