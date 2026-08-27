/**
 * MisuseScan.js
 * ──────────────────────────────────────────────────────────────────
 * Tracks one misuse-detection scan run.
 * A scan queries external sources (NCBI SRA in V1) for candidate
 * genomic records that may contain a registered watermark.
 *
 * Scan lifecycle:
 *   QUEUED   → scan created, not yet started
 *   RUNNING  → setImmediate callback is executing
 *   COMPLETED→ all sources processed successfully
 *   PARTIAL  → one or more sources failed/unavailable; results incomplete
 *   FAILED   → scan could not complete (fatal error)
 *
 * A PARTIAL scan must NEVER be reported as "no misuse detected".
 * The owner must be informed which sources were checked and which failed.
 */

const mongoose = require("mongoose");

// Sub-schema for per-source scan result
const sourceResultSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: true,
      // e.g. "NCBI_SRA"
    },

    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED", "UNAVAILABLE"],
    },

    candidatesFound: {
      type:    Number,
      default: 0,
    },

    watermarkTested: {
      type:    Number,
      default: 0,
      // Number of candidates against which GENOMIC_LSB_V1 was actually run
      // (i.e. FASTQ with quality scores was retrievable)
    },

    metadataOnlyCount: {
      type:    Number,
      default: 0,
      // Candidates found but FASTQ not retrievable; watermark NOT tested
    },

    error: {
      type:    String,
      default: null,
    },
  },
  { _id: false }
);

const misuseScanSchema = new mongoose.Schema(
  {
    // ── Identifiers ──────────────────────────────────────────────
    scanId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
      // Format: SCN-xxxxxx
    },

    // ── Scope ─────────────────────────────────────────────────────
    ownerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    /**
     * fileId is null when the scan covers ALL files owned by ownerId.
     * When set, the scan is scoped to a specific dataset.
     */
    fileId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "GenomicFile",
      default: null,
      index:   true,
    },

    // ── Status ────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"],
      default: "QUEUED",
      index:   true,
    },

    // ── Per-source results ────────────────────────────────────────
    sources: {
      type:    [sourceResultSchema],
      default: [],
    },

    // ── Aggregate counters ────────────────────────────────────────
    totalCandidates: {
      type:    Number,
      default: 0,
    },

    confirmedMatches: {
      type:    Number,
      default: 0,
    },

    possibleMatches: {
      type:    Number,
      default: 0,
    },

    /**
     * Candidates found via metadata similarity but where FASTQ quality
     * data was not retrievable, so watermark detection was not run.
     * These require manual review.
     */
    metadataOnlyMatches: {
      type:    Number,
      default: 0,
    },

    // ── Timing ────────────────────────────────────────────────────
    startedAt: {
      type:    Date,
      default: null,
    },

    completedAt: {
      type:    Date,
      default: null,
    },

    // ── Error (top-level fatal, distinct from per-source errors) ─
    error: {
      type:    String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for owner dashboard queries
misuseScanSchema.index({ ownerId: 1, createdAt: -1 });
misuseScanSchema.index({ ownerId: 1, status:    1 });

module.exports = mongoose.model("MisuseScan", misuseScanSchema);
