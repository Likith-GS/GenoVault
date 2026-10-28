require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const connectDB = require("./config/db");

// ── Route imports ────────────────────────────────────────────
const authRoutes        = require("./routes/authRoutes");
const otpRoutes         = require("./routes/otpRoutes");
const fileRoutes        = require("./routes/fileRoutes");
const accessRoutes      = require("./routes/accessRoutes");
const blockchainRoutes  = require("./routes/blockchainRoutes");
const auditRoutes       = require("./routes/auditRoutes");
const integrityRoutes   = require("./routes/integrityRoutes");
const provenanceRoutes  = require("./routes/provenanceRoutes");  // Provenance & Misuse Detection


// ─────────────────────────────────────────────────────────────
const app = express();

// ── 1. Connect to MongoDB + Azure bootstrap ──────────────────
connectDB().then(async () => {
  // ── Startup recovery: reset files stuck in "uploading" ─────
  // If the server crashed/restarted mid-IPFS-upload, status stays
  // "uploading" forever. Reset to "failed" so users can retry.
  try {
    const GenomicFile = require("./models/GenomicFile");
    const stuckCount  = await GenomicFile.countDocuments({ ipfsStatus: "uploading" });
    if (stuckCount > 0) {
      await GenomicFile.updateMany(
        { ipfsStatus: "uploading" },
        { $set: { ipfsStatus: "failed" } }
      );
      console.log(`[Startup] ⚠️  Reset ${stuckCount} stuck IPFS upload(s) to "failed" — use retry to re-run.`);
    }
  } catch (err) {
    console.warn("[Startup] Could not run IPFS recovery:", err.message);
  }
});


// Ensure Azure Blob container exists + CORS configured on startup (non-blocking)
const { ensureContainerExists, configureCors } = require("./services/azureService");
const { runStartupValidation }                = require("./services/walletSecurityService");
ensureContainerExists().catch(() => { });
configureCors().catch(() => { }); // Critical for fast browser-direct uploads
runStartupValidation().catch(() => { }); // Phase 3: wallet + identity config check

// ── 2. Security middleware ────────────────────────────────────
app.use(helmet()); // Sets secure HTTP headers

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:8080",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: [
      "Content-Disposition",
      "Content-Length",
      "X-Encrypted-At-Rest",
      "X-Watermark-Id",    // exposes watermarkId only — seed never exposed
      "X-Download-Id",
    ],
    credentials: true,
  })
);

// ── 3. Rate limiting ─────────────────────────────────────────
// Global limiter — covers all /api/* routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                  // Raised from 100 — dashboard pages make many read calls
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again in 15 minutes.",
  },
});

// Permissive limiter for read-only dashboard data endpoints (audit, integrity, files)
const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,                  // Heavy dashboard pages poll these frequently
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many dashboard requests. Please wait." },
});

// Stricter limiter for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again in 15 minutes.",
  },
});

// MFA verify limiter – TOTP codes are 6-digit; must be very strict
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Only 5 TOTP verify attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many MFA verification attempts. Please try again in 15 minutes.",
  },
});

// Scan limiter — 5 misuse scans per hour per IP (scans are expensive background jobs)
const scanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Scan rate limit exceeded. Maximum 5 scans per hour.",
  },
});

// ── 4. Body parsers ───────────────────────────────────────────
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser()); // Parses incoming cookies (needed for httpOnly auth cookie)

// ── 5. Request logging (dev only) ─────────────────────────────
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ── 6. Apply rate limiters ────────────────────────────────────
app.use("/api/", apiLimiter);
app.use("/api/audit",      dashboardLimiter); // Dashboard polls frequently — relax
app.use("/api/integrity",  dashboardLimiter); // Same reason
app.use("/api/files",      dashboardLimiter);
app.use("/api/access",     dashboardLimiter);
app.use("/api/auth/login",      authLimiter);
app.use("/api/auth/register",   authLimiter);
app.use("/api/auth/verify-mfa", mfaLimiter);          // Strict – brute-force guard
app.use("/api/provenance",      dashboardLimiter);     // Dashboard reads
app.use("/api/provenance/scans", scanLimiter);         // 5 scans/hour/IP

// ── 7. Routes ─────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/otp",        otpRoutes);
app.use("/api/files",      fileRoutes);
app.use("/api/access",     accessRoutes);
app.use("/api/blockchain", blockchainRoutes); // Ethereum integration
app.use("/api/audit",      auditRoutes);      // Unified blockchain audit trail
app.use("/api/integrity",  integrityRoutes);  // Unit 6 – file integrity & dashboard
app.use("/api/provenance", provenanceRoutes); // Provenance & Misuse Detection Engine

// Health check — live system status for the Vault Status widget
app.get("/api/health", async (req, res) => {
  const checks = {};

  // 1. Azure Blob Storage — check if connection string is set and container exists
  try {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error("No connection string");
    const blobClient = BlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobClient.getContainerClient(process.env.AZURE_CONTAINER_NAME || "genomic-files");
    const exists = await containerClient.exists();
    checks.azure = { status: exists ? "ok" : "degraded", label: "Azure Blob Storage", detail: exists ? "Container reachable" : "Container not found" };
  } catch (e) {
    checks.azure = { status: "error", label: "Azure Blob Storage", detail: e.message };
  }

  // 2. IPFS / Filebase — check if credentials are configured
  try {
    const key    = process.env.FILEBASE_ACCESS_KEY_ID     || process.env.IPFS_API_KEY;
    const secret = process.env.FILEBASE_SECRET_ACCESS_KEY || process.env.IPFS_API_SECRET;
    const bucket = process.env.FILEBASE_BUCKET_NAME       || process.env.IPFS_BUCKET;
    if (!key || !secret || !bucket) throw new Error("Credentials not configured");
    checks.ipfs = { status: "ok", label: "Filebase IPFS", detail: `Bucket: ${bucket}` };
  } catch (e) {
    checks.ipfs = { status: "error", label: "Filebase IPFS", detail: e.message };
  }

  // 3. JWT — verify secret is set and has minimum length
  try {
    const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 16) throw new Error("JWT secret not configured or too short");
    checks.jwt = { status: "ok", label: "JWT Auth", detail: "Secret configured" };
  } catch (e) {
    checks.jwt = { status: "error", label: "JWT Auth", detail: e.message };
  }

  // 4. TOTP / MFA — check if TOTP encryption key is set
  try {
    const key = process.env.TOTP_ENCRYPTION_KEY || process.env.MFA_SECRET;
    if (!key) throw new Error("TOTP encryption key not configured");
    checks.mfa = { status: "ok", label: "TOTP MFA", detail: "Encryption key set" };
  } catch (e) {
    checks.mfa = { status: "error", label: "TOTP MFA", detail: e.message };
  }

  // 5. MongoDB — already connected if we're here (mongoose connection state)
  try {
    const mongoose = require("mongoose");
    const state = mongoose.connection.readyState; // 1 = connected
    checks.mongodb = { status: state === 1 ? "ok" : "error", label: "MongoDB Atlas", detail: state === 1 ? "Connected" : "Disconnected" };
  } catch (e) {
    checks.mongodb = { status: "error", label: "MongoDB Atlas", detail: e.message };
  }

  const allOk   = Object.values(checks).every(c => c.status === "ok");
  const anyError = Object.values(checks).some(c => c.status === "error");
  const overall = allOk ? "secure" : anyError ? "error" : "degraded";

  return res.status(200).json({
    success:   true,
    overall,
    checks,
    timestamp: new Date().toISOString(),
  });
});


// ── 8. 404 handler ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ── 9. Global error handler ───────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Global Error]", err);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ── 10. Start server ──────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀  GenoVault API running on http://localhost:${PORT}`);
  console.log(`📌  Environment: ${process.env.NODE_ENV}`);
});

module.exports = app; // Export for testing
