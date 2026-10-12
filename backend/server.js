require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const marketingRoutes = require("./routes/marketing");
const socialRoutes = require("./routes/social");
const adminRoutes = require("./routes/admin");

const app = express();
app.set("trust proxy", 3);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// CORS configuration
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin) {
  console.warn(
    "[server] CORS_ORIGIN is not set — falling back to a hardcoded default. " +
    "Set CORS_ORIGIN in Render's environment variables to your real frontend URL."
  );
}
app.use(cors({ origin: corsOrigin || "https://marketraai.netlify.app" }));

app.use(express.json({ limit: "1mb" }));

// Serve the static frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

// API routes
app.use("/api", marketingRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MARKETRA backend running on http://localhost:${PORT}`);
});
