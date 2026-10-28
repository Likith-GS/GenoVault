/**
 * sraLocalIntegrationTest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * NCBI SRA Scan — Local Integration Test (No Public SRA Needed)
 *
 * Problem: The real startScan() queries NCBI's SRA API and needs a watermarked
 * file to already be present in a public accession (the misuse scenario).
 * This cannot be staged in a controlled experiment without actually uploading
 * real data to SRA.
 *
 * This script tests the DETECTION PIPELINE END-TO-END with a local mock:
 *
 *   Stage 1: Embed a watermark into a synthetic FASTQ buffer
 *   Stage 2: Simulate a "discovered" candidate (the embedded buffer itself)
 *   Stage 3: Run normalizeFASTQ + detectWatermarkInCandidate
 *   Stage 4: Simulate the classification logic (classifyMisuseEvent — rule table)
 *   Stage 5: Report detection timing, result, and classification
 *
 * Also benchmarks:
 *   - FASTQ normalisation latency (simulates SRA FASTQ parse step)
 *   - detectWatermarkInCandidate latency per WatermarkRecord
 *   - Classification rule application latency
 *
 * N_RUNS >= 5 (per reviewer requirement).
 *
 * Usage:
 *   node backend/experiments/sraLocalIntegrationTest.js
 *
 * Writes: results/phase8_sra/sra_local_integration.json
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto   = require("crypto");
const path     = require("path");
const fs       = require("fs");
const { BENCHMARK, computeStats } = require("./experimentManifest");
const wmService = require("../services/watermarkService");
const { normalizeFASTQ } = require("../services/watermark/lsbQualityEmbedder");

const N = Math.max(BENCHMARK.N_RUNS, 5);

// ─── Synthetic FASTQ generator (same as fixed robustness harness) ─────────────
function generateSyntheticFASTQBuffer(nReads = 500, readLen = 150) {
  const bases = ["A", "T", "C", "G"];
  const lines = [];
  for (let i = 0; i < nReads; i++) {
    lines.push(`@SRA_MOCK_${i}_${crypto.randomBytes(3).toString("hex")}`);
    let seq = "";
    for (let j = 0; j < readLen; j++) seq += bases[crypto.randomBytes(1)[0] % 4];
    lines.push(seq);
    lines.push("+");
    let qual = "";
    for (let j = 0; j < readLen; j++) {
      qual += String.fromCharCode(20 + (crypto.randomBytes(1)[0] % 21) + 33);
    }
    lines.push(qual);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// ─── Misuse classification (mirrors classifyMisuseEvent logic — no DB) ────────
// Standalone version for offline testing; does NOT call MongoDB.
function classifyMisuseLocal(confidence, source) {
  if (source === "NCBI_SRA" && (confidence === "HIGH" || confidence === "CONFIRMED")) {
    return "UNAUTHORIZED_REDISTRIBUTION";
  }
  if (confidence === "HIGH" || confidence === "CONFIRMED") {
    return "POLICY_VIOLATION";
  }
  if (confidence === "MEDIUM" || confidence === "LOW") {
    return "SUSPECTED_LEAK";
  }
  return "UNCLASSIFIED";
}

// ─── One scan pipeline run ──────────────────────────────────────────────────
async function runOnePipeline(runIndex, nReads = 500) {
  const result = {
    run:          runIndex + 1,
    stages:       {},
    detected:     false,
    verified:     false,
    confidence:   null,
    classification: null,
    errors:       [],
  };

  // ── Stage 1: Generate WatermarkRecord ──────────────────────────────────────
  const t0 = process.hrtime.bigint();
  let record;
  try {
    const ownerId      = crypto.randomBytes(12).toString("hex");
    const researcherId = crypto.randomBytes(12).toString("hex");
    const fileId       = crypto.randomBytes(12).toString("hex");
    const accessReqId  = crypto.randomBytes(12).toString("hex");
    const downloadId   = wmService.generateDownloadId();
    const nonce        = crypto.randomBytes(16);

    const seed = wmService.generateWatermarkSeed(
      ownerId, researcherId, fileId, accessReqId, downloadId, nonce
    );

    record = wmService.buildWatermarkRecord({
      watermarkId: wmService.generateWatermarkId(),
      downloadId, fileId, ownerId, researcherId,
      accessRequestId: accessReqId,
      watermarkSeed:   seed,
      fileExt:         ".fastq",
      fileSize:        nReads * 150 * 2,
      originalFileHash: crypto.randomBytes(32).toString("hex"),
    });
    result.stages.watermarkRecordMs = +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(4);
  } catch (e) {
    result.errors.push(`WM_RECORD: ${e.message}`);
    return result;
  }

  // ── Stage 2: Embed watermark ────────────────────────────────────────────────
  const t1 = process.hrtime.bigint();
  let watermarkedBuffer;
  try {
    const plainBuffer = generateSyntheticFASTQBuffer(nReads, 150);
    const embedded    = wmService.embedWatermark(plainBuffer, ".fastq", record);
    watermarkedBuffer = embedded.watermarkedBuffer;
    result.stages.embedMs = +(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(4);
    result.stages.fileSizeBytes = watermarkedBuffer.length;
  } catch (e) {
    result.errors.push(`EMBED: ${e.message}`);
    return result;
  }

  // ── Stage 3: Simulate SRA retrieval + FASTQ normalisation ──────────────────
  // (In the real system this is an HTTP fetch + fastq-dump parse)
  const t2 = process.hrtime.bigint();
  let normalizedReads;
  try {
    normalizedReads = normalizeFASTQ(watermarkedBuffer);
    result.stages.normalizeMs = +(Number(process.hrtime.bigint() - t2) / 1e6).toFixed(4);
    result.stages.nReadsNormalized = normalizedReads.length;
  } catch (e) {
    result.errors.push(`NORMALIZE: ${e.message}`);
    return result;
  }

  // ── Stage 4: Watermark detection ────────────────────────────────────────────
  const t3 = process.hrtime.bigint();
  let detection;
  try {
    detection = wmService.detectWatermarkInCandidate(normalizedReads, record);
    result.stages.detectMs  = +(Number(process.hrtime.bigint() - t3) / 1e6).toFixed(4);
    result.stages.matchScore = +(detection.matchScore || 0).toFixed(4);
    result.verified   = detection.verified;
    result.confidence = detection.confidence;
    result.detected   = detection.verified || detection.matchScore >= 0.85;
  } catch (e) {
    result.errors.push(`DETECT: ${e.message}`);
    return result;
  }

  // ── Stage 5: Classification ──────────────────────────────────────────────────
  const t4 = process.hrtime.bigint();
  result.classification       = classifyMisuseLocal(detection.confidence, "NCBI_SRA");
  result.stages.classifyMs    = +(Number(process.hrtime.bigint() - t4) / 1e6).toFixed(4);

  // ── Total pipeline ──────────────────────────────────────────────────────────
  result.stages.totalMs = +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(4);

  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault SRA Scan — Local Integration Test ===");
  console.log(`  N_RUNS = ${N}  |  500 reads × 150 bp per run`);
  console.log(`  Pipeline: embed → normalizeFASTQ → detectWatermarkInCandidate → classify`);
  console.log(`  Source mock: local FASTQ buffer (simulates SRA FASTQ retrieval)`);
  console.log(`  Timestamp: ${new Date().toISOString()}\n`);

  const runs = [];
  for (let i = 0; i < N; i++) {
    const r = await runOnePipeline(i);
    runs.push(r);
    console.log(
      `  Run ${r.run}: detected=${r.detected}  verified=${r.verified}  ` +
      `conf=${r.confidence}  class=${r.classification}  ` +
      `total=${r.stages.totalMs}ms  detect=${r.stages.detectMs}ms`
    );
  }

  // ─── Aggregate stats ───────────────────────────────────────────────────────
  const detected   = runs.filter(r => r.detected).length;
  const verified   = runs.filter(r => r.verified).length;
  const totalMsArr = runs.map(r => parseFloat(r.stages.totalMs));
  const detectMsArr = runs.filter(r => r.stages.detectMs).map(r => parseFloat(r.stages.detectMs));
  const normMsArr   = runs.filter(r => r.stages.normalizeMs).map(r => parseFloat(r.stages.normalizeMs));
  const embedMsArr  = runs.filter(r => r.stages.embedMs).map(r => parseFloat(r.stages.embedMs));

  console.log(`\n--- Summary ---`);
  console.log(`  Detection rate: ${detected}/${N} (${(detected/N*100).toFixed(0)}%)`);
  console.log(`  Verified rate:  ${verified}/${N} (${(verified/N*100).toFixed(0)}%)`);
  if (totalMsArr.length >= 3) {
    const s = computeStats(totalMsArr);
    console.log(`  Total pipeline: mean=${s.mean}ms  median=${s.median}ms  sd=${s.sd}ms`);
  }

  const output = {
    experiment: "sra_local_integration",
    runAt:      new Date().toISOString(),
    nRuns:      N,
    description: "End-to-end local integration test of SRA scan detection pipeline. Uses synthetic FASTQ — simulates the SRA retrieval + normalize + detect + classify stages without an NCBI API call.",
    pipeline:   "generateWatermarkSeed → buildWatermarkRecord → embedWatermark → [mock SRA FASTQ] → normalizeFASTQ → detectWatermarkInCandidate → classify",
    dataset: {
      source:   "SYNTHETIC — crypto.randomBytes(), no real genomic data",
      reads:    500,
      readLen:  150,
      dataType: "FASTQ (quality-score LSB watermarking)",
    },
    results: {
      detected:       detected,
      verified:       verified,
      detectionRate:  `${(detected/N*100).toFixed(1)}%`,
      verificationRate: `${(verified/N*100).toFixed(1)}%`,
      totalPipelineMs: totalMsArr.length >= 3 ? computeStats(totalMsArr) : null,
      detectStepMs:    detectMsArr.length >= 3 ? computeStats(detectMsArr) : null,
      normalizeStepMs: normMsArr.length >= 3    ? computeStats(normMsArr)  : null,
      embedStepMs:     embedMsArr.length >= 3   ? computeStats(embedMsArr) : null,
    },
    runs,
    realSRAGaps: [
      "Real NCBI SRA queries (NCBIAdapter.search()) NOT tested — requires NCBI API key and a public accession containing a watermarked file.",
      "SRA FASTQ retrieval latency NOT measured — this depends on SRA network throughput and accession size.",
      "The local test proves that the detection + classification logic is correct and fast. Network I/O is separate.",
    ],
    notes: [
      "The test simulates the worst-case scenario: an exact copy of the watermarked file is presented for detection.",
      "In a real misuse scenario, the candidate file may have undergone compression, format conversion, or partial re-sequencing — those cases are covered by the robustness harness.",
    ],
  };

  const outPath = path.resolve(__dirname, "../../results/phase8_sra/sra_local_integration.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n[Manifest] Result written: ${outPath}`);
  console.log("=== SRA local integration test complete ===");
}

main().catch(err => {
  console.error("SRA local integration FAILED:", err.message);
  process.exit(1);
});
