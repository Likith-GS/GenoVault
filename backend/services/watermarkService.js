/**
 * watermarkService.js
 * ──────────────────────────────────────────────────────────────────
 * Central watermark orchestration service for the Genomic Data
 * Provenance & Misuse Detection Engine.
 *
 * Cryptographic data-flow (three distinct roles):
 *
 *   HMAC-SHA256(inputs, WATERMARK_SECRET)
 *           ↓
 *   256-bit watermarkSeed  ← WHERE positions are derived
 *           ↓
 *   deriveWatermarkPayload(seed)
 *           ↓
 *   64-bit watermarkPayload  ← WHAT is embedded & recovered
 *           ↓
 *   computeWatermarkCommitment(payload) = SHA-256(payload)
 *           ↓
 *   watermarkCommitment  ← verifies recovered payload
 *
 * Security rules:
 *   • watermarkSeed must never appear in API responses, frontend,
 *     audit logs, or evidence reports.
 *   • Internal detection operations must use .select('+watermarkSeed').
 *   • If WATERMARK_SECRET is missing, all operations throw immediately.
 */

"use strict";

const crypto      = require("crypto");
const lsbEmbedder = require("./watermark/lsbQualityEmbedder");
const metaEmbedder = require("./watermark/metadataEmbedder");

// V1 embedding parameters (stored in WatermarkRegistry)
const V1_EMBEDDING_PARAMS = {
  version:                  "LSB_V1",
  payloadBits:              64,
  repetitionFactor:         7,
  encodedBits:              448,
  blockCount:               4,
  redundancyFactor:         2,
  minQualityThreshold:      10,   // Phred Q; positions below this skipped
  positionSelectionAlgorithm: "HMAC-SHA256-counter",
  secretVersion:            process.env.WATERMARK_SECRET_VERSION || "watermark-key-v1",
};

// ─────────────────────────────────────────────────────────────────
// ID generators
// ─────────────────────────────────────────────────────────────────

/**
 * generateWatermarkId()
 * Returns a unique watermark identifier: WM-XXXXXXXX
 * (8 random uppercase hex characters)
 */
function generateWatermarkId() {
  return "WM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * generateDownloadId()
 * Returns a unique download identifier: DL-<timestamp>-<4 random hex>
 */
function generateDownloadId() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `DL-${ts}-${rand}`;
}

// ─────────────────────────────────────────────────────────────────
// Cryptographic pipeline
// ─────────────────────────────────────────────────────────────────

/**
 * generateWatermarkSeed(ownerId, researcherId, fileId, accessRequestId, downloadId, nonce)
 *
 * Produces the 256-bit watermarkSeed via HMAC-SHA256.
 * The nonce must be a cryptographically random Buffer (≥16 bytes).
 * Returns a 64-character lowercase hex string.
 *
 * @returns {string}  64-char hex
 */
function generateWatermarkSeed(ownerId, researcherId, fileId, accessRequestId, downloadId, nonce) {
  const secret = process.env.WATERMARK_SECRET;
  if (!secret) {
    throw new Error("WATERMARK_SECRET not configured — download blocked");
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(String(ownerId));
  hmac.update("|");
  hmac.update(String(researcherId));
  hmac.update("|");
  hmac.update(String(fileId));
  hmac.update("|");
  hmac.update(String(accessRequestId));
  hmac.update("|");
  hmac.update(String(downloadId));
  hmac.update("|");
  hmac.update(nonce);   // Buffer or hex string

  return hmac.digest("hex");  // 64-char hex = 256-bit
}

/**
 * deriveWatermarkPayload(watermarkSeed)
 *
 * Derives the 64-bit watermarkPayload from the 256-bit watermarkSeed.
 * V1 implementation: take the first 8 bytes of the seed.
 *
 * IMPORTANT: This is what is actually embedded into the FASTQ quality scores.
 * The seed controls WHERE; the payload is WHAT.
 *
 * @param {string} watermarkSeed  – 64-char hex string
 * @returns {Buffer}  8 bytes (64-bit)
 */
function deriveWatermarkPayload(watermarkSeed) {
  return Buffer.from(watermarkSeed, "hex").slice(0, 8);
}

/**
 * computeWatermarkCommitment(watermarkPayload)
 *
 * Returns SHA-256(watermarkPayload) as a hex string.
 * Stored in WatermarkRegistry. Used during detection to verify
 * that the recovered payload is authentic.
 *
 * NOTE: This takes the 64-bit payload as input, NOT the 256-bit seed.
 *
 * @param {Buffer} watermarkPayload  – 8-byte Buffer
 * @returns {string}  64-char hex
 */
function computeWatermarkCommitment(watermarkPayload) {
  return crypto
    .createHash("sha256")
    .update(watermarkPayload)
    .digest("hex");
}

/**
 * computeWatermarkedFileHash(watermarkedBuffer)
 * Returns SHA-256(watermarkedBuffer) as a hex string.
 * Anchored to blockchain to prove the watermarked copy existed at download time.
 *
 * @param {Buffer} watermarkedBuffer
 * @returns {string}
 */
function computeWatermarkedFileHash(watermarkedBuffer) {
  return crypto.createHash("sha256").update(watermarkedBuffer).digest("hex");
}

// ─────────────────────────────────────────────────────────────────
// Embedding orchestration
// ─────────────────────────────────────────────────────────────────

/**
 * embedWatermark(plainBuffer, fileExt, watermarkRecord)
 *
 * Dispatches to lsbQualityEmbedder (FASTQ) or metadataEmbedder (BAM/VCF).
 * Returns { watermarkedBuffer }.
 *
 * Fails with an error if the file format is unsupported or embedding fails.
 * The caller MUST NOT release the original file if this throws.
 *
 * @param {Buffer} plainBuffer
 * @param {string} fileExt        – ".fastq" | ".bam" | ".vcf"
 * @param {Object} watermarkRecord
 * @returns {{ watermarkedBuffer: Buffer }}
 */
function embedWatermark(plainBuffer, fileExt, watermarkRecord) {
  switch (fileExt.toLowerCase()) {
    case ".fastq":
    case ".fastq.gz":   // gzip-compressed FASTQ — lsbEmbedder auto-decompresses
      return lsbEmbedder.embed(plainBuffer, watermarkRecord);

    case ".bam":
    case ".vcf":
      // WEAK_WATERMARK — metadata only; clearly communicated in UI
      return metaEmbedder.embed(plainBuffer, fileExt, watermarkRecord);

    default:
      throw new Error(`Unsupported file format for watermarking: "${fileExt}"`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Detection orchestration
// ─────────────────────────────────────────────────────────────────

/**
 * detectWatermarkInCandidate(normalizedCandidateOrBuffer, watermarkRecord)
 *
 * Tests a candidate file against ONE specific registered watermark record.
 *
 * For FASTQ (GENOMIC_LSB_V1):
 *   1. Uses watermarkRecord.watermarkSeed to reconstruct embedding positions.
 *   2. Extracts quality-score LSBs.
 *   3. Majority-vote error correction → recovers 64-bit watermarkPayload.
 *   4. Computes SHA-256(recovered watermarkPayload).
 *   5. Compares with watermarkRecord.watermarkCommitment.
 *   6. Returns verified=true ONLY on exact commitment match.
 *
 * For BAM/VCF (METADATA_V1):
 *   Presence-only check of watermarkId tag.
 *
 * CRITICAL: watermarkRecord.watermarkSeed must be explicitly selected
 * from MongoDB before calling this function (.select('+watermarkSeed')).
 *
 * @param {Buffer|Array} candidateInput
 *   For FASTQ: a pre-normalized reads array (from lsbEmbedder.normalizeFASTQ)
 *              OR a Buffer (will be normalized internally)
 *   For BAM/VCF: a Buffer
 * @param {Object} watermarkRecord  – must include watermarkSeed
 * @returns {{ matchScore: number, integrity: number, verified: boolean, confidence: string }}
 */
function detectWatermarkInCandidate(candidateInput, watermarkRecord) {
  const version = watermarkRecord.watermarkVersion;

  if (version === "GENOMIC_LSB_V1") {
    let normalizedReads;
    if (Array.isArray(candidateInput)) {
      normalizedReads = candidateInput;
    } else if (Buffer.isBuffer(candidateInput)) {
      normalizedReads = lsbEmbedder.normalizeFASTQ(candidateInput);
    } else {
      throw new TypeError("candidateInput must be a Buffer or normalized reads array");
    }

    const result = lsbEmbedder.detectForRecord(normalizedReads, watermarkRecord);

    // Determine confidence level
    let confidence;
    if (result.verified) {
      confidence = "CONFIRMED";
    } else if (result.matchScore >= 0.95) {
      confidence = "HIGH";
    } else if (result.matchScore >= 0.80) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }

    return { ...result, confidence };
  }

  if (version === "METADATA_V1") {
    if (!Buffer.isBuffer(candidateInput)) {
      throw new TypeError("candidateInput must be a Buffer for METADATA_V1");
    }
    const fileExt = watermarkRecord.fileFormat;
    const result  = metaEmbedder.detectForRecord(candidateInput, fileExt, watermarkRecord);
    return {
      ...result,
      confidence: result.verified ? "CONFIRMED" : "LOW",
    };
  }

  throw new Error(`Unknown watermark version: "${version}"`);
}

// ─────────────────────────────────────────────────────────────────
// Watermark record builder
// ─────────────────────────────────────────────────────────────────

/**
 * buildWatermarkRecord(opts)
 *
 * Builds the complete object needed to create a WatermarkRegistry document.
 * Called from accessController.js after generating the seed.
 *
 * @param {Object} opts
 * @param {string} opts.watermarkId
 * @param {string} opts.downloadId
 * @param {string} opts.fileId
 * @param {string} opts.ownerId
 * @param {string} opts.researcherId
 * @param {string} opts.accessRequestId
 * @param {string} opts.watermarkSeed      – 64-char hex
 * @param {string} opts.fileExt            – ".fastq" | ".bam" | ".vcf"
 * @param {number} opts.fileSize
 * @param {string} opts.originalFileHash
 * @returns {Object}  ready for WatermarkRegistry.create()
 */
function buildWatermarkRecord(opts) {
  const { watermarkSeed, fileExt } = opts;

  const watermarkPayload    = deriveWatermarkPayload(watermarkSeed);
  const watermarkCommitment = computeWatermarkCommitment(watermarkPayload);

  const isFASTQ        = [".fastq", ".fastq.gz"].includes(fileExt.toLowerCase());
  const embeddingMethod = isFASTQ ? "LSB_QUALITY"
    : fileExt.toLowerCase() === ".bam" ? "SAM_TAG"
    : "COMMENT_FIELD";

  return {
    watermarkId:              opts.watermarkId,
    downloadId:               opts.downloadId,
    fileId:                   opts.fileId,
    ownerId:                  opts.ownerId,
    researcherId:             opts.researcherId,
    accessRequestId:          opts.accessRequestId,
    watermarkSeed,
    watermarkCommitment,
    watermarkVersion:         isFASTQ ? "GENOMIC_LSB_V1" : "METADATA_V1",
    watermarkAlgorithm:       isFASTQ
      ? "FASTQ Quality-Score LSB Watermarking"
      : "Metadata Field Watermarking",
    watermarkSecretVersion:   process.env.WATERMARK_SECRET_VERSION || "watermark-key-v1",
    embeddingParametersVersion: isFASTQ ? { ...V1_EMBEDDING_PARAMS } : { version: "METADATA_V1" },
    embeddingMethod,
    fileFormat:               fileExt.toLowerCase(),
    fileSize:                 opts.fileSize,
    originalFileHash:         opts.originalFileHash,
    watermarkedFileHash:      "",    // filled in after embedding
    blockchainStatus:         "PENDING",
  };
}

module.exports = {
  generateWatermarkId,
  generateDownloadId,
  generateWatermarkSeed,
  deriveWatermarkPayload,
  computeWatermarkCommitment,
  computeWatermarkedFileHash,
  embedWatermark,
  detectWatermarkInCandidate,
  buildWatermarkRecord,
};
