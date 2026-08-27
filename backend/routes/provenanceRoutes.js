/**
 * provenanceRoutes.js
 * ──────────────────────────────────────────────────────────────────
 * Express router for the Genomic Data Provenance & Misuse Detection
 * Engine.
 *
 * All routes require:
 *   • Authentication (verifyToken middleware)
 *   • Owner role (requireOwner middleware)
 *
 * Mounted at: /api/provenance  (in server.js)
 * Rate-limited with dashboardLimiter + scanLimiter (in server.js)
 */

"use strict";

const express                    = require("express");
const router                     = express.Router();
const { protect, requireRole }   = require("../middleware/authMiddleware");
const watermarkCtrl              = require("../controllers/watermarkController");
const misuseCtrl                 = require("../controllers/misuseController");

// All provenance routes require authentication + owner role
router.use(protect, requireRole("owner"));

// ── Watermark & Download Accountability ──────────────────────────
// GET /api/provenance/dashboard
router.get("/dashboard",  watermarkCtrl.getAccountabilityDashboard);

// GET /api/provenance/downloads?page=&limit=&fileId=&researcherId=
router.get("/downloads",  watermarkCtrl.getDownloadHistory);

// GET /api/provenance/researcher/:researcherId
router.get("/researcher/:researcherId", watermarkCtrl.getResearcherDetail);

// ── Misuse Scans ─────────────────────────────────────────────────
// POST /api/provenance/scans          — rate limited separately in server.js
router.post("/scans",      misuseCtrl.startScan);

// GET  /api/provenance/scans
router.get("/scans",       misuseCtrl.listScans);

// GET  /api/provenance/scans/:scanId
router.get("/scans/:scanId", misuseCtrl.getScanStatus);

// ── Misuse Events ────────────────────────────────────────────────
// GET  /api/provenance/misuse-events?status=&page=&limit=
router.get("/misuse-events", misuseCtrl.getMisuseEvents);

// GET  /api/provenance/misuse-events/:eventId
router.get("/misuse-events/:eventId", misuseCtrl.getMisuseEventDetail);

// POST /api/provenance/misuse-events/:eventId/report
router.post("/misuse-events/:eventId/report", misuseCtrl.generateEvidenceReport);

module.exports = router;
