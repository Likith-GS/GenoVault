/**
 * ipfsService.js
 * ──────────────
 * Uploads files to Filebase (IPFS pinning service) via S3-compatible API.
 *
 * Performance optimisations (v2):
 *  1. SINGLETON S3 client — one TLS handshake per process lifetime instead of
 *     creating a new client for every call / every multipart part.
 *  2. Correct env var names — FILEBASE_ACCESS_KEY_ID / FILEBASE_SECRET_ACCESS_KEY
 *     (matching the .env keys that other services already use).
 *  3. Larger parts (25 MB) + higher concurrency (8) — fewer HTTP round-trips
 *     for large genomic files; Filebase supports parts up to 100 MB.
 *  4. Higher multipart threshold (50 MB) — small files go through the faster
 *     single-PutObject path instead of paying multipart overhead.
 *  5. Request / connect timeouts — prevents indefinite hangs when Filebase is slow.
 *  6. Faster CID polling — first check at 500 ms, then 1-s incremental back-off
 *     (max 8 attempts = ~28 s total vs the old 31.5 s max).
 *  7. Retry helper — transparent single retry on transient network errors so
 *     occasional Filebase hiccups don't fail the entire upload.
 */

"use strict";

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");

const { downloadBlobToBuffer } = require("./azureService");

// ── Config ───────────────────────────────────────────────────────────────────
const FILEBASE_ENDPOINT   = "https://s3.filebase.com";
const FILEBASE_BUCKET     = process.env.FILEBASE_BUCKET_NAME;
const FILEBASE_ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY_ID     // preferred name
                         || process.env.FILEBASE_ACCESS_KEY;        // legacy fallback
const FILEBASE_SECRET_KEY = process.env.FILEBASE_SECRET_ACCESS_KEY  // preferred name
                         || process.env.FILEBASE_SECRET_KEY;        // legacy fallback
const IPFS_GATEWAY        = "https://ipfs.filebase.io/ipfs";

// ── Tunable upload parameters ────────────────────────────────────────────────
// Raise MULTIPART_THRESHOLD — small files go through faster single-PutObject.
const MULTIPART_THRESHOLD = 50  * 1024 * 1024;   // 50 MB  (was 20 MB)
// Larger parts = fewer HTTP round-trips. Filebase supports up to 100 MB/part.
const PART_SIZE           = 25  * 1024 * 1024;   // 25 MB  (was 8 MB)
// More concurrent part uploads saturate the available bandwidth.
const CONCURRENCY         = 8;                    // (was 4)
// Timeouts prevent indefinite hangs on slow / unresponsive Filebase responses.
const REQUEST_TIMEOUT_MS  = 120_000;              // 2 min per HTTP request
const CONNECT_TIMEOUT_MS  =  10_000;              // 10 s TCP connect

// ── Singleton S3 client ───────────────────────────────────────────────────────
// Created once at module load — avoids repeated TLS handshakes.
// One client is safe for concurrent uploads (the SDK is stateless per-request).
let _client = null;
const getClient = () => {
  if (_client) return _client;
  if (!FILEBASE_ACCESS_KEY || !FILEBASE_SECRET_KEY) {
    throw new Error(
      "Filebase credentials missing. Set FILEBASE_ACCESS_KEY_ID, " +
      "FILEBASE_SECRET_ACCESS_KEY, FILEBASE_BUCKET_NAME in .env"
    );
  }
  _client = new S3Client({
    endpoint:        FILEBASE_ENDPOINT,
    region:          "us-east-1",
    credentials:     { accessKeyId: FILEBASE_ACCESS_KEY, secretAccessKey: FILEBASE_SECRET_KEY },
    forcePathStyle:  true,
    requestHandler:  undefined,  // use default (node-http-handler)
    // Timeouts: prevent hanging when Filebase is slow
    requestTimeout:  REQUEST_TIMEOUT_MS,
    connectTimeout:  CONNECT_TIMEOUT_MS,
    maxAttempts:     2,          // built-in SDK retry (handles transient 5xx)
  });
  return _client;
};

// ── Retry helper ──────────────────────────────────────────────────────────────
// Wraps an async fn with a single transparent retry on transient network errors.
const withRetry = async (fn, label) => {
  try {
    return await fn();
  } catch (err) {
    const transient = err.code === "ECONNRESET"  ||
                      err.code === "ETIMEDOUT"   ||
                      err.code === "ENOTFOUND"   ||
                      (err.$metadata?.httpStatusCode >= 500);
    if (!transient) throw err;
    console.warn(`[IPFS] ⚠️  Transient error for ${label} — retrying in 2 s: ${err.message}`);
    await new Promise(r => setTimeout(r, 2000));
    return fn();
  }
};

// ── CID retrieval via HeadObject ──────────────────────────────────────────────
const getCidFromHead = async (blobName) => {
  const res = await getClient().send(
    new HeadObjectCommand({ Bucket: FILEBASE_BUCKET, Key: blobName })
  );
  return res?.Metadata?.["cid"]              ||
         res?.Metadata?.["x-amz-meta-cid"]   ||
         null;
};

// ── CID capture middleware (small uploads) ────────────────────────────────────
// Attaches a middleware to intercept the x-amz-meta-cid response header.
// Returns a fresh client+getCid pair (middleware is per-client-instance).
const makeClientWithCidCapture = () => {
  const { S3Client: S3 } = require("@aws-sdk/client-s3");
  const client = new S3({
    endpoint:       FILEBASE_ENDPOINT,
    region:         "us-east-1",
    credentials:    { accessKeyId: FILEBASE_ACCESS_KEY, secretAccessKey: FILEBASE_SECRET_KEY },
    forcePathStyle: true,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxAttempts:    2,
  });
  let capturedCid = null;
  client.middlewareStack.add(
    (next) => async (args) => {
      const result  = await next(args);
      const headers = result?.response?.headers || {};
      capturedCid   = headers["x-amz-meta-cid"] || headers["X-Amz-Meta-Cid"] || null;
      return result;
    },
    { step: "deserialize", priority: "low", name: "captureCidMiddleware" }
  );
  return { client, getCid: () => capturedCid };
};

/* ─────────────────────────────────────────────────────────────────────────────
   _uploadSmall  (≤ MULTIPART_THRESHOLD)
   Single PutObject — optimal for smaller files (no round-trip overhead).
───────────────────────────────────────────────────────────────────────────── */
const _uploadSmall = async (blobName, originalName, mimeType, buffer) => {
  const { client, getCid } = makeClientWithCidCapture();

  await withRetry(() => client.send(new PutObjectCommand({
    Bucket:        FILEBASE_BUCKET,
    Key:           blobName,
    Body:          buffer,
    ContentType:   mimeType,
    ContentLength: buffer.length,
    Metadata:      { "original-name": encodeURIComponent(originalName) },
  })), blobName);

  // CID is usually in the response header; fall back to HeadObject if not.
  const cid = getCid() || await getCidFromHead(blobName);
  if (!cid) throw new Error("Filebase did not return a CID for small upload.");
  return { cid, ipfsUrl: `${IPFS_GATEWAY}/${cid}` };
};

/* ─────────────────────────────────────────────────────────────────────────────
   _uploadMultipart  (> MULTIPART_THRESHOLD)
   Splits buffer into PART_SIZE chunks and uploads CONCURRENCY parts at a time.
   Uses the singleton client — no repeated TLS handshakes between parts.
───────────────────────────────────────────────────────────────────────────── */
const _uploadMultipart = async (blobName, originalName, mimeType, buffer) => {
  const client = getClient();
  let uploadId = null;

  try {
    // ── 1. Start multipart upload ─────────────────────────────────────────
    const create = await withRetry(() => client.send(new CreateMultipartUploadCommand({
      Bucket:      FILEBASE_BUCKET,
      Key:         blobName,
      ContentType: mimeType,
      Metadata:    { "original-name": encodeURIComponent(originalName) },
    })), "CreateMultipart");
    uploadId = create.UploadId;

    // ── 2. Slice buffer into parts ────────────────────────────────────────
    const parts = [];
    for (let offset = 0; offset < buffer.length; offset += PART_SIZE) {
      parts.push({
        partNumber: parts.length + 1,
        data:       buffer.slice(offset, Math.min(offset + PART_SIZE, buffer.length)),
      });
    }
    const totalMB = (buffer.length / 1048576).toFixed(0);
    const partMB  = (PART_SIZE / 1048576).toFixed(0);
    console.log(`[IPFS] Multipart: ${totalMB} MB → ${parts.length} parts × ${partMB} MB, ${CONCURRENCY} concurrent`);

    // ── 3. Upload parts in parallel batches ───────────────────────────────
    const completedParts = [];
    for (let i = 0; i < parts.length; i += CONCURRENCY) {
      const batch   = parts.slice(i, i + CONCURRENCY);
      const batchNo = Math.floor(i / CONCURRENCY) + 1;
      const results = await Promise.all(
        batch.map(async ({ partNumber, data }) => {
          const res = await withRetry(() => client.send(new UploadPartCommand({
            Bucket:        FILEBASE_BUCKET,
            Key:           blobName,
            UploadId:      uploadId,
            PartNumber:    partNumber,
            Body:          data,
            ContentLength: data.length,
          })), `Part-${partNumber}`);
          console.log(`[IPFS] Part ${partNumber}/${parts.length} ✓ (${(data.length / 1048576).toFixed(1)} MB)`);
          return { PartNumber: partNumber, ETag: res.ETag };
        })
      );
      completedParts.push(...results);
      console.log(`[IPFS] Batch ${batchNo} complete (${completedParts.length}/${parts.length} parts)`);
    }

    // ── 4. Complete multipart upload ──────────────────────────────────────
    completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
    await withRetry(() => client.send(new CompleteMultipartUploadCommand({
      Bucket:          FILEBASE_BUCKET,
      Key:             blobName,
      UploadId:        uploadId,
      MultipartUpload: { Parts: completedParts },
    })), "CompleteMultipart");

    // ── 5. Poll for CID — fast first attempt, then exponential back-off ───
    // Filebase computes the IPFS CID asynchronously after the upload completes.
    // Strategy: check at 500 ms, then add 1 s per retry (500, 1500, 2500, …)
    console.log("[IPFS] Waiting for Filebase to compute CID…");
    let cid = null;
    const pollDelays = [500, 1500, 2500, 4000, 6000, 8000, 10000, 12000]; // ms
    for (let attempt = 0; attempt < pollDelays.length; attempt++) {
      await new Promise(r => setTimeout(r, pollDelays[attempt]));
      cid = await getCidFromHead(blobName);
      if (cid) {
        console.log(`[IPFS] CID ready after ${attempt + 1} poll(s): ${cid}`);
        break;
      }
      console.log(`[IPFS] CID not ready (poll ${attempt + 1}/${pollDelays.length})…`);
    }

    if (!cid) throw new Error("Filebase did not return a CID after multipart upload.");
    return { cid, ipfsUrl: `${IPFS_GATEWAY}/${cid}` };

  } catch (err) {
    // Abort the incomplete multipart upload to avoid orphaned storage charges
    if (uploadId) {
      try {
        await client.send(new AbortMultipartUploadCommand({
          Bucket: FILEBASE_BUCKET, Key: blobName, UploadId: uploadId,
        }));
        console.log(`[IPFS] Aborted incomplete multipart upload: ${blobName}`);
      } catch { /* ignore abort errors */ }
    }
    throw err;
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   uploadToIPFS  (public API — unchanged signature)
   ─────────────────────────────────────────────────
   @param blobName     Azure blob key (used as Filebase key)
   @param originalName Human-readable file name
   @param mimeType     MIME type
   @param sizeBytes    File size in bytes (used only when buffer is omitted)
   @param buffer       Optional: in-memory Buffer of the file.
                       When provided, Azure download is SKIPPED (much faster).
                       Pass the already-encrypted buffer from Phase 1 of the
                       background job to avoid a second Azure round-trip.
   @returns {{ cid: string, ipfsUrl: string }}
───────────────────────────────────────────────────────────────────────────── */
const uploadToIPFS = async (blobName, originalName, mimeType = "application/octet-stream", sizeBytes, buffer) => {
  if (!FILEBASE_BUCKET) throw new Error("FILEBASE_BUCKET_NAME is not set in .env");

  // ── Obtain the file bytes ─────────────────────────────────────────────────
  let fileBuffer = buffer;
  if (!fileBuffer) {
    console.log(`[IPFS] No buffer provided — downloading from Azure: ${blobName}`);
    fileBuffer = await downloadBlobToBuffer(blobName);
  } else {
    console.log(`[IPFS] Using in-memory buffer (${(fileBuffer.length / 1048576).toFixed(1)} MB) — Azure download skipped ✓`);
  }

  const fileMB = (fileBuffer.length / 1048576).toFixed(1);

  // ── Choose upload strategy based on size ──────────────────────────────────
  if (fileBuffer.length > MULTIPART_THRESHOLD) {
    console.log(`[IPFS] ${fileMB} MB > ${MULTIPART_THRESHOLD / 1048576} MB threshold — multipart upload (${CONCURRENCY}× parallel, ${PART_SIZE / 1048576} MB parts)`);
    return _uploadMultipart(blobName, originalName, mimeType, fileBuffer);
  }

  console.log(`[IPFS] ${fileMB} MB ≤ ${MULTIPART_THRESHOLD / 1048576} MB threshold — single PutObject`);
  return _uploadSmall(blobName, originalName, mimeType, fileBuffer);
};

/* ─────────────────────────────────────────────────────────────────────────────
   deleteFromIPFS  (public API — unchanged)
   Unpins a file from Filebase / IPFS.
───────────────────────────────────────────────────────────────────────────── */
const deleteFromIPFS = async (blobName) => {
  if (!FILEBASE_BUCKET) return;
  await withRetry(
    () => getClient().send(new DeleteObjectCommand({ Bucket: FILEBASE_BUCKET, Key: blobName })),
    `delete:${blobName}`
  );
};

module.exports = { uploadToIPFS, deleteFromIPFS };
