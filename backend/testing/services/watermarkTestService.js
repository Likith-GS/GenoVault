/**
 * backend/testing/services/watermarkTestService.js
 * ──────────────────────────────────────────────────
 * Core logic for the Watermark Testing demonstration feature.
 *
 * Connects to real project data:
 *   - WatermarkRegistry (fetches real watermark records with seed)
 *   - User model (fetches owner + researcher info)
 *   - GenomicFile model (fetches file metadata)
 *   - lsbQualityEmbedder.js (uses the real GENOMIC_LSB_V1 algorithm)
 *
 * SECURITY:
 *   - watermarkSeed is NEVER included in the returned result object.
 *   - WATERMARK_SECRET is used server-side only and never returned.
 *   - Files are processed in-memory (multer memoryStorage) — never persisted.
 *
 * ISOLATION:
 *   - This service is READ-ONLY against the database.
 *   - It never creates/updates WatermarkRegistry, MisuseEvent, blockchain, or access records.
 */

"use strict";

const crypto          = require("crypto");
const WatermarkRegistry = require("../../models/WatermarkRegistry");
const GenomicFile       = require("../../models/GenomicFile");
const User              = require("../../models/User");
const { normalizeFASTQ, detectForRecord } = require("../../services/watermark/lsbQualityEmbedder");

// ─── FASTQ Validation ─────────────────────────────────────────────

/**
 * validateAndParseFASTQ(buffer, label)
 * Attempts to parse the buffer as FASTQ.
 * Returns { ok, reads, readCount, error }.
 */
function validateAndParseFASTQ(buffer, label) {
  try {
    const reads = normalizeFASTQ(buffer);
    return { ok: true, reads, readCount: reads.length, error: null };
  } catch (err) {
    return { ok: false, reads: [], readCount: 0, error: `${label}: ${err.message}` };
  }
}

// ─── Read Comparison ──────────────────────────────────────────────

/**
 * compareReads(origReads, wmReads)
 * Compares read IDs and DNA sequences between original and watermarked.
 * Returns a comparison summary.
 */
function compareReads(origReads, wmReads) {
  const origIds = new Set(origReads.map(r => r.readId));
  const wmIds   = new Set(wmReads.map(r => r.readId));

  const matchingIds   = [...origIds].filter(id => wmIds.has(id));
  const onlyInOrig    = [...origIds].filter(id => !wmIds.has(id));
  const onlyInWm      = [...wmIds].filter(id => !origIds.has(id));

  // Check DNA sequences for matching read IDs
  const origMap = Object.fromEntries(origReads.map(r => [r.readId, r.sequence]));
  const wmMap   = Object.fromEntries(wmReads.map(r => [r.readId, r.sequence]));

  let seqMatch = 0;
  let seqMismatch = 0;
  for (const id of matchingIds) {
    if (origMap[id] === wmMap[id]) seqMatch++;
    else seqMismatch++;
  }

  const dnaUnchanged = seqMismatch === 0 && matchingIds.length > 0;

  return {
    totalOriginalReads:     origReads.length,
    totalWatermarkedReads:  wmReads.length,
    matchingReadIds:        matchingIds.length,
    readsOnlyInOriginal:    onlyInOrig.length,
    readsOnlyInWatermarked: onlyInWm.length,
    dnaSequencesUnchanged:  dnaUnchanged,
    dnaSequencesMatched:    seqMatch,
    dnaSequencesMismatched: seqMismatch,
    readSetMatch:           onlyInOrig.length === 0 && onlyInWm.length === 0,
  };
}

// ─── Main Test Function ───────────────────────────────────────────

/**
 * runWatermarkTest({ ownerId, originalBuffer, watermarkedBuffer })
 *
 * Full watermark verification pipeline:
 *   1. Validate both FASTQ files
 *   2. Compare read IDs and DNA sequences
 *   3. Fetch all active WatermarkRegistry records for this owner
 *   4. Run detectForRecord() against watermarked file for each record
 *   5. Return best-matching result with user/researcher/file info
 *
 * Returns a result object safe to send to the frontend
 * (no seeds, no WATERMARK_SECRET, no internal credentials).
 *
 * @param {string} ownerId
 * @param {Buffer} originalBuffer
 * @param {Buffer} watermarkedBuffer
 */
async function runWatermarkTest({ ownerId, originalBuffer, watermarkedBuffer }) {
  const result = {
    testedAt: new Date().toISOString(),
    ownerInfo: null,

    originalFile: { valid: false, readCount: 0, error: null },
    watermarkedFile: { valid: false, readCount: 0, error: null },

    readComparison: null,
    watermarkRecordsChecked: 0,
    bestMatch: null,          // best detection result across all records

    outcome: "INVALID_INPUT", // WATERMARK_VERIFIED | WATERMARK_NOT_VERIFIED | VERIFICATION_UNAVAILABLE | INVALID_INPUT
    outcomeDetail: "",
  };

  // ── 1. Fetch owner info ────────────────────────────────────────
  const owner = await User.findById(ownerId).select("name email institution").lean();
  result.ownerInfo = owner
    ? { name: owner.name, email: owner.email, institution: owner.institution || null }
    : { name: "Unknown", email: "", institution: null };

  // ── 2. Validate both FASTQ files ───────────────────────────────
  const origResult = validateAndParseFASTQ(originalBuffer,    "Original file");
  const wmResult   = validateAndParseFASTQ(watermarkedBuffer, "Watermarked file");

  result.originalFile = {
    valid:     origResult.ok,
    readCount: origResult.readCount,
    error:     origResult.error,
  };
  result.watermarkedFile = {
    valid:     wmResult.ok,
    readCount: wmResult.readCount,
    error:     wmResult.error,
  };

  if (!origResult.ok || !wmResult.ok) {
    result.outcome       = "INVALID_INPUT";
    result.outcomeDetail = !origResult.ok
      ? origResult.error
      : wmResult.error;
    return result;
  }

  // ── 3. Compare reads ────────────────────────────────────────────
  result.readComparison = compareReads(origResult.reads, wmResult.reads);

  // ── 4. Check WATERMARK_SECRET ────────────────────────────────────
  if (!process.env.WATERMARK_SECRET) {
    result.outcome       = "VERIFICATION_UNAVAILABLE";
    result.outcomeDetail = "WATERMARK_SECRET is not configured on this server.";
    return result;
  }

  // ── 5. Fetch active WatermarkRegistry records for this owner ────
  const watermarkRecords = await WatermarkRegistry
    .find({ ownerId, status: "active" })
    .select(
      "+watermarkSeed watermarkId downloadId fileId researcherId " +
      "watermarkCommitment watermarkVersion watermarkAlgorithm " +
      "embeddingParametersVersion fileFormat createdAt"
    )
    .populate("fileId",       "originalName extension datasetId")
    .populate("researcherId", "name email institution")
    .lean();

  result.watermarkRecordsChecked = watermarkRecords.length;

  if (watermarkRecords.length === 0) {
    result.outcome       = "VERIFICATION_UNAVAILABLE";
    result.outcomeDetail = "No active watermark records found for your account. " +
                           "Watermark verification requires a trusted reference record " +
                           "created when a researcher downloaded your file.";
    return result;
  }

  // ── 6. Run detectForRecord for each record ───────────────────────
  let bestScore  = -1;
  let bestRecord = null;
  let bestDetect = null;

  for (const rec of watermarkRecords) {
    if (!rec.watermarkSeed) {
      console.warn(`[WatermarkTest] Record ${rec.watermarkId} has no seed — skipping`);
      continue;
    }

    // Filter: only test GENOMIC_LSB_V1 records (quality-score LSB embedding).
    // NOTE: the version field is watermarkVersion, NOT watermarkAlgorithm.
    //   watermarkVersion  = "GENOMIC_LSB_V1"   ← correct field to check
    //   watermarkAlgorithm = "FASTQ Quality-Score LSB Watermarking"  ← human label only
    if (rec.watermarkVersion !== "GENOMIC_LSB_V1") {
      console.log(`[WatermarkTest] Record ${rec.watermarkId} is ${rec.watermarkVersion} — not testable via LSB, skipping`);
      continue;
    }

    try {
      const detection = detectForRecord(wmResult.reads, rec);
      console.log(`[WatermarkTest] Record ${rec.watermarkId}: score=${detection.matchScore.toFixed(3)} verified=${detection.verified}`);

      if (detection.matchScore > bestScore) {
        bestScore  = detection.matchScore;
        bestRecord = rec;
        bestDetect = detection;
      }
    } catch (detErr) {
      console.warn(`[WatermarkTest] detectForRecord failed for ${rec.watermarkId}:`, detErr.message);
    }
  }

  // ── 7. Build result ──────────────────────────────────────────────
  if (!bestDetect || !bestRecord) {
    result.outcome       = "VERIFICATION_UNAVAILABLE";
    result.outcomeDetail = "No compatible watermark records could be tested against " +
                           "the uploaded watermarked file (algorithm mismatch or file too small).";
    return result;
  }

  // Safe record info (NO watermarkSeed, NO WATERMARK_SECRET)
  result.bestMatch = {
    watermarkId:     bestRecord.watermarkId,
    downloadId:      bestRecord.downloadId,
    algorithm:       bestRecord.watermarkAlgorithm,
    createdAt:       bestRecord.createdAt,
    matchScore:      Math.round(bestDetect.matchScore  * 10000) / 100,   // percent, 2dp
    integrity:       Math.round(bestDetect.integrity   * 10000) / 100,
    verified:        bestDetect.verified,
    commitmentMatch: bestDetect.verified,

    fileInfo: bestRecord.fileId ? {
      originalName: bestRecord.fileId.originalName,
      extension:    bestRecord.fileId.extension,
      datasetId:    bestRecord.fileId.datasetId || null,
    } : null,

    researcherInfo: bestRecord.researcherId ? {
      name:        bestRecord.researcherId.name,
      email:       bestRecord.researcherId.email,
      institution: bestRecord.researcherId.institution || null,
    } : null,
  };

  if (bestDetect.verified) {
    result.outcome       = "WATERMARK_VERIFIED";
    result.outcomeDetail =
      `SHA-256 commitment verified. Watermark ID ${bestRecord.watermarkId} confirmed in the ` +
      `watermarked file with ${result.bestMatch.matchScore}% bit accuracy.`;
  } else {
    result.outcome       = "WATERMARK_NOT_VERIFIED";
    result.outcomeDetail =
      `Watermark detection ran successfully but the SHA-256 commitment did not match ` +
      `any trusted reference record (best score: ${result.bestMatch.matchScore}%). ` +
      `The file may not contain a genuine GenoVault watermark, or may have been altered.`;
  }

  return result;
}

module.exports = { runWatermarkTest };
