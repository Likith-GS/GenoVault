/**
 * watermarkRobustnessHarness.js  — FIXED v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10 — Watermark robustness experiment.
 *
 * FIX (2026-10-14): The previous version built a synthetic WatermarkRecord
 * (payload = seed % 256) that did NOT match what lsbQualityEmbedder.embed()
 * actually embedded. This caused 0% detection even for lossless P1.
 *
 * Correct approach:
 *   1. Generate a real watermarkSeed via generateWatermarkSeed()
 *   2. Build a complete WatermarkRecord via buildWatermarkRecord()
 *   3. Produce a real FASTQ buffer from synthetic reads
 *   4. Call embedWatermark() → get the actual watermarked buffer
 *   5. Apply perturbation to the watermarked buffer
 *   6. Parse the perturbed buffer via normalizeFASTQ()
 *   7. Call detectWatermarkInCandidate() with the SAME record used in step 2
 *   8. Record: verified, matchScore, confidence
 *
 * This is exactly the embed→perturb→detect pipeline used in watermark.test.js WM-06.
 *
 * Perturbations tested:
 *   P1. Lossless round-trip         — embed → detect (identity check, must be 100%)
 *   P2. Quality score ±1 jitter     — random ±1 on quality ASCII bytes
 *   P3. 5% random read substitution — 5% of FASTQ reads replaced with random reads
 *   P4. 10% read truncation         — drop bottom 10% of reads
 *   P5. Quality score normalization  — re-scale ASCII qualities to Phred [0, 40]
 *
 * Results written to:
 *   results/phase7_watermark/watermark_robustness.json
 *
 * Usage:
 *   node backend/experiments/watermarkRobustnessHarness.js
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto  = require("crypto");
const { BENCHMARK, writeResult, computeStats } = require("./experimentManifest");

const wmService   = require("../services/watermarkService");
const { normalizeFASTQ } = require("../services/watermark/lsbQualityEmbedder");

// Use N=5 for robustness experiments (>= reviewer requirement of N≥3)
const N = Math.max(BENCHMARK.N_RUNS, 5);

// ─── Synthetic FASTQ buffer generator ────────────────────────────────────────
// Produces a valid FASTQ-format Buffer with nReads reads of readLen bases.
// Quality scores are Phred [20, 40], ASCII-encoded (add 33).
// Uses only synthetic random data — no real genomic content.
function generateSyntheticFASTQBuffer(nReads = 500, readLen = 150) {
  const bases  = ["A", "T", "C", "G"];
  const lines  = [];

  for (let i = 0; i < nReads; i++) {
    // Header
    lines.push(`@SYN_READ_${i}_${crypto.randomBytes(4).toString("hex")}`);

    // Sequence: random bases
    let seq = "";
    for (let j = 0; j < readLen; j++) {
      seq += bases[crypto.randomBytes(1)[0] % 4];
    }
    lines.push(seq);

    // Separator
    lines.push("+");

    // Quality: random Phred [20, 40] → ASCII [53, 73]
    let qual = "";
    for (let j = 0; j < readLen; j++) {
      const phred = 20 + (crypto.randomBytes(1)[0] % 21); // [20, 40]
      qual += String.fromCharCode(phred + 33);
    }
    lines.push(qual);
  }

  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// ─── Build a real WatermarkRecord (same path as production) ──────────────────
function makeSyntheticWatermarkRecord(runIndex) {
  const ownerId       = crypto.randomBytes(12).toString("hex");
  const researcherId  = crypto.randomBytes(12).toString("hex");
  const fileId        = crypto.randomBytes(12).toString("hex");
  const accessReqId   = crypto.randomBytes(12).toString("hex");
  const downloadId    = wmService.generateDownloadId();
  const nonce         = crypto.randomBytes(16);   // 16-byte Buffer

  // Real seed via HMAC-SHA256 (requires WATERMARK_SECRET in .env)
  const watermarkSeed = wmService.generateWatermarkSeed(
    ownerId, researcherId, fileId, accessReqId, downloadId, nonce
  );

  // Build complete WatermarkRecord including watermarkCommitment
  return wmService.buildWatermarkRecord({
    watermarkId:      wmService.generateWatermarkId(),
    downloadId,
    fileId,
    ownerId,
    researcherId,
    accessRequestId:  accessReqId,
    watermarkSeed,
    fileExt:          ".fastq",
    fileSize:         0,
    originalFileHash: crypto.randomBytes(32).toString("hex"),
  });
}

// ─── FASTQ-level perturbation functions ──────────────────────────────────────
// These operate on a FASTQ Buffer (not a reads array) to simulate real-world
// transformations before detection. Detection always normalizes afterwards.

/**
 * P1: No perturbation — lossless round-trip.
 * Expected detection rate: 100% (validated by WM-06 in the unit tests).
 */
function perturbNone(fastqBuffer) {
  return Buffer.from(fastqBuffer); // shallow copy, same content
}

/**
 * P2: Quality-score ±1 jitter.
 * Each quality ASCII byte is randomly shifted by +1 or -1, clamped to [33, 73].
 * (Phred [0, 40] in ASCII offset encoding.)
 */
function perturbQualityJitter(fastqBuffer, magnitude = 1) {
  const text  = fastqBuffer.toString("utf8");
  const lines = text.split("\n");
  const out   = [];

  let readLine = 0; // 0=header, 1=seq, 2=plus, 3=qual (mod 4 after stripping blanks)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") { out.push(line); continue; }

    // Detect quality line: comes 4th in every group
    const isQual = (readLine % 4 === 3);
    readLine++;

    if (!isQual) {
      out.push(line);
    } else {
      let jittered = "";
      for (let j = 0; j < line.length; j++) {
        const ascii = line.charCodeAt(j);
        const shift = Math.random() < 0.5 ? magnitude : -magnitude;
        jittered += String.fromCharCode(Math.max(33, Math.min(73, ascii + shift)));
      }
      out.push(jittered);
    }
  }
  return Buffer.from(out.join("\n"), "utf8");
}

/**
 * P3: 5% random read substitution.
 * Replace ~5% of reads with freshly-generated random reads.
 */
function perturbReadSubstitution(fastqBuffer, rate = 0.05) {
  const reads = normalizeFASTQ(fastqBuffer);
  const n     = Math.floor(reads.length * rate);
  const result = [...reads];

  for (let i = 0; i < n; i++) {
    const idx     = Math.floor(Math.random() * result.length);
    const readLen = result[idx].sequence.length;
    const bases   = ["A", "T", "C", "G"];
    let seq  = "";
    let qual = "";
    for (let j = 0; j < readLen; j++) {
      seq  += bases[crypto.randomBytes(1)[0] % 4];
      const phred = 20 + (crypto.randomBytes(1)[0] % 21);
      qual += String.fromCharCode(phred + 33);
    }
    result[idx] = {
      header:   result[idx].header,
      sequence: seq,
      plus:     "+",
      quality:  qual,
    };
  }

  // Reconstruct FASTQ buffer
  const lines = [];
  for (const r of result) {
    lines.push(r.header, r.sequence, r.plus, r.quality);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/**
 * P4: 10% read truncation.
 * Remove the last 10% of reads from the FASTQ file.
 */
function perturbReadTruncation(fastqBuffer, rate = 0.10) {
  const reads = normalizeFASTQ(fastqBuffer);
  const keep  = Math.floor(reads.length * (1 - rate));
  const lines  = [];
  for (const r of reads.slice(0, keep)) {
    lines.push(r.header, r.sequence, r.plus, r.quality);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/**
 * P5: Quality-score normalization.
 * Re-scale ASCII qualities so they span the full Phred [0, 40] range.
 * Simulates a tool that normalises quality-score distributions.
 */
function perturbQualityNormalization(fastqBuffer) {
  const text  = fastqBuffer.toString("utf8");
  const lines = text.split("\n");
  const out   = [];

  // First pass: find global ASCII min/max in quality lines
  let globalMin = 255;
  let globalMax = 0;
  let readLine  = 0;
  for (const line of lines) {
    if (line === "") continue;
    if (readLine % 4 === 3) {
      for (let j = 0; j < line.length; j++) {
        const a = line.charCodeAt(j);
        if (a < globalMin) globalMin = a;
        if (a > globalMax) globalMax = a;
      }
    }
    readLine++;
  }

  const range = globalMax - globalMin || 1;

  // Second pass: rescale
  readLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") { out.push(line); continue; }
    const isQual = (readLine % 4 === 3);
    readLine++;
    if (!isQual) {
      out.push(line);
    } else {
      let norm = "";
      for (let j = 0; j < line.length; j++) {
        const ascii   = line.charCodeAt(j);
        const scaled  = Math.round(((ascii - globalMin) / range) * 40) + 33;
        norm += String.fromCharCode(Math.max(33, Math.min(73, scaled)));
      }
      out.push(norm);
    }
  }

  return Buffer.from(out.join("\n"), "utf8");
}

// ─── Run one perturbation experiment ──────────────────────────────────────────
async function runPerturbation(label, perturbFn, nReads = 500, readLen = 150) {
  console.log(`\n  --- Perturbation: ${label} ---`);
  const results = [];

  for (let i = 0; i < N; i++) {
    let record;
    let plainBuffer;
    let wmBuffer;

    try {
      // Step 1: Build a real WatermarkRecord
      record = makeSyntheticWatermarkRecord(i);

      // Step 2: Generate synthetic FASTQ
      plainBuffer = generateSyntheticFASTQBuffer(nReads, readLen);

      // Step 3: Embed watermark using the real embed pipeline
      const { watermarkedBuffer } = wmService.embedWatermark(plainBuffer, ".fastq", record);
      wmBuffer = watermarkedBuffer;

    } catch (err) {
      results.push({
        run: i + 1, detected: false, matchScore: 0, confidence: "LOW",
        error: `EMBED_FAILED: ${err.message}`,
      });
      console.warn(`    Run ${i + 1}: EMBED ERROR — ${err.message}`);
      continue;
    }

    try {
      // Step 4: Apply perturbation to the watermarked buffer
      const perturbed = perturbFn(wmBuffer);

      // Step 5: Detect using the SAME record that was used to embed
      const detection = wmService.detectWatermarkInCandidate(perturbed, record);

      results.push({
        run:        i + 1,
        detected:   detection.verified || detection.matchScore >= 0.85,
        matchScore: +(detection.matchScore || 0).toFixed(4),
        confidence: detection.confidence,
        verified:   detection.verified,
      });

      console.log(
        `    Run ${i + 1}: score=${(detection.matchScore || 0).toFixed(4)}` +
        `  verified=${detection.verified}  conf=${detection.confidence}`
      );

    } catch (err) {
      results.push({
        run: i + 1, detected: false, matchScore: 0, confidence: "LOW",
        error: `DETECT_FAILED: ${err.message}`,
      });
      console.warn(`    Run ${i + 1}: DETECT ERROR — ${err.message}`);
    }
  }

  const detected     = results.filter(r => r.detected).length;
  const scores       = results.map(r => r.matchScore || 0);
  const detectionRate = (detected / N) * 100;

  const summary = {
    label,
    nRuns:        N,
    detected,
    notDetected:  N - detected,
    detectionRate: `${detectionRate.toFixed(1)}%`,
    matchScoreStats: scores.length >= 3 ? computeStats(scores, "score") : null,
    runs: results,
  };

  console.log(`    Detection rate: ${summary.detectionRate} (${detected}/${N})`);
  return summary;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault Watermark Robustness Harness v2 (FIXED) ===");
  console.log(`  N_RUNS = ${N}`);
  console.log(`  Synthetic reads: 500 reads × 150 bp`);
  console.log(`  Pipeline: generateWatermarkSeed → buildWatermarkRecord → embedWatermark → perturb → detectWatermarkInCandidate`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  Fix note: Uses real embed() output — no longer constructs a stub record`);

  const perturbations = [
    { label: "P1_lossless_roundtrip",          fn: perturbNone },
    { label: "P2_quality_jitter_plus_minus_1",  fn: (b) => perturbQualityJitter(b, 1) },
    { label: "P3_5pct_read_substitution",       fn: (b) => perturbReadSubstitution(b, 0.05) },
    { label: "P4_10pct_read_truncation",        fn: (b) => perturbReadTruncation(b, 0.10) },
    { label: "P5_quality_normalization",        fn: perturbQualityNormalization },
  ];

  const allResults = [];
  for (const { label, fn } of perturbations) {
    const summary = await runPerturbation(label, fn);
    allResults.push(summary);
  }

  const output = {
    experiment:   "watermark_robustness",
    version:      "v2_fixed",
    runAt:        new Date().toISOString(),
    fixNote:      "Uses real embedWatermark() output. detectWatermarkInCandidate() called with the identical WatermarkRecord used in embed(). No stub payload construction.",
    pipeline:     "generateWatermarkSeed → buildWatermarkRecord → embedWatermark(.fastq) → perturbFn → normalizeFASTQ → detectWatermarkInCandidate",
    nRuns:        N,
    syntheticReads: { count: 500, readLength: 150, dataSource: "SYNTHETIC — crypto.randomBytes() only" },
    detectionThreshold: "verified === true OR matchScore >= 0.85",
    perturbations:  allResults,
    notes: [
      "Synthetic FASTQ buffers only — no real patient data.",
      "P1 (lossless) MUST show 100% detection — this is the baseline correctness check.",
      "P2–P5 show robustness under common post-sequencing transformations.",
      "WATERMARK_SECRET must be set in .env for this harness to run.",
    ],
  };

  writeResult("watermarkRobust", output);
  console.log("\n=== Watermark robustness experiment complete (v2) ===");
}

main().catch(err => {
  console.error("Watermark robustness harness FAILED:", err.message);
  process.exit(1);
});
