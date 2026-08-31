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

/* Institution admin endpoints reachable at /api/admin */
app.use("/api/admin",   require("./institution/routes/inst.superadmin.routes"));

/* ============================================
   INSTITUTION ROUTES
============================================ */
app.use("/api/institution/auth",           require("./institution/routes/inst.auth.routes"));
app.use("/api/institution/school",         require("./institution/routes/inst.school.routes"));
app.use("/api/institution/teacher",        require("./institution/routes/inst.teacher.routes"));
app.use("/api/institution/student",        require("./institution/routes/inst.student.routes"));
app.use("/api/institution/superadmin",     require("./institution/routes/inst.superadmin.routes"));
app.use("/api/institution/payment",        require("./institution/routes/inst.payment.routes"));
app.use("/api/institution/structure",      require("./institution/routes/inst.structure.routes"));
app.use("/api/institution/report",         require("./institution/routes/inst.report.routes"));
app.use("/api/institution/students",       require("./institution/routes/inst.student.mgmt.routes"));
app.use("/api/institution/paper",          require("./institution/routes/inst.paper.routes"));
app.use("/api/institution/score",          require("./institution/routes/inst.score.routes"));
app.use("/api/institution/reportcard",     require("./institution/routes/inst.reportcard.routes"));
app.use("/api/institution/timetable",      require("./institution/routes/inst.timetable.routes"));
app.use("/api/institution/attendance",     require("./institution/routes/inst.attendance.routes"));
/* ✅ PHASE P: Student Authenticated Portal */
app.use("/api/institution/student-portal", require("./institution/routes/inst.student.portal.routes"));

/* ✅ PHASE R: Fee Management */
app.use("/api/institution/fee", require("./institution/routes/inst.fee.routes"));
/* ✅ PHASE R2: Register payment providers (must come before routes) */
require("./institution/providers/registry");
/* ✅ PHASE S: Academic Promotion System */
app.use("/api/institution/promotion",   require("./institution/routes/inst.promotion.routes"));
/* ✅ E1A: Academic Progression Engine (read-only evaluation) */
app.use("/api/institution/progression", require("./institution/routes/inst.progression.routes"));
/* ✅ E2: Lifetime Academic Portfolio */
app.use("/api/institution/portfolio", require("./institution/routes/inst.portfolio.routes"));
/* ✅ E3: Digital Result Archive */
app.use("/api/institution/archive", require("./institution/routes/inst.result.archive.routes"));
/* ✅ E5: Digital Transcript & Verification (authenticated) */
app.use("/api/institution/transcripts", require("./institution/routes/inst.transcript.routes"));
/* ✅ E6: Alumni Network — admin management (mount before self-service) */
app.use("/api/institution/alumni", require("./institution/routes/inst.alumni.admin.routes"));
/* ✅ E7: Parent Portal Expansion — institution staff comms management */
app.use("/api/institution/parent-comms", require("./institution/routes/inst.parent.comms.routes"));
/* ✅ E6: Alumni Network — self-service (alumni-authenticated) */
app.use("/api/institution/alumni", require("./institution/routes/inst.alumni.routes"));
/* ✅ E5: Public Transcript Verification */
app.use("/api/verify", require("./institution/routes/inst.transcript.verify.routes"));
/* ✅ E1B: Result Access Portal (institution admin) */
var portalRoutes = require("./institution/routes/inst.result.portal.routes");
app.use("/api/institution/portal", portalRoutes.adminRouter);
/* ✅ E1B: Result Access Portal (public) */
app.use("/api/portal",             portalRoutes.publicRouter);
/* ✅ PHASE R2: Online Payments + Adjustments */
app.use("/api/institution/fee", require("./institution/routes/inst.fee.online.routes"));
/* ✅ PHASE Q: Parent Portal */
app.use("/api/institution/parent/auth", require("./institution/routes/parent.auth.routes"));
app.use("/api/institution/parent",      require("./institution/routes/parent.routes"));
/* ============================================
   PLATFORM ADMINISTRATION ROUTES
   Separate from all existing route namespaces.
   /api/platform-auth  — Google OAuth for platform staff
   /api/platform-staff — Staff CRUD (Stage 2)
   Root Super Admin uses /api/admin (existing, untouched).
============================================ */
app.use("/api/platform-auth",  require("./platform/routes/platform.auth.routes"));
app.use("/api/platform-staff", require("./platform/routes/platform.staff.routes"));

/* ============================================
   QUESTION MANAGEMENT SYSTEM
   Lives inside Platform Administration.
   Uses adminOrPlatformStaff('question_import') guard.
   Platform Staff require explicit permission.
   Root Admin always has access.
============================================ */
app.use("/api/qms", require("./platform/routes/qms.routes"));

/* ============================================
   EXAMINATION CORE ENGINE (ECE)
   Shared examination infrastructure.
   Scope-isolated: each system configures only itself.
   /api/ece/config/cbt         → Root Admin only
   /api/ece/config/institution → Institution Admin only
   /api/ece/config/teacher     → Teacher only
   /api/ece/session-config/*   → Public (exam pages)
============================================ */
app.use("/api/ece", require("./ece/routes/ece.config.routes"));

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