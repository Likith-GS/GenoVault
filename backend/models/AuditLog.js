/**
 * AuditLog.js
 * ──────────────────────────────────────────────────────────────────
 * Persistent audit log for Unit 6 – Research Integrity & Data Verification.
 *
 * Records every security-relevant event that is not already tracked by the
 * blockchain (i.e. download events and integrity check outcomes).
 * Blockchain-recorded events (upload, access request/approve/reject/revoke)
 * remain in the on-chain audit trail; those are surfaced via auditController.js.
 *
 * This collection adds:
 *   DOWNLOAD_INITIATED   – researcher triggered a download
 *   DOWNLOAD_COMPLETED   – file delivered successfully
 *   DOWNLOAD_FAILED      – pipeline error after decryption started
 *   INTEGRITY_VERIFIED   – SHA-256(encrypted blob) matched blockchainFileHash
 *   INTEGRITY_FAILED     – SHA-256 mismatch detected; download was blocked
 *
 * Design:
 *   • Non-blocking writes (fire-and-forget via auditLogService)
 *   • Owner-visible via /api/audit (merged with on-chain events)
 *   • Immutable records (no update/delete operations defined)
 */

const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    // ── File reference ─────────────────────────────────────────────
    fileId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "GenomicFile",
      default: null,
      index:   true,
    },

    // Dataset catalog ID (GV-XXXX) – denormalised for fast human-readable queries
    datasetId: {
      type:    String,
      default: null,
    },

    // ── Actor ─────────────────────────────────────────────────────
    userId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   "User",
      index: true,
    },

    userRole: {
      type: String,
      enum: ["owner", "researcher", "system"],
    },

    // ── Operation ─────────────────────────────────────────────────
    operation: {
      type: String,
      enum: [
        "UPLOAD",
        "ACCESS_REQUEST",
        "ACCESS_APPROVED",
        "ACCESS_REJECTED",
        "ACCESS_REVOKED",
        "DOWNLOAD_INITIATED",
        "DOWNLOAD_COMPLETED",
        "DOWNLOAD_FAILED",
        "INTEGRITY_VERIFIED",
        "INTEGRITY_FAILED",
        // ── Watermark & Provenance (Genomic Data Provenance Engine) ─
        "WATERMARK_GENERATED",
        "WATERMARK_EMBEDDED",
        "WATERMARK_VERIFIED",
        "WATERMARKED_FILE_DOWNLOADED",
        "WATERMARK_EMBEDDING_FAILED",
        "WATERMARK_FAILED_SIZE_LIMIT",
        "MISUSE_SCAN_STARTED",
        "MISUSE_SCAN_COMPLETED",
        "CANDIDATE_MATCH_FOUND",
        "WATERMARK_EXTRACTED",
        "MISUSE_EVENT_CREATED",
        "MISUSE_REPORT_GENERATED",
      ],
      required: true,
      index:    true,
    },

    // ── Outcome ───────────────────────────────────────────────────
    status: {
      type:     String,
      enum:     ["success", "failure"],
      required: true,
    },

    // ── Blockchain fields (populated when operation has a tx) ─────
    txHash:      { type: String, default: null },
    blockNumber: { type: Number, default: null },

    // ── Network info ─────────────────────────────────────────────
    ipAddress: { type: String, default: null },

    // ── Details – free-form context object ───────────────────────
    // Required fields for failures:
    //   details.reason      – human-readable failure summary
    //   details.storedHash  – file.blockchainFileHash  (on INTEGRITY_FAILED)
    //   details.liveHash    – computed SHA-256          (on INTEGRITY_FAILED)
    details: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ── Timestamp ─────────────────────────────────────────────────
    timestamp: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes for common query patterns
auditLogSchema.index({ fileId:    1, timestamp: -1 });
auditLogSchema.index({ userId:    1, timestamp: -1 });
auditLogSchema.index({ operation: 1, timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
