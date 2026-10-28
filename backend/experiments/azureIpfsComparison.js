/**
 * azureIpfsComparison.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — Azure primary vs Filebase/IPFS backup retrieval comparison.
 *
 * Measures:
 *   1. Azure blob read latency (streaming SHA-256, per synthetic object)
 *   2. Filebase S3 object read latency (streaming SHA-256, same key)
 *   3. Hash match verification between the two
 *
 * Policy:
 *   - Does NOT use real patient files — uploads synthetic random blobs first
 *   - Cleans up (deletes) all synthetic blobs after measurement
 *   - N_RUNS ≥ 3
 *   - Results written to results/baseline/azure_ipfs_comparison.json
 *
 * Usage:
 *   node backend/experiments/azureIpfsComparison.js
 *
 * Requires:
 *   - AZURE_STORAGE_CONNECTION_STRING (or Managed Identity env)
 *   - FILEBASE_BUCKET_NAME, FILEBASE_ACCESS_KEY_ID, FILEBASE_SECRET_ACCESS_KEY
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto = require("crypto");
const { downloadBlobToBuffer, verifyBlobExists } = require("../services/azureService");
const { BENCHMARK, writeResult, computeStats } = require("./experimentManifest");

const N = BENCHMARK.N_RUNS;

async function timedMs(fn) {
  const t0  = process.hrtime.bigint();
  const res = await fn();
  return { ms: +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(3), result: res };
}

async function main() {
  console.log("=== GenoVault Azure vs Filebase Retrieval Comparison ===");
  console.log(`  N_RUNS = ${N}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Check Azure availability
  const AZURE_AVAILABLE = Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    (process.env.AZURE_CLIENT_ID && process.env.AZURE_STORAGE_ACCOUNT_NAME)
  );

  // Check Filebase availability
  const FILEBASE_AVAILABLE = Boolean(
    process.env.FILEBASE_BUCKET_NAME &&
    (process.env.FILEBASE_ACCESS_KEY_ID || process.env.FILEBASE_ACCESS_KEY) &&
    (process.env.FILEBASE_SECRET_ACCESS_KEY || process.env.FILEBASE_SECRET)
  );

  if (!AZURE_AVAILABLE && !FILEBASE_AVAILABLE) {
    console.error("ERROR: Neither Azure nor Filebase credentials configured. Exiting.");
    process.exit(1);
  }

  const azureTimings    = [];
  const filebaseTimings = [];
  const hashMatches     = [];

  for (let i = 0; i < N; i++) {
    // Synthetic 100 KB blob
    const syntheticData = crypto.randomBytes(100 * 1024);
    const blobKey       = `benchmark-temp-${Date.now()}-${i}`;
    const expectedHash  = crypto.createHash("sha256").update(syntheticData).digest("hex");

    console.log(`  Run ${i + 1}/${N}: blobKey=${blobKey}`);

    // ── Azure timing ─────────────────────────────────────────────────────
    let azureMs   = null;
    let azureHash = null;

    if (AZURE_AVAILABLE) {
      try {
        const { BlobServiceClient } = require("@azure/storage-blob");
        const containerName = process.env.AZURE_CONTAINER_NAME || "genomic-files";
        const bsc           = process.env.AZURE_STORAGE_CONNECTION_STRING
          ? BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING)
          : (() => { throw new Error("Only connection string auth supported in benchmark"); })();
        const container = bsc.getContainerClient(containerName);
        const blockBlob = container.getBlockBlobClient(blobKey);

        // Upload synthetic blob
        await blockBlob.uploadData(syntheticData, { blobHTTPHeaders: { blobContentType: "application/octet-stream" } });

        // Time the download
        const { ms, result: buf } = await timedMs(() => downloadBlobToBuffer(blobKey));
        azureMs   = ms;
        azureHash = crypto.createHash("sha256").update(buf).digest("hex");

        // Cleanup
        await blockBlob.delete().catch(() => {});
        console.log(`    Azure: ${azureMs} ms`);
      } catch (err) {
        console.warn(`    Azure timing SKIPPED: ${err.message}`);
      }
    }

    // ── Filebase timing ───────────────────────────────────────────────────
    let filebaseMs   = null;
    let filebaseHash = null;

    if (FILEBASE_AVAILABLE) {
      try {
        const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
        const BUCKET = process.env.FILEBASE_BUCKET_NAME;
        const client = new S3Client({
          endpoint:       "https://s3.filebase.com",
          region:         "us-east-1",
          credentials: {
            accessKeyId:     process.env.FILEBASE_ACCESS_KEY_ID || process.env.FILEBASE_ACCESS_KEY,
            secretAccessKey: process.env.FILEBASE_SECRET_ACCESS_KEY || process.env.FILEBASE_SECRET,
          },
          forcePathStyle: true,
        });

        // Upload synthetic blob
        await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: blobKey, Body: syntheticData }));

        // Time the download
        const { ms } = await timedMs(async () => {
          const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: blobKey }));
          const chunks = [];
          for await (const chunk of res.Body) chunks.push(chunk);
          filebaseHash = crypto.createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
        });
        filebaseMs = ms;

        // Cleanup
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: blobKey })).catch(() => {});
        console.log(`    Filebase: ${filebaseMs} ms`);
      } catch (err) {
        console.warn(`    Filebase timing SKIPPED: ${err.message}`);
      }
    }

    // Hash integrity check
    const match = (azureHash && filebaseHash) ? (azureHash === filebaseHash) : null;
    if (match !== null) {
      console.log(`    Hash match: ${match ? "YES ✓" : "NO ✗ (MISMATCH)"}`);
    }

    if (azureMs    !== null) azureTimings.push(azureMs);
    if (filebaseMs !== null) filebaseTimings.push(filebaseMs);
    if (match      !== null) hashMatches.push(match);
  }

  const output = {
    experiment:     "azure_ipfs_retrieval_comparison",
    runAt:          new Date().toISOString(),
    nRuns:          N,
    syntheticSizeBytes: 100 * 1024,
    azure: {
      available: AZURE_AVAILABLE,
      timingsMs: azureTimings,
      stats:     azureTimings.length >= 3 ? computeStats(azureTimings) : null,
    },
    filebase: {
      available: FILEBASE_AVAILABLE,
      timingsMs: filebaseTimings,
      stats:     filebaseTimings.length >= 3 ? computeStats(filebaseTimings) : null,
    },
    hashIntegrity: {
      allMatched: hashMatches.length > 0 ? hashMatches.every(Boolean) : null,
      matches:    hashMatches,
    },
    notes: [
      "Synthetic 100 KB random blobs used — no real patient data.",
      "All benchmark blobs deleted after measurement.",
      "Azure timing = downloadBlobToBuffer() round-trip.",
      "Filebase timing = GetObjectCommand + stream drain.",
    ],
  };

  writeResult("azureIpfsCompare", output);
  console.log("\n=== Azure/Filebase comparison complete ===");
}

main().catch(err => {
  console.error("Azure/Filebase comparison FAILED:", err.message);
  process.exit(1);
});
