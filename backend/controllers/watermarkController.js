/**
 * watermarkController.js
 * ──────────────────────────────────────────────────────────────────
 * Owner-facing accountability & provenance dashboard endpoints.
 *
 * All routes are owner-only (enforced in provenanceRoutes.js).
 * watermarkSeed is NEVER included in any response.
 *
 * Routes:
 *   GET /api/provenance/dashboard           → getAccountabilityDashboard
 *   GET /api/provenance/researcher/:id      → getResearcherDetail
 *   GET /api/provenance/downloads           → getDownloadHistory
 */

"use strict";

const mongoose          = require("mongoose");
const WatermarkRegistry = require("../models/WatermarkRegistry");
const MisuseEvent       = require("../models/MisuseEvent");
const User              = require("../models/User");
const GenomicFile       = require("../models/GenomicFile");

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/dashboard
   Returns a summary of watermark coverage, download counts, and
   misuse alerts for all files owned by the authenticated user.
─────────────────────────────────────────────────────────────────*/
const getAccountabilityDashboard = async (req, res) => {
  try {
    const ownerId = req.user.userId;

    // Aggregate download counts and watermark stats per file
    const [registryStats, misuseStats, recentDownloads] = await Promise.all([
      WatermarkRegistry.aggregate([
        { $match: { ownerId: new mongoose.Types.ObjectId(ownerId) } },
        {
          $group: {
            _id:   "$fileId",
            totalDownloads: { $sum: 1 },
            activeCount:    { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
            watermarkVersion: { $first: "$watermarkVersion" },
            embeddingMethod:  { $first: "$embeddingMethod" },
            lastDownload:     { $max: "$createdAt" },
          },
        },
      ]),

      MisuseEvent.aggregate([
        { $match: { ownerId: new mongoose.Types.ObjectId(ownerId) } },
        {
          $group: {
            _id:       "$status",
            count:     { $sum: 1 },
          },
        },
      ]),

      WatermarkRegistry.find({ ownerId })
        .select("-watermarkSeed")
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("fileId", "originalName extension")
        .populate("researcherId", "name email"),
    ]);

    // Build misuse summary map
    const misuseSummary = {
      confirmed:    0,
      possible:     0,
      metadataOnly: 0,
      total:        0,
    };
    for (const m of misuseStats) {
      if (m._id === "CONFIRMED_WATERMARK_MATCH") misuseSummary.confirmed    += m.count;
      else if (m._id === "METADATA_MATCH_ONLY")  misuseSummary.metadataOnly += m.count;
      else if (["POSSIBLE_MATCH", "HIGH_CONFIDENCE_MATCH"].includes(m._id)) misuseSummary.possible += m.count;
      misuseSummary.total += m.count;
    }

    // Watermark strength per format
    const formatStrength = {
      ".fastq": { level: "STRONG",   label: "Strong watermark (GENOMIC_LSB_V1)",   icon: "✅" },
      ".bam":   { level: "LIMITED",  label: "Limited metadata watermark",           icon: "⚠️" },
      ".vcf":   { level: "LIMITED",  label: "Limited metadata watermark",           icon: "⚠️" },
    };

    return res.status(200).json({
      success: true,
      dashboard: {
        fileStats:     registryStats,
        misuseSummary,
        recentDownloads,
        formatStrength,
      },
    });
  } catch (err) {
    console.error("[watermarkController.getAccountabilityDashboard]", err);
    return res.status(500).json({ success: false, message: "Failed to load dashboard" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/researcher/:researcherId
   Returns all downloads and misuse events for a specific researcher
   accessing the owner's files.
─────────────────────────────────────────────────────────────────*/
const getResearcherDetail = async (req, res) => {
  try {
    const ownerId      = req.user.userId;
    const { researcherId } = req.params;

    const [researcher, downloads, misuseEvents] = await Promise.all([
      User.findById(researcherId).select("name email institution"),

      WatermarkRegistry.find({ ownerId, researcherId })
        .select("-watermarkSeed")
        .sort({ createdAt: -1 })
        .populate("fileId", "originalName extension"),

      MisuseEvent.find({ ownerId, researcherId })
        .select("-watermarkSeed")
        .sort({ detectedAt: -1 }),
    ]);

    if (!researcher) {
      return res.status(404).json({ success: false, message: "Researcher not found" });
    }

    return res.status(200).json({
      success: true,
      researcher,
      downloads,
      misuseEvents,
    });
  } catch (err) {
    console.error("[watermarkController.getResearcherDetail]", err);
    return res.status(500).json({ success: false, message: "Failed to load researcher detail" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/provenance/downloads
   Paginated list of all watermarked downloads for owner's files.
   Query params: ?page=1&limit=20&fileId=...&researcherId=...
─────────────────────────────────────────────────────────────────*/
const getDownloadHistory = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 20);
    const skip    = (page - 1) * limit;

    const filter = { ownerId };
    if (req.query.fileId)       filter.fileId       = req.query.fileId;
    if (req.query.researcherId) filter.researcherId = req.query.researcherId;

    const [downloads, total] = await Promise.all([
      WatermarkRegistry.find(filter)
        .select("-watermarkSeed")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("fileId",       "originalName extension")
        .populate("researcherId", "name email"),
      WatermarkRegistry.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      downloads,
    });
  } catch (err) {
    console.error("[watermarkController.getDownloadHistory]", err);
    return res.status(500).json({ success: false, message: "Failed to load download history" });
  }
};

module.exports = {
  getAccountabilityDashboard,
  getResearcherDetail,
  getDownloadHistory,
};
