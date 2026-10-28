/**
 * generateTestReport.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 9 — Consolidated 29-test detailed test report generator.
 *
 * Reads Jest test results (--json output) and the experiment JSON results,
 * then assembles a structured report that maps each test to its reviewer item.
 *
 * The 29 tests covered:
 *
 *   Identity (R3.1)          — identity.test.js (8 tests)
 *   Encryption V1/V2 (R3.2)  — encryption.test.js (7 tests)
 *   Integrity Categories (R3.4) — integrity.test.js (10 tests)
 *   Watermark detection       — watermark.test.js (4 tests)
 *
 * Plus experiment results from:
 *   - blockchain_latency.json   (R2.3 blockchain)
 *   - download_latency.json     (R3.2 overhead)
 *   - watermark_robustness.json (R3.5 robustness)
 *   - fastq_downstream_impact.json (R3.5 impact)
 *
 * Usage:
 *   # Run tests first with JSON output:
 *   npx jest tests/ --json --outputFile=results/jest_results.json
 *   # Then generate the report:
 *   node backend/experiments/generateTestReport.js
 *
 * Output: results/test_report.json
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const fs   = require("fs");
const path = require("path");
const { RESULT_PATHS, MANIFEST } = require("./experimentManifest");

const PROJECT_ROOT     = path.resolve(__dirname, "../..");
const JEST_OUTPUT_PATH = path.join(PROJECT_ROOT, "results", "jest_results.json");

// ─── Reviewer item mapping ────────────────────────────────────────────────────
// Maps each test suite to the reviewer items it addresses.
const REVIEWER_MAP = {
  "identity.test.js": {
    reviewerItems: ["R3.1 — ORCID identifier versioning and HMAC binding"],
    description: "Identity V1 (keccak256) vs V2 (HMAC-SHA256) — migration safety and backward compat",
  },
  "encryption.test.js": {
    reviewerItems: ["R3.2 — Encrypt-then-MAC (AES-256-CBC + HMAC-SHA256)"],
    description: "V1 legacy decryption, V2 encryption properties, MAC rejection of tampered ciphertext",
  },
  "integrity.test.js": {
    reviewerItems: ["R3.4 — Integrity category derivation (8 categories, explicit priority rules)"],
    description: "All 7 priority rules tested; IPFS PENDING correctly classified; simultaneous failures resolved",
  },
  "watermark.test.js": {
    reviewerItems: ["R3.5 — Watermark embedding and detection"],
    description: "LSB quality watermark embed → detect round-trip and misuse classification",
  },
};

// ─── Load helper ──────────────────────────────────────────────────────────────
function loadJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  [MISSING] ${label}: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.warn(`  [PARSE ERROR] ${label}: ${e.message}`);
    return null;
  }
}

// ─── Parse Jest JSON results ──────────────────────────────────────────────────
function parseJestResults(jestData) {
  if (!jestData) return { status: "NOT_RUN", suites: [] };

  const suites = (jestData.testResults || []).map(suite => {
    const suiteName = path.basename(suite.testFilePath || "unknown");
    const tests     = (suite.testResults || []).map(t => ({
      name:    t.fullName || t.title,
      status:  t.status,      // "passed" | "failed" | "pending"
      durationMs: t.duration,
    }));
    return {
      suite: suiteName,
      reviewerItems:  REVIEWER_MAP[suiteName]?.reviewerItems  ?? [],
      description:    REVIEWER_MAP[suiteName]?.description    ?? "",
      passed:  tests.filter(t => t.status === "passed").length,
      failed:  tests.filter(t => t.status === "failed").length,
      pending: tests.filter(t => t.status === "pending").length,
      total:   tests.length,
      tests,
    };
  });

  const totalPassed  = suites.reduce((s, r) => s + r.passed,  0);
  const totalFailed  = suites.reduce((s, r) => s + r.failed,  0);
  const totalPending = suites.reduce((s, r) => s + r.pending, 0);
  const totalTests   = suites.reduce((s, r) => s + r.total,   0);

  return {
    status:       jestData.success ? "PASS" : "FAIL",
    totalTests,
    totalPassed,
    totalFailed,
    totalPending,
    suites,
    jestVersion:  jestData.version ?? null,
    runAt:        jestData.startTime ? new Date(jestData.startTime).toISOString() : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log("=== GenoVault Test Report Generator ===");
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log();

  // Load Jest results
  console.log("Loading Jest test results...");
  const jestRaw     = loadJson(JEST_OUTPUT_PATH, "Jest output");
  const jestResults = parseJestResults(jestRaw);
  console.log(`  Status: ${jestResults.status}  (${jestResults.totalPassed}/${jestResults.totalTests} passed)`);

  // Load experiment results
  console.log("\nLoading experiment results...");
  const blockchain   = loadJson(RESULT_PATHS.blockchain,       "blockchain_latency");
  const download     = loadJson(RESULT_PATHS.download,         "download_latency");
  const wmRobust     = loadJson(RESULT_PATHS.watermarkRobust,  "watermark_robustness");
  const fastqImpact  = loadJson(RESULT_PATHS.fastqImpact,      "fastq_downstream_impact");
  const azureIpfs    = loadJson(RESULT_PATHS.azureIpfsCompare, "azure_ipfs_comparison");

  // ── Assemble report ────────────────────────────────────────────────────────
  const report = {
    project:    MANIFEST.project,
    version:    MANIFEST.version,
    generatedAt: new Date().toISOString(),
    description: MANIFEST.description,

    // ─ Unit tests ──────────────────────────────────────────────────────────
    unitTests: jestResults,

    // ─ Experimental results ────────────────────────────────────────────────
    experiments: {

      // R2.3 — Blockchain state latency
      blockchainLatency: blockchain ? {
        reviewerItem:   "R2.3 — Blockchain state tracking and transaction latency",
        network:        blockchain.network,
        registerFile: {
          nRuns:  blockchain.registerFile?.stats?.n,
          meanMs: blockchain.registerFile?.stats?.mean,
          medianMs: blockchain.registerFile?.stats?.median,
          sdMs:   blockchain.registerFile?.stats?.sd,
        },
        verifyHash: {
          nRuns:  blockchain.verifyHash?.stats?.n,
          meanMs: blockchain.verifyHash?.stats?.mean,
          medianMs: blockchain.verifyHash?.stats?.median,
          sdMs:   blockchain.verifyHash?.stats?.sd,
        },
      } : { reviewerItem: "R2.3", status: "NOT_RUN" },

      // R3.2 — AES V1 vs V2 overhead
      encryptionOverhead: download ? {
        reviewerItem: "R3.2 — Encrypt-then-MAC (AES-CBC + HMAC) overhead",
        note: "Overhead = V2 mean - V1 mean. Acceptability: < 5 ms for 100 KB.",
        sizes: Object.entries(download.stages ?? {}).map(([sizeLabel, data]) => ({
          sizeLabel,
          fileSizeBytes: data.fileSizeBytes,
          aesV1_encryptMean: data.aesV1?.encrypt?.mean,
          aesV2_encryptMean: data.aesV2?.encrypt?.mean,
          overheadMs:        data.overhead?.encryptMs,
          acceptable:        data.overhead?.encryptMs < 5,
        })),
      } : { reviewerItem: "R3.2", status: "NOT_RUN" },

      // R3.5 — Watermark robustness
      watermarkRobustness: wmRobust ? {
        reviewerItem: "R3.5 — Watermark detection robustness under perturbation",
        nRuns:        wmRobust.nRuns,
        perturbations: (wmRobust.perturbations ?? []).map(p => ({
          label:          p.label,
          detectionRate:  p.detectionRate,
          meanMatchScore: p.matchScoreStats?.mean ?? null,
        })),
      } : { reviewerItem: "R3.5", status: "NOT_RUN" },

      // R3.5 — FASTQ downstream impact
      fastqDownstreamImpact: fastqImpact ? {
        reviewerItem: "R3.5 — Watermark downstream impact on FASTQ quality metrics",
        nRuns:        fastqImpact.nRuns,
        meanQualityDelta: fastqImpact.metrics?.meanQualityDiff?.stats?.mean,
        q30RateDelta:     fastqImpact.metrics?.q30RateDiff?.stats?.mean,
        withinThreshold:  fastqImpact.metrics?.meanQualityDiff?.withinLimit &&
                           fastqImpact.metrics?.q30RateDiff?.withinLimit,
        conclusion:       fastqImpact.conclusion,
      } : { reviewerItem: "R3.5 downstream", status: "NOT_RUN" },

      // R2.4 — Azure vs Filebase retrieval
      storageComparison: azureIpfs ? {
        reviewerItem: "R2.4 — Azure primary vs Filebase backup byte comparison",
        azureMeanMs:    azureIpfs.azure?.stats?.mean   ?? null,
        filebaseMeanMs: azureIpfs.filebase?.stats?.mean ?? null,
        hashIntegrityPassed: azureIpfs.hashIntegrity?.allMatched ?? null,
      } : { reviewerItem: "R2.4", status: "NOT_RUN" },
    },

    // ─ Overall summary ────────────────────────────────────────────────────
    summary: {
      unitTestsPass:  jestResults.status === "PASS",
      totalTests:     jestResults.totalTests,
      totalPassed:    jestResults.totalPassed,
      totalFailed:    jestResults.totalFailed,
      experimentsRun: [blockchain, download, wmRobust, fastqImpact, azureIpfs].filter(Boolean).length,
      experimentsMissing: [blockchain, download, wmRobust, fastqImpact, azureIpfs].filter(x => !x).length,
    },

    notes: [
      "Unit tests address reviewer items R3.1, R3.2, R3.4, R3.5.",
      "Experiment results address reviewer items R2.3, R2.4, R3.2, R3.5.",
      "All experiments use synthetic data — no real patient data involved.",
      "N_RUNS ≥ 3 for all timed experiments (reviewer requirement).",
    ],
  };

  // Write report
  const outPath = RESULT_PATHS.testReport;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\nReport written: ${outPath}`);
  console.log("\n--- Final Summary ---");
  console.log(`  Unit tests:   ${report.summary.unitTestsPass ? "PASS ✓" : "FAIL ✗"} (${report.summary.totalPassed}/${report.summary.totalTests})`);
  console.log(`  Experiments:  ${report.summary.experimentsRun} run, ${report.summary.experimentsMissing} missing`);
  console.log("=== Test report generation complete ===");
}

main();
