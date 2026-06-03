/* ============================================
   LATLOMP PLATFORM — SERVER ENTRY POINT
============================================ */

const express = require("express");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/database");

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================
   DATABASE
============================================ */
connectDB();

/* ============================================
   MIDDLEWARE
============================================ */
app.use(cors());

/*
  Raw body parser for Paystack webhook HMAC verification.
  Must come BEFORE express.json() so the raw body is accessible.
  Only applied to the webhook route.
*/
app.use("/api/payment/webhook", express.raw({ type: "application/json" }));

/* JSON body parser for all other routes */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ============================================
   STATIC FILES — serve the public/ folder
============================================ */
app.use(express.static(path.join(__dirname, "../public")));

/* ============================================
   API ROUTES
   
   Order matters:
   - webhook raw body parser must be before express.json
   - all /api/* routes go here
   - catch-all HTML serve goes LAST
============================================ */
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/teacher", require("./routes/teacher.routes"));
app.use("/api/payment", require("./routes/payment.routes"));
app.use("/api/store", require("./routes/store.routes"));
app.use("/api/cbt", require("./routes/cbt.routes"));
/*
  If you have additional routes (exam, student, etc.)
  that existed before this session, keep them here:
*/
app.use("/api/exams", require("./routes/exam.routes"));
// app.use('/api/student', require('./routes/student.routes'));

/* ============================================
   HEALTH CHECK
============================================ */
app.get("/api/health", function (req, res) {
  return res.status(200).json({
    success: true,
    message: "LatLomp Platform API is running.",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

/* ============================================
   CATCH-ALL — serve index.html for SPA routing
   Must be LAST
============================================ */
app.get("*", function (req, res) {
  /* Only serve HTML for non-API routes */
  if (req.path.startsWith("/api/")) {
    return res
      .status(404)
      .json({ success: false, message: "API route not found." });
  }
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

/* ============================================
   GLOBAL ERROR HANDLER
============================================ */
app.use(function (err, req, res, next) {
  console.error("Unhandled error:", err.message);
  console.error(err.stack);
  return res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

/* ============================================
   START SERVER
============================================ */
app.listen(PORT, function () {
  console.log("");
  console.log("⚡ LatLomp Platform running on port " + PORT);
  console.log("   Environment: " + (process.env.NODE_ENV || "development"));
  console.log("   URL: http://localhost:" + PORT);
  console.log("");
});

module.exports = app;
