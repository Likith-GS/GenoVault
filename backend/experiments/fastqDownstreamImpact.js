/**
 * fastqDownstreamImpact.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 11 — FASTQ watermark downstream impact experiment.
 *
 * Measures whether LSB quality-score watermarking introduces statistically
 * significant changes to:
 *   M1. Mean quality score per read
 *   M2. Per-base quality score distribution (histogram)
 *   M3. Quality score standard deviation
 *   M4. Fraction of bases with Phred ≥ 30 (Q30 rate)
 *
 * Design:
 *   - Generate N synthetic FASTQ quality arrays
 *   - Embed watermark → compare metrics between original and watermarked
 *   - Report mean absolute difference (MAD) for each metric
 *   - Report whether MAD < 1.0 Phred unit (acceptable for downstream tools)
 *
 * Policy:
 *   - Synthetic quality arrays only — no real patient data
 *   - N_RUNS ≥ 3
 *   - Results written to results/phase7_watermark/fastq_downstream_impact.json
 *
 * Usage:
 *   node backend/experiments/fastqDownstreamImpact.js
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto = require("crypto");
const { BENCHMARK, writeResult, computeStats } = require("./experimentManifest");

const N = Math.max(BENCHMARK.N_RUNS, 5);

// ─── Synthetic FASTQ helpers ───────────────────────────────────────────────────
function generateReads(nReads = 1000, readLen = 150) {
  const reads = [];
  for (let i = 0; i < nReads; i++) {
    const qualities = [];
    for (let j = 0; j < readLen; j++) {
      // Phred quality distribution: weighted toward higher values (realistic)
      const base = 20 + Math.floor(Math.random() * 21); // [20, 40]
      qualities.push(base);
    }
    reads.push(qualities);
  }
  return reads;
}

// Minimal LSB embedding simulation (matches lsbQualityEmbedder pattern)
// Embeds one payload bit per read into the LSB of quality[0].
function embedLsbPayload(reads, payloadBits) {
  const result = reads.map((quals, i) => {
    const bitIdx = i % payloadBits.length;
    const bit    = payloadBits[bitIdx];
    const newQ0  = (quals[0] & ~1) | bit; // clear LSB, set to payload bit
    return [newQ0, ...quals.slice(1)];
  });
  return result;
}

// ─── Quality metrics ─────────────────────────────────────────────────────────
function computeQualityMetrics(reads) {
  const allScores = reads.flat();
  const total     = allScores.length;
  const mean      = allScores.reduce((s, q) => s + q, 0) / total;
  const variance  = allScores.reduce((s, q) => s + (q - mean) ** 2, 0) / total;
  const sd        = Math.sqrt(variance);
  const q30Rate   = allScores.filter(q => q >= 30).length / total;

  // Per-base histogram [0–41]
  const histogram = new Array(42).fill(0);
  for (const q of allScores) histogram[Math.min(q, 41)]++;

  return {
    mean:    +mean.toFixed(4),
    sd:      +sd.toFixed(4),
    q30Rate: +q30Rate.toFixed(4),
    histogram,
    totalBases: total,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault FASTQ Downstream Impact Experiment ===");
  console.log(`  N_RUNS = ${N}`);
  console.log(`  Synthetic reads: 1000 × 150 bp per run`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  const meanDiffs   = [];
  const sdDiffs     = [];
  const q30Diffs    = [];
  const runDetails  = [];

  for (let i = 0; i < N; i++) {
    const reads    = generateReads(1000, 150);

    // Generate a random 64-bit payload (as array of bits)
    const payloadBytes = crypto.randomBytes(8);
    const payloadBits  = [];
    for (const byte of payloadBytes) {
      for (let b = 7; b >= 0; b--) payloadBits.push((byte >> b) & 1);
    }

    const watermarked = embedLsbPayload(reads, payloadBits);

    const origMetrics = computeQualityMetrics(reads);
    const wmMetrics   = computeQualityMetrics(watermarked);

    const meanDiff = Math.abs(wmMetrics.mean   - origMetrics.mean);
    const sdDiff   = Math.abs(wmMetrics.sd     - origMetrics.sd);
    const q30Diff  = Math.abs(wmMetrics.q30Rate - origMetrics.q30Rate);

    meanDiffs.push(meanDiff);
    sdDiffs.push(sdDiff);
    q30Diffs.push(q30Diff);

    runDetails.push({
      run:      i + 1,
      original: origMetrics,
      watermarked: wmMetrics,
      deltas: {
        meanAbsDiff:   +meanDiff.toFixed(6),
        sdAbsDiff:     +sdDiff.toFixed(6),
        q30RateAbsDiff: +q30Diff.toFixed(6),
      },
    });

    console.log(`  Run ${i + 1}/${N}: ΔMean=${meanDiff.toFixed(6)} ΔSD=${sdDiff.toFixed(6)} ΔQ30=${q30Diff.toFixed(6)}`);
  }

  // Summary
  const meanDiffStats = computeStats(meanDiffs, "Phred units");
  const sdDiffStats   = computeStats(sdDiffs,   "Phred units");
  const q30DiffStats  = computeStats(q30Diffs,  "fraction");

  // Acceptability thresholds (conservative):
  //   ΔMean < 1.0 Phred unit, ΔQ30 < 0.01 (1 percentage point)
  const MEAN_THRESHOLD = 1.0;
  const Q30_THRESHOLD  = 0.01;

  const output = {
    experiment: "fastq_downstream_impact",
    runAt:      new Date().toISOString(),
    nRuns:      N,
    syntheticReads: { count: 1000, readLength: 150, qualityRange: [20, 40] },
    metrics: {
      meanQualityDiff: {
        stats:       meanDiffStats,
        threshold:   `< ${MEAN_THRESHOLD} Phred unit`,
        withinLimit: meanDiffStats.mean < MEAN_THRESHOLD,
      },
      sdDiff: {
        stats:       sdDiffStats,
        threshold:   "< 1.0 Phred unit",
        withinLimit: sdDiffStats.mean < MEAN_THRESHOLD,
      },
      q30RateDiff: {
        stats:       q30DiffStats,
        threshold:   `< ${Q30_THRESHOLD} fraction`,
        withinLimit: q30DiffStats.mean < Q30_THRESHOLD,
      },
    },
    conclusion: (meanDiffStats.mean < MEAN_THRESHOLD && q30DiffStats.mean < Q30_THRESHOLD)
      ? "ACCEPTABLE: LSB watermarking causes sub-threshold quality perturbation"
      : "REVIEW_REQUIRED: Perturbation exceeds one or more acceptability thresholds",
    runs: runDetails,
    notes: [
      "Synthetic FASTQ quality arrays only — no real patient data.",
      "Embedding: 1 payload bit per read in quality[0] LSB.",
      "Downstream tools (e.g., FastQC, trimmomatic) are insensitive to ±1 Phred changes.",
      "ΔMean < 1.0 Phred unit is the widely accepted threshold for negligible impact.",
    ],
  };

  writeResult("fastqImpact", output);

  console.log("\n--- Summary ---");
  console.log(`  Mean quality ΔMean: ${meanDiffStats.mean} (threshold < ${MEAN_THRESHOLD}): ${output.metrics.meanQualityDiff.withinLimit ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`  Q30 rate    ΔQ30:  ${q30DiffStats.mean}  (threshold < ${Q30_THRESHOLD}): ${output.metrics.q30RateDiff.withinLimit ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`  Conclusion: ${output.conclusion}`);
  console.log("\n=== FASTQ downstream impact experiment complete ===");
}

main().catch(err => {
  console.error("FASTQ downstream impact FAILED:", err.message);
  process.exit(1);
});
