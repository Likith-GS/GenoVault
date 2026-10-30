/**
 * MisuseEvent.js
 * ──────────────────────────────────────────────────────────────────
 * Records a detected (possible or confirmed) instance of a watermarked
 * genomic file appearing in an external source without authorisation.
 *
 * One MisuseEvent is created per (watermarkId × source × sourceRecordId)
 * tuple. A unique compound index prevents duplicate events from repeated
 * scans against the same candidate.
 *
 * Status transitions:
 *   POSSIBLE_MATCH           → similarity score met threshold but commitment
 *                              verification not yet run or not conclusive
 *   HIGH_CONFIDENCE_MATCH    → strong match score; awaiting full verification
 *   CONFIRMED_WATERMARK_MATCH→ SHA-256(recovered watermarkPayload) ==
 *                              watermarkRecord.watermarkCommitment
 *   METADATA_MATCH_ONLY      → candidate found via metadata similarity;
 *                              FASTQ quality data not retrievable; no
 *                              watermark test was run; manual review required
 *   FALSE_POSITIVE           → match score coincidental; commitment mismatch
 *   UNDER_REVIEW             → owner is investigating
 *   RESOLVED                 → incident closed
 */

const mongoose = require("mongoose");

const misuseEventSchema = new mongoose.Schema(
  {
    // ── Identifiers ──────────────────────────────────────────────
    eventId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
      // Format: MSE-xxxxxx
    },

    watermarkId: {
      type:     String,
      required: true,
      index:    true,
    },

    downloadId: {
      type:     String,
      required: true,
    },

    // ── References ───────────────────────────────────────────────
    fileId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "GenomicFile",
      index: true,
    },

    // Snapshot of the file name at the time the event was created.
    // Persists even if the GenomicFile document is later deleted so
    // the UI never has to show "Unknown file".
    originalFileName: {
      type:    String,
      default: null,
    },

    ownerId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "User",
      index: true,
    },

    researcherId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "User",
      index: true,
    },

    scanId: {
      type:  String,
      index: true,
    },

    // ── External source ───────────────────────────────────────────
    source: {
      type:     String,
      enum:     ["NCBI_SRA", "MANUAL"],
      required: true,
    },

    sourceRecordId: {
      type: String,
      // e.g. SRA accession SRR123456
    },

    sourceUrl: {
      type:    String,
      default: null,
    },

    // ── Misuse classification (R3.5) ──────────────────────────────────────
    // Explicitly classifies the nature of the detected misuse.
    // Derived by classifyMisuseEvent() in misuseDetectionService.js.
    // Null for legacy events created before this field was introduced.
    //
    // Categories:
    //   UNAUTHORIZED_REDISTRIBUTION  — data shared publicly without permission
    //   POST_REVOCATION_USE          — used after access was revoked
    //   EXPIRED_ACCESS_USE           — used after access grant expired
    //   POLICY_VIOLATION             — access outside agreed scope
    //   SUSPECTED_LEAK               — watermark found in non-approved channel
    //   UNCLASSIFIED                 — match confirmed but type cannot be determined
    misuseType: {
      type: String,
      enum: [
        "UNAUTHORIZED_REDISTRIBUTION",
        "POST_REVOCATION_USE",
        "EXPIRED_ACCESS_USE",
        "POLICY_VIOLATION",
        "SUSPECTED_LEAK",
        "UNCLASSIFIED",
      ],
      default: null,
    },

    // ── Detection metrics ─────────────────────────────────────────
    detectionMethod: {
      type: String,
      // e.g. "GENOMIC_LSB_V1" or "METADATA_SIMILARITY"
    },

    /**
     * Fraction of bits that matched (0–1).
     * Only meaningful for GENOMIC_LSB_V1 detections where FASTQ was available.
     * null for METADATA_MATCH_ONLY events.
     */
    watermarkMatchScore: {
      type:    Number,
      min:     0,
      max:     1,
      default: null,
    },

    /**
     * Fraction of expected embedding positions present in the candidate.
     * Reduced by read deletion or partial file availability.
     */
    watermarkIntegrity: {
      type:    Number,
      min:     0,
      max:     1,
      default: null,
    },

    overallConfidence: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CONFIRMED"],
    },

    // ── Status ────────────────────────────────────────────────────
    status: {
      type:    String,
      enum: [
        "POSSIBLE_MATCH",
        "HIGH_CONFIDENCE_MATCH",
        "CONFIRMED_WATERMARK_MATCH",
        "METADATA_MATCH_ONLY",
        "FALSE_POSITIVE",
        "UNDER_REVIEW",
        "RESOLVED",
      ],
      required: true,
      index:    true,
    },

    detectedAt: {
      type:    Date,
      default: Date.now,
      index:   true,
    },

    // ── Evidence anchoring ────────────────────────────────────────
    /** SHA-256 of the serialised evidence record — anchored to blockchain. */
    evidenceHash: {
      type:    String,
      default: null,
    },

    blockchainTxHash: {
      type:    String,
      default: null,
    },

    blockchainBlockNum: {
      type:    Number,
      default: null,
    },

    blockchainStatus: {
      type:    String,
      enum:    ["PENDING", "ANCHORED", "FAILED"],
      default: "PENDING",
    },

    // ── Resolution notes ─────────────────────────────────────────
    resolutionNotes: {
      type:    String,
      default: null,
    },

    resolvedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Deduplication index — prevents the same candidate from creating
// multiple events across repeated scans
misuseEventSchema.index(
  { watermarkId: 1, source: 1, sourceRecordId: 1 },
  { unique: true }
);

// Query indexes
misuseEventSchema.index({ ownerId: 1, status:     1 });
misuseEventSchema.index({ ownerId: 1, detectedAt: -1 });
misuseEventSchema.index({ scanId:  1, status:     1 });

module.exports = mongoose.model("MisuseEvent", misuseEventSchema);
