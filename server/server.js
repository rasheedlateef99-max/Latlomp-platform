/* ============================================
   LATLOMP PLATFORM — SERVER ENTRY POINT
============================================ */

const express = require("express");
const path    = require("path");
const cors    = require("cors");
require("dotenv").config();

const connectDB = require("./config/database");

const app  = express();
const PORT = process.env.PORT || 3000;

/* ============================================
   SECURITY MIDDLEWARE
============================================ */
const { applySecurityMiddleware } = require("./middleware/security.middleware");
applySecurityMiddleware(app);

/* ============================================
   DATABASE
============================================ */
connectDB();

/* ============================================
   CORS
============================================ */
app.use(cors());

/* ============================================
   RAW BODY PARSER (Paystack webhooks)
   Must come BEFORE express.json()
============================================ */
app.use("/api/payment/webhook",             express.raw({ type: "application/json" }));
app.use("/api/institution/payment/webhook", express.raw({ type: "application/json" }));

/* ============================================
   JSON BODY PARSER
============================================ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ============================================
   STATIC FILES
============================================ */
app.use(express.static(path.join(__dirname, "../public")));

/* ============================================
   MAIN PLATFORM ROUTES
============================================ */
app.use("/api/auth",    require("./routes/auth.routes"));
app.use("/api/teacher", require("./routes/teacher.routes"));
app.use("/api/payment", require("./routes/payment.routes"));
app.use("/api/store",   require("./routes/store.routes"));
app.use("/api/cbt",     require("./routes/cbt.routes"));
app.use("/api/exams",   require("./routes/exam.routes"));
app.use("/api/admin",   require("./routes/admin.routes"));

/* ============================================
   INSTITUTION ROUTES
============================================ */
app.use("/api/institution/auth",       require("./institution/routes/inst.auth.routes"));
app.use("/api/institution/school",     require("./institution/routes/inst.school.routes"));
app.use("/api/institution/teacher",    require("./institution/routes/inst.teacher.routes"));
app.use("/api/institution/student",    require("./institution/routes/inst.student.routes"));
app.use("/api/institution/superadmin", require("./institution/routes/inst.superadmin.routes"));
app.use("/api/institution/payment",    require("./institution/routes/inst.payment.routes"));
app.use("/api/institution/structure",  require("./institution/routes/inst.structure.routes"));
app.use("/api/institution/report",     require("./institution/routes/inst.report.routes"));
app.use("/api/institution/students",   require("./institution/routes/inst.student.mgmt.routes"));
app.use("/api/institution/paper",      require("./institution/routes/inst.paper.routes"));
/* ✅ PHASE L.3: Score Entry System */
app.use("/api/institution/score",      require("./institution/routes/inst.score.routes"));

/* ============================================
   HEALTH CHECK
============================================ */
app.get("/api/health", function (req, res) {
  return res.status(200).json({
    success:   true,
    message:   "LatLomp Platform API is running.",
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV || "development"
  });
});

/* ============================================
   PHASE E — SLUG RESOLVER ROUTE
============================================ */
app.get("/i/:slug", function (req, res) {
  res.sendFile(path.join(__dirname, "../public/i/index.html"));
});

/* ============================================
   CATCH-ALL — SPA routing (MUST be last)
============================================ */
app.get("*", function (req, res) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ success: false, message: "API route not found." });
  }
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

/* ============================================
   GLOBAL ERROR HANDLER
============================================ */
app.use(function (err, req, res, next) {
  console.error("Unhandled error:", err.message);
  console.error(err.stack);
  return res.status(500).json({ success: false, message: "Internal server error." });
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