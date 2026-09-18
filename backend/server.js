require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const marketingRoutes = require("./routes/marketing");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "1mb" }));

// Serve the static frontend (optional — you can also host it separately).
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use("/api", marketingRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MARKETRA backend running on http://localhost:${PORT}`);
});
