/**
 * backupComparisonController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 (R2.4) — Azure primary ↔ Filebase/IPFS backup byte comparison.
 *
 * Endpoint:
 *   GET /api/integrity/:fileId/backup-comparison
 *
 * What it does:
 *   1. Fetches the file metadata from MongoDB (owner-gated)
 *   2. Computes SHA-256 of the Azure primary blob (streaming, no full buffer)
 *   3. Fetches the Filebase/IPFS backup via the S3 API (same blob key)
 *      and computes SHA-256 of that content
 *   4. Compares the two SHA-256 hashes
 *   5. Returns a structured result:
 *      - MATCH:    both copies are byte-identical
 *      - MISMATCH: byte divergence detected between primary and backup
 *      - SKIP:     IPFS backup not yet completed or CID missing
 *      - ERROR:    one or both storage systems unreachable
 *
 * Design notes:
 *   - SHA-256 is used for byte comparison (not for provenance — that is blockchain)
 *   - Comparison hashes are NOT the blockchain-anchored hash; they are freshly
 *     computed from each storage system at call time
 *   - Streaming is used on the Azure side; the Filebase response body is piped
 *     through a hash accumulator
 *   - This is always on-demand (never scheduled) — expensive for large files
 *   - The endpoint is owner-only (file.owner check)
 */

"use strict";

const crypto      = require("crypto");
const https       = require("https");
const GenomicFile = require("../models/GenomicFile");
const { getReadableBlobStream } = require("../services/azureService");

// Filebase S3-compatible credentials (same as ipfsService.js)
const FILEBASE_BUCKET     = process.env.FILEBASE_BUCKET_NAME;
const FILEBASE_ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY_ID
                         || process.env.FILEBASE_ACCESS_KEY;
const FILEBASE_SECRET_KEY = process.env.FILEBASE_SECRET_ACCESS_KEY
                         || process.env.FILEBASE_SECRET;
const FILEBASE_ENDPOINT   = "https://s3.filebase.com";

/**
 * computeHashFromStream
 * ─────────────────────
 * Pipes a Node Readable stream through SHA-256 and returns the hex digest.
 * Zero-buffer — O(1) memory for any file size.
 *
 * @param {Readable} stream
 * @returns {Promise<string>} SHA-256 hex digest
 */
const computeHashFromStream = (stream) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    stream.on("data",  (chunk) => hash.update(chunk));
    stream.on("end",   ()      => resolve(hash.digest("hex")));
    stream.on("error", (err)   => reject(err));
  });

/**
 * fetchFilebaseStream
 * ───────────────────
 * Fetches the Filebase object (same key as azureBlobName) using a plain
 * HTTPS GET with AWS Signature V4 via the @aws-sdk/client-s3 GetObject.
 * Returns a Readable stream of the object body.
 *
 * We reuse the same S3Client pattern as ipfsService.js to keep credentials
 * consistent — but only pull in the one command we need here.
 *
 * @param {string} blobName  The object key (same as Azure blob name)
 * @returns {Promise<Readable>}
 * @throws {Error} if Filebase is unreachable or object does not exist
 */
const fetchFilebaseStream = async (blobName) => {
  // Import lazily to avoid crashing the whole module if @aws-sdk is missing
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");

  if (!FILEBASE_ACCESS_KEY || !FILEBASE_SECRET_KEY || !FILEBASE_BUCKET) {
    throw new Error(
      "Filebase credentials not configured (FILEBASE_BUCKET_NAME, " +
      "FILEBASE_ACCESS_KEY_ID, FILEBASE_SECRET_ACCESS_KEY)"
    );
  }

  const client = new S3Client({
    endpoint:        FILEBASE_ENDPOINT,
    region:          "us-east-1",       // Filebase requires a region string
    credentials: {
      accessKeyId:     FILEBASE_ACCESS_KEY,
      secretAccessKey: FILEBASE_SECRET_KEY,
    },
    forcePathStyle: true,
  });

  const response = await client.send(
    new GetObjectCommand({ Bucket: FILEBASE_BUCKET, Key: blobName })
  );

  // response.Body is a ReadableStream (web) — we need a Node Readable
  // @aws-sdk/client-s3 v3 returns a NodeJS.ReadableStream in Node env
  return response.Body;
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/integrity/:fileId/backup-comparison
   Protected – owner role only
─────────────────────────────────────────────────────────────────────────────*/
const getBackupComparison = async (req, res) => {
  const startedAt = new Date().toISOString();

  try {
    const { fileId } = req.params;
    const ownerId    = req.user.userId;

    const file = await GenomicFile.findById(fileId);
    if (!file || file.uploadStatus !== "confirmed") {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    if (String(file.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // ── SKIP: IPFS backup not yet ready ────────────────────────────────────
    if (file.ipfsStatus !== "done" || !file.ipfsCid) {
      return res.status(200).json({
        success:    true,
        fileId:     String(file._id),
        fileName:   file.originalName,
        result:     "SKIP",
        reason:     "IPFS backup not yet completed — comparison skipped",
        ipfsStatus: file.ipfsStatus,
        ipfsCid:    file.ipfsCid ?? null,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    }

    // ── Step 1: SHA-256 of Azure primary blob (streaming) ──────────────────
    let azureHash  = null;
    let azureError = null;

    try {
      const azureStream = await getReadableBlobStream(file.azureBlobName);
      azureHash = await computeHashFromStream(azureStream);
    } catch (err) {
      azureError = err.message;
    }

    // ── Step 2: SHA-256 of Filebase/IPFS backup (streaming) ───────────────
    let filebaseHash  = null;
    let filebaseError = null;

    try {
      const filebaseStream = await fetchFilebaseStream(file.azureBlobName);
      filebaseHash = await computeHashFromStream(filebaseStream);
    } catch (err) {
      filebaseError = err.message;
    }

    // ── Step 3: Determine result ───────────────────────────────────────────
    const completedAt = new Date().toISOString();

    if (azureError || filebaseError) {
      return res.status(200).json({
        success:       true,
        fileId:        String(file._id),
        fileName:      file.originalName,
        result:        "ERROR",
        azureHash,
        filebaseHash,
        azureError:    azureError    ?? null,
        filebaseError: filebaseError ?? null,
        reason:        azureError
          ? "Azure primary storage unreachable"
          : "Filebase backup storage unreachable",
        ipfsCid:       file.ipfsCid,
        startedAt,
        completedAt,
      });
    }

    const match = azureHash === filebaseHash;

    return res.status(200).json({
      success:      true,
      fileId:       String(file._id),
      fileName:     file.originalName,
      result:       match ? "MATCH" : "MISMATCH",
      azureHash,
      filebaseHash,
      ipfsCid:      file.ipfsCid,
      ipfsUrl:      file.ipfsUrl ?? null,
      ...(match
        ? { note: "Azure primary and Filebase backup are byte-identical" }
        : {
            reason:
              "SHA-256 mismatch — Azure and Filebase copies are NOT identical. " +
              "Manual investigation required. DO NOT serve downloads until resolved.",
          }),
      startedAt,
      completedAt,
    });

  } catch (err) {
    console.error("[backupComparisonController] getBackupComparison:", err);
    return res.status(500).json({ success: false, message: "Backup comparison failed" });
  }
};

module.exports = { getBackupComparison };
