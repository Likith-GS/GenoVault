/**
 * misuseController.js
 * ──────────────────────────────────────────────────────────────────
 * Owner-facing misuse scan and incident management endpoints.
 *
 * All routes are owner-only (enforced in provenanceRoutes.js).
 * watermarkSeed is NEVER included in any response.
 *
 * Routes:
 *   POST /api/provenance/scans                              → startScan
 *   GET  /api/provenance/scans                              → listScans
 *   GET  /api/provenance/scans/:scanId                      → getScanStatus
 *   GET  /api/provenance/misuse-events                      → getMisuseEvents
 *   GET  /api/provenance/misuse-events/:eventId             → getMisuseEventDetail
 *   POST /api/provenance/misuse-events/:eventId/report      → generateEvidenceReport
 */

"use strict";

const crypto              = require("crypto");
const MisuseScan          = require("../models/MisuseScan");
const MisuseEvent         = require("../models/MisuseEvent");
const WatermarkRegistry   = require("../models/WatermarkRegistry");
const { logEvent }        = require("../services/auditLogService");
const detectionService    = require("../services/misuseDetectionService");
const {
  registerFile: registerFileOnChain,
  isBlockchainConfigured,
} = require("../services/blockchainService");

/* ─────────────────────────────────────────────────────────────────
   POST /api/provenance/scans
   Starts a new misuse detection scan.
   Body: { fileId? }  — omit to scan all owner files
─────────────────────────────────────────────────────────────────*/
const startScan = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const fileId  = req.body.fileId || null;

    const { scanId, status } = await detectionService.startScan(ownerId, fileId);

    logEvent("MISUSE_SCAN_STARTED", ownerId, "owner", null, {
      status:  "success",
      details: { scanId, fileId },
    }).catch(console.warn);

    return res.status(202).json({
      success: true,
      message: "Scan started. Use the scanId to check progress.",
      scanId,
      status,
    });
  } catch (err) {
    console.error("[misuseController.startScan]", err);
    return res.status(500).json({ success: false, message: "Failed to start scan" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/scans
   Paginated list of all scans for the owner.
─────────────────────────────────────────────────────────────────*/
const listScans = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 20);
    const skip    = (page - 1) * limit;

    const [scans, total] = await Promise.all([
      MisuseScan.find({ ownerId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      MisuseScan.countDocuments({ ownerId }),
    ]);

    return res.status(200).json({
      success: true,
      page, limit, total,
      pages: Math.ceil(total / limit),
      scans,
    });
  } catch (err) {
    console.error("[misuseController.listScans]", err);
    return res.status(500).json({ success: false, message: "Failed to list scans" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/scans/:scanId
   Get status and result summary for a specific scan.
─────────────────────────────────────────────────────────────────*/
const getScanStatus = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const { scanId } = req.params;

    const scan = await MisuseScan.findOne({ scanId, ownerId });
    if (!scan) {
      return res.status(404).json({ success: false, message: "Scan not found" });
    }

    return res.status(200).json({ success: true, scan });
  } catch (err) {
    console.error("[misuseController.getScanStatus]", err);
    return res.status(500).json({ success: false, message: "Failed to get scan status" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/misuse-events
   Paginated list of misuse events for the owner.
   Query: ?status=CONFIRMED_WATERMARK_MATCH&page=1&limit=20
─────────────────────────────────────────────────────────────────*/
const getMisuseEvents = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 20);
    const skip    = (page - 1) * limit;

    const filter = { ownerId };
    if (req.query.status) filter.status = req.query.status;

    const [events, total] = await Promise.all([
      MisuseEvent.find(filter)
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("fileId",       "originalName extension")
        .populate("researcherId", "name email"),
      MisuseEvent.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      page, limit, total,
      pages: Math.ceil(total / limit),
      events,
    });
  } catch (err) {
    console.error("[misuseController.getMisuseEvents]", err);
    return res.status(500).json({ success: false, message: "Failed to list misuse events" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/misuse-events/:eventId
   Full detail for a single misuse event, including linked download
   and watermark info (excluding watermarkSeed).
─────────────────────────────────────────────────────────────────*/
const getMisuseEventDetail = async (req, res) => {
  try {
    const ownerId  = req.user.userId;
    const { eventId } = req.params;

    const event = await MisuseEvent.findOne({ eventId, ownerId })
      .populate("fileId",       "originalName extension mimeType")
      .populate("researcherId", "name email institution");

    if (!event) {
      return res.status(404).json({ success: false, message: "Misuse event not found" });
    }

    // Fetch linked watermark record — exclude watermarkSeed
    const watermarkRecord = await WatermarkRegistry.findOne({
      watermarkId: event.watermarkId,
      ownerId,
    }).select("-watermarkSeed");

    return res.status(200).json({
      success: true,
      event,
      watermarkRecord,
    });
  } catch (err) {
    console.error("[misuseController.getMisuseEventDetail]", err);
    return res.status(500).json({ success: false, message: "Failed to load event detail" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   POST /api/provenance/misuse-events/:eventId/report
   Generates a structured evidence report for a misuse event.
   The report does NOT include watermarkSeed.
   Report SHA-256 is anchored to blockchain.
─────────────────────────────────────────────────────────────────*/
const generateEvidenceReport = async (req, res) => {
  try {
    const ownerId  = req.user.userId;
    const { eventId } = req.params;

    const event = await MisuseEvent.findOne({ eventId, ownerId })
      .populate("fileId",       "originalName extension datasetId")
      .populate("researcherId", "name email institution orcid");

    if (!event) {
      return res.status(404).json({ success: false, message: "Misuse event not found" });
    }

    // Fetch linked watermark record — no watermarkSeed in report
    const wmRecord = await WatermarkRegistry.findOne({
      watermarkId: event.watermarkId,
      ownerId,
    }).select("-watermarkSeed");

    // Build reproducible report object
    // watermarkSeed is intentionally excluded
    const report = {
      reportVersion:    "1.0",
      generatedAt:      new Date().toISOString(),
      eventId:          event.eventId,
      watermarkId:      event.watermarkId,
      downloadId:       event.downloadId,
      file: {
        fileId:       String(event.fileId?._id || ""),
        originalName: event.fileId?.originalName,
        extension:    event.fileId?.extension,
        datasetId:    event.fileId?.datasetId,
      },
      researcher: {
        name:        event.researcherId?.name,
        email:       event.researcherId?.email,
        institution: event.researcherId?.institution,
        orcid:       event.researcherId?.orcid,
      },
      detection: {
        status:              event.status,
        detectionMethod:     event.detectionMethod,
        watermarkMatchScore: event.watermarkMatchScore,
        watermarkIntegrity:  event.watermarkIntegrity,
        overallConfidence:   event.overallConfidence,
        detectedAt:          event.detectedAt,
        source:              event.source,
        sourceRecordId:      event.sourceRecordId,
        sourceUrl:           event.sourceUrl,
      },
      watermark: {
        watermarkVersion:    wmRecord?.watermarkVersion,
        watermarkAlgorithm:  wmRecord?.watermarkAlgorithm,
        watermarkCommitment: wmRecord?.watermarkCommitment,   // commitment only; seed excluded
        watermarkSecretVersion: wmRecord?.watermarkSecretVersion,
        embeddingMethod:     wmRecord?.embeddingMethod,
        originalFileHash:    wmRecord?.originalFileHash,
        watermarkedFileHash: wmRecord?.watermarkedFileHash,
        downloadedAt:        wmRecord?.createdAt,
      },
      blockchain: {
        eventBlockchainTxHash:      event.blockchainTxHash,
        eventBlockchainStatus:      event.blockchainStatus,
        wmBlockchainTxHash:         wmRecord?.blockchainTxHash,
        wmBlockchainStatus:         wmRecord?.blockchainStatus,
      },
      // watermarkSeed is intentionally NOT included in this report
    };

    // Compute reproducible report hash
    const reportHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(report))
      .digest("hex");

    report.reportHash = reportHash;

    logEvent("MISUSE_REPORT_GENERATED", ownerId, "owner", null, {
      status: "success",
      details: { eventId, reportHash },
    }).catch(console.warn);

    // Anchor report hash to blockchain (fire-and-forget)
    if (isBlockchainConfigured()) {
      setImmediate(() => {
        registerFileOnChain(reportHash, "")
          .then((bcResult) => {
            console.log(`[misuseController] Report anchored: ${bcResult.success ? "✅" : "❌"} ${eventId}`);
          })
          .catch((e) => console.warn("[misuseController] Report anchor error:", e.message));
      });
    }

    return res.status(200).json({ success: true, report });
  } catch (err) {
    console.error("[misuseController.generateEvidenceReport]", err);
    return res.status(500).json({ success: false, message: "Failed to generate report" });
  }
};

module.exports = {
  startScan,
  listScans,
  getScanStatus,
  getMisuseEvents,
  getMisuseEventDetail,
  generateEvidenceReport,
};
