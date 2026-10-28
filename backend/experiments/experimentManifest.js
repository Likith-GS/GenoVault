/**
 * experimentManifest.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 — Experiment configuration manifest.
 *
 * Shared by all benchmark and experiment scripts:
 *   - blockchainBenchmark.js
 *   - downloadBenchmark.js
 *   - azureIpfsComparison.js
 *   - watermarkRobustnessHarness.js
 *   - fastqDownstreamImpact.js
 *   - generateTestReport.js
 *
 * Policy:
 *   - N_RUNS ≥ 3 for any benchmark that reports mean/SD (reviewer requirement)
 *   - Results are written to JSON files in RESULTS_DIR
 *   - Timestamps use ISO 8601
 *   - NO fabricated numbers — all metrics come from actual runtime
 */

"use strict";

const path = require("path");

// ─── Paths ───────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const RESULTS_DIR  = path.join(PROJECT_ROOT, "results");

const RESULT_PATHS = {
  blockchain:        path.join(RESULTS_DIR, "phase4_blockchain",   "blockchain_latency.json"),
  download:          path.join(RESULTS_DIR, "phase4_blockchain",   "download_latency.json"),
  encryptionV1V2:    path.join(RESULTS_DIR, "phase2_encryption",   "encryption_v1_v2.json"),
  azureIpfsCompare:  path.join(RESULTS_DIR, "baseline",            "azure_ipfs_comparison.json"),
  watermarkRobust:   path.join(RESULTS_DIR, "phase7_watermark",    "watermark_robustness.json"),
  fastqImpact:       path.join(RESULTS_DIR, "phase7_watermark",    "fastq_downstream_impact.json"),
  testReport:        path.join(RESULTS_DIR, "test_report.json"),
};

// ─── Benchmark parameters ─────────────────────────────────────────────────────
const BENCHMARK = {
  // Minimum runs for any timed experiment (reviewer requirement: ≥3)
  N_RUNS: 3,

  // File sizes used in synthetic timing tests (bytes)
  // These do NOT download real patient data — only synthetic random bytes
  SYNTHETIC_FILE_SIZES_BYTES: [
    10  * 1024,       // 10 KB  (small)
    100 * 1024,       // 100 KB (medium)
    1   * 1024 * 1024, // 1 MB  (representative FASTQ chunk)
  ],

  // Blockchain tx wait timeout
  BLOCKCHAIN_TIMEOUT_MS: 120_000,

  // Download timeout per attempt
  DOWNLOAD_TIMEOUT_MS: 60_000,
};

// ─── Experiment identity ──────────────────────────────────────────────────────
const MANIFEST = {
  project:     "GenoVault",
  version:     "2.0.0-revision",
  description: "Major revision experiments — addressing reviewer concerns R1.1–R3.5",
  createdAt:   new Date().toISOString(),
  resultPaths: RESULT_PATHS,
  benchmark:   BENCHMARK,
};

// ─── Utility: write result JSON ───────────────────────────────────────────────
const fs = require("fs");

/**
 * writeResult
 * ───────────
 * Writes an experiment result object to the designated JSON file.
 * Creates parent directories if needed.
 *
 * @param {string} key   Key from RESULT_PATHS
 * @param {object} data  Result object to write
 */
function writeResult(key, data) {
  const filePath = RESULT_PATHS[key];
  if (!filePath) throw new Error(`Unknown result key: ${key}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`[Manifest] Result written: ${filePath}`);
}

/**
 * computeStats
 * ────────────
 * Given an array of numeric measurements, computes mean, median, SD, min, max.
 * N must be ≥ 3 (reviewer requirement).
 *
 * @param {number[]} values
 * @returns {{ n, mean, median, sd, min, max, unit }}
 */
function computeStats(values, unit = "ms") {
  if (values.length < 3) {
    throw new Error(`computeStats requires N≥3 (reviewer requirement). Got N=${values.length}`);
  }
  const n      = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean   = values.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const sd   = Math.sqrt(variance);
  const min  = sorted[0];
  const max  = sorted[n - 1];
  return { n, mean: +mean.toFixed(3), median: +median.toFixed(3), sd: +sd.toFixed(3), min, max, unit };
}

module.exports = { MANIFEST, RESULT_PATHS, BENCHMARK, writeResult, computeStats };
