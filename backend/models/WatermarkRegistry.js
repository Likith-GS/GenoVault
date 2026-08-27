/**
 * WatermarkRegistry.js
 * ──────────────────────────────────────────────────────────────────
 * Stores one record per researcher download.
 * Each record tracks the unique watermark embedded into the copy of
 * a genomic file delivered to a specific researcher at a specific time.
 *
 * Three distinct cryptographic roles:
 *   watermarkSeed       – 256-bit HMAC-SHA256; controls WHERE watermark
 *                         bits are embedded (position generation). SENSITIVE.
 *   watermarkPayload    – 64-bit value derived from seed; WHAT is embedded.
 *   watermarkCommitment – SHA-256(watermarkPayload); verifies recovered payload.
 *
 * Security:
 *   watermarkSeed is marked select:false and must NEVER appear in API
 *   responses, frontend output, audit logs, or evidence reports.
 *   Internal detection operations must explicitly use .select('+watermarkSeed').
 */

const mongoose = require("mongoose");

const watermarkRegistrySchema = new mongoose.Schema(
  {
    // ── Identifiers ──────────────────────────────────────────────
    watermarkId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
      // Format: WM-XXXXXXXX (8 random uppercase hex chars)
    },

    downloadId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
      // Format: DL-<timestamp>-<4 random chars>
    },

    // ── References ───────────────────────────────────────────────
    fileId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "GenomicFile",
      required: true,
      index:    true,
    },

    ownerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    researcherId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    accessRequestId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "AccessRequest",
      required: true,
    },

    // ── Cryptographic watermark fields ───────────────────────────

    /**
     * watermarkSeed
     * 256-bit HMAC-SHA256 output (stored as 64-char hex string).
     * Used to deterministically derive embedding positions.
     * SENSITIVE — select:false; never expose externally.
     */
    watermarkSeed: {
      type:     String,
      required: true,
      select:   false,
    },

    /**
     * watermarkCommitment
     * SHA-256 of the 64-bit embedded watermarkPayload.
     * Used during detection to cryptographically verify recovered payload.
     * Safe to store and query publicly within the system.
     * NOTE: This is SHA-256(watermarkPayload), NOT SHA-256(watermarkSeed).
     */
    watermarkCommitment: {
      type:     String,
      required: true,
    },

    // ── Algorithm / version metadata ─────────────────────────────
    watermarkVersion: {
      type:     String,
      enum:     ["GENOMIC_LSB_V1", "METADATA_V1"],
      required: true,
    },

    watermarkAlgorithm: {
      type:     String,
      required: true,
      // e.g. "FASTQ Quality-Score LSB Watermarking"
    },

    /**
     * watermarkSecretVersion
     * Identifies which WATERMARK_SECRET key was active when this watermark
     * was generated. V1 uses "watermark-key-v1".
     * Stored for future key-rotation compatibility (future enhancement).
     */
    watermarkSecretVersion: {
      type:     String,
      required: true,
      default:  "watermark-key-v1",
    },

    /**
     * embeddingParametersVersion
     * Full versioned embedding configuration at the time of watermarking.
     * Example: { version, payloadBits, repetitionFactor, encodedBits,
     *             blockCount, redundancyFactor, minQualityThreshold,
     *             positionSelectionAlgorithm, secretVersion }
     */
    embeddingParametersVersion: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },

    // ── Embedding method ─────────────────────────────────────────
    embeddingMethod: {
      type:     String,
      enum:     ["LSB_QUALITY", "COMMENT_FIELD", "SAM_TAG"],
      required: true,
    },

    // ── File hashes ───────────────────────────────────────────────
    /** SHA-256 of the decrypted original (pre-watermark) file. */
    originalFileHash: {
      type:     String,
      required: true,
    },

    /** SHA-256 of the watermarked file delivered to the researcher. */
    watermarkedFileHash: {
      type:     String,
      required: true,
    },

    // ── File metadata ─────────────────────────────────────────────
    fileFormat: {
      type:     String,
      enum:     [".fastq", ".bam", ".vcf"],
      required: true,
    },

    fileSize: {
      type:     Number,
      required: true,
    },

    // ── Lifecycle status ──────────────────────────────────────────
    status: {
      type:    String,
      enum:    ["active", "revoked", "suspected_leak", "confirmed_leak"],
      default: "active",
      index:   true,
    },

    revokedAt: {
      type:    Date,
      default: null,
    },

    // ── Blockchain anchoring ──────────────────────────────────────
    blockchainTxHash:   { type: String, default: null },
    blockchainBlockNum: { type: Number, default: null },
    blockchainStatus: {
      type:    String,
      enum:    ["PENDING", "ANCHORED", "FAILED"],
      default: "PENDING",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes for common detection and reporting queries
watermarkRegistrySchema.index({ ownerId:      1, status:    1 });
watermarkRegistrySchema.index({ fileId:       1, ownerId:   1 });
watermarkRegistrySchema.index({ researcherId: 1, createdAt: -1 });
watermarkRegistrySchema.index({ watermarkId:  1, ownerId:   1 });

module.exports = mongoose.model("WatermarkRegistry", watermarkRegistrySchema);
