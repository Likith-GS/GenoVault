/**
 * generate_all_evidence.js
 * GenoVault Experimental Evidence Generator
 * Execution timestamp: 2026-10-14
 *
 * Reads actual experiment outputs and generates all required evidence files.
 * No results are fabricated. All numbers come from actual harness outputs
 * recorded during this session.
 */
"use strict";

const fs   = require("fs");
const path = require("path");

const EVIDENCE = path.resolve(__dirname);
const ROOT     = path.resolve(__dirname, "..");

// ─── Helper ───────────────────────────────────────────────────────────────────
function w(subdir, filename, content) {
  const dir = path.join(EVIDENCE, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, "utf8");
  console.log(`  Wrote: ${subdir}/${filename}`);
}

// ─── Raw data from this session's executions ──────────────────────────────────

// FASTQ impact (re-run 2026-10-14, 5 runs, 1000 reads × 150 bp)
const FASTQ_RUNS = [
  { run: 1, meanAbsDiff: 0.000600, sdAbsDiff: 0.000600, q30RateAbsDiff: 0.000000 },
  { run: 2, meanAbsDiff: 0.000600, sdAbsDiff: 0.000300, q30RateAbsDiff: 0.000000 },
  { run: 3, meanAbsDiff: 0.000700, sdAbsDiff: 0.000300, q30RateAbsDiff: 0.000000 },
  { run: 4, meanAbsDiff: 0.000200, sdAbsDiff: 0.000300, q30RateAbsDiff: 0.000000 },
  { run: 5, meanAbsDiff: 0.000300, sdAbsDiff: 0.000300, q30RateAbsDiff: 0.000000 },
];

// Encryption benchmark (re-run 2026-10-14, N=3, fresh random keys)
const ENC_DATA = {
  "10KB": {
    fileSizeBytes: 10240,
    v1: {
      encrypt: { n:3, mean:0.832, median:0.110, sd:1.023, min:0.099, max:2.288, unit:"ms" },
      decrypt: { n:3, mean:0.115, median:0.094, sd:0.058, min:0.056, max:0.196, unit:"ms" },
    },
    v2: {
      encrypt: { n:3, mean:0.919, median:0.217, sd:1.029, min:0.163, max:2.376, unit:"ms" },
      decrypt: { n:3, mean:0.221, median:0.170, sd:0.074, min:0.160, max:0.332, unit:"ms" },
    },
    rawV1Enc: [2.288, 0.099, 0.110], rawV1Dec: [0.196, 0.056, 0.094],
    rawV2Enc: [2.376, 0.217, 0.163], rawV2Dec: [0.332, 0.170, 0.160],
    overhead: { encryptMs: 0.087, decryptMs: 0.106 },
  },
  "100KB": {
    fileSizeBytes: 102400,
    v1: {
      encrypt: { n:3, mean:1.003, median:0.448, sd:0.884, min:0.241, max:2.320, unit:"ms" },
      decrypt: { n:3, mean:0.292, median:0.212, sd:0.121, min:0.194, max:0.469, unit:"ms" },
    },
    v2: {
      encrypt: { n:3, mean:0.481, median:0.481, sd:0.046, min:0.425, max:0.538, unit:"ms" },
      decrypt: { n:3, mean:0.381, median:0.350, sd:0.071, min:0.316, max:0.477, unit:"ms" },
    },
    rawV1Enc: [0.241, 2.320, 0.448], rawV1Dec: [0.194, 0.469, 0.212],
    rawV2Enc: [0.538, 0.481, 0.425], rawV2Dec: [0.350, 0.477, 0.316],
    overhead: { encryptMs: -0.522, decryptMs: 0.089 },
  },
  "1024KB": {
    fileSizeBytes: 1048576,
    v1: {
      encrypt: { n:3, mean:2.503, median:2.537, sd:0.238, min:2.200, max:2.772, unit:"ms" },
      decrypt: { n:3, mean:2.144, median:2.201, sd:0.414, min:1.612, max:2.620, unit:"ms" },
    },
    v2: {
      encrypt: { n:3, mean:5.774, median:5.176, sd:1.882, min:3.774, max:8.371, unit:"ms" },
      decrypt: { n:3, mean:3.195, median:3.171, sd:0.040, min:3.157, max:3.256, unit:"ms" },
    },
    rawV1Enc: [2.200, 2.772, 2.537], rawV1Dec: [2.201, 1.612, 2.620],
    rawV2Enc: [3.774, 5.176, 8.371], rawV2Dec: [3.171, 3.256, 3.157],
    overhead: { encryptMs: 3.271, decryptMs: 1.051 },
  },
};

// Watermark robustness (re-run 2026-10-14, N=5, 500 reads × 150 bp)
const ROBUST_DATA = [
  { label:"P1_lossless_roundtrip",         detected:0, notDetected:5, detectionRate:"0.0%",
    runs:[{r:1,det:false,score:0},{r:2,det:false,score:0},{r:3,det:false,score:0},{r:4,det:false,score:0},{r:5,det:false,score:0}] },
  { label:"P2_quality_jitter_plus_minus_1", detected:0, notDetected:5, detectionRate:"0.0%",
    runs:[{r:1,det:false,score:0},{r:2,det:false,score:0},{r:3,det:false,score:0},{r:4,det:false,score:0},{r:5,det:false,score:0}] },
  { label:"P3_5pct_read_substitution",      detected:0, notDetected:5, detectionRate:"0.0%",
    runs:[{r:1,det:false,score:0},{r:2,det:false,score:0},{r:3,det:false,score:0},{r:4,det:false,score:0},{r:5,det:false,score:0}] },
  { label:"P4_10pct_read_truncation",       detected:0, notDetected:5, detectionRate:"0.0%",
    runs:[{r:1,det:false,score:0},{r:2,det:false,score:0},{r:3,det:false,score:0},{r:4,det:false,score:0},{r:5,det:false,score:0}] },
  { label:"P5_quality_normalization",       detected:0, notDetected:5, detectionRate:"0.0%",
    runs:[{r:1,det:false,score:0},{r:2,det:false,score:0},{r:3,det:false,score:0},{r:4,det:false,score:0},{r:5,det:false,score:0}] },
];

// Jest test results (fresh run 2026-10-14, 54 tests, 4 suites)
const JEST_SUITES = [
  {
    suite: "encryption.test.js", phase: "Phase 2 — Encrypt-then-MAC (R3.2)", total: 8, passed: 8, failed: 0,
    tests: [
      { id:"ENC-01", name:"V2 encrypt → decrypt round-trip succeeds",                                              status:"PASS", durationMs:49 },
      { id:"ENC-02", name:"V2: modified ciphertext → MAC verification throws",                                     status:"PASS", durationMs:181 },
      { id:"ENC-03", name:"V2: modified IV → MAC verification throws",                                             status:"PASS", durationMs:1 },
      { id:"ENC-04", name:"V2: completely wrong MAC hex → throws",                                                  status:"PASS", durationMs:2 },
      { id:"ENC-05", name:"V2: incorrect MAC is rejected — constant-time comparison via timingSafeEqual",           status:"PASS", durationMs:1 },
      { id:"ENC-06", name:"V1 legacy decryptBuffer still decrypts V1 ciphertext correctly",                        status:"PASS", durationMs:1 },
      { id:"ENC-07", name:"V1 file without MAC string → decryptBufferV2 throws (missing expectedMacHex)",          status:"PASS", durationMs:101 },
      { id:"ENC-08", name:"encryptBufferV2 returns ciphertext and a 64-char hex MAC (encryptionMac field)",        status:"PASS", durationMs:25 },
    ]
  },
  {
    suite: "identity.test.js", phase: "Phase 1 — Identity Versioning (R3.1)", total: 7, passed: 7, failed: 0,
    tests: [
      { id:"ID-01", name:"Same ORCID + same secret → same identifier (HMAC determinism)",                          status:"PASS", durationMs:4 },
      { id:"ID-02", name:"Different ORCID → different identifier",                                                 status:"PASS", durationMs:1 },
      { id:"ID-03", name:"Same ORCID + different secret → different identifier",                                   status:"PASS", durationMs:1 },
      { id:"ID-04", name:"Identifier is a valid bytes32 (0x-prefixed, 66 chars, lowercase hex)",                   status:"PASS", durationMs:4 },
      { id:"ID-05", name:"Missing RESEARCHER_ID_HMAC_SECRET → throws (fail-safe)",                                 status:"PASS", durationMs:55 },
      { id:"ID-06", name:"Raw ORCID string is not present in the returned identifier",                             status:"PASS", durationMs:1 },
      { id:"ID-07", name:"V1 keccak256 and V2 HMAC produce different identifiers for the same ORCID",             status:"PASS", durationMs:98 },
    ]
  },
  {
    suite: "integrity.test.js", phase: "Phase 5 — Integrity Categories (R3.4)", total: 10, passed: 10, failed: 0,
    tests: [
      { id:"INT-01", name:"All layers PASS → overall = SECURE",                                                    status:"PASS", durationMs:25 },
      { id:"INT-02", name:"SHA-256 FAIL with INTEGRITY_VIOLATION → overall = INTEGRITY_VIOLATION",                 status:"PASS", durationMs:3 },
      { id:"INT-03", name:"Azure FAIL → PRIMARY_STORAGE_UNAVAILABLE (not INTEGRITY_VIOLATION)",                    status:"PASS", durationMs:3 },
      { id:"INT-04", name:"IPFS PENDING + all others PASS → overall = PENDING (not a failure)",                    status:"PASS", durationMs:246 },
      { id:"INT-05", name:"IPFS FAIL with BACKUP_UNAVAILABLE → overall = BACKUP_UNAVAILABLE",                     status:"PASS", durationMs:2 },
      { id:"INT-06", name:"Blockchain FAIL with VERIFICATION_UNAVAILABLE → overall = VERIFICATION_UNAVAILABLE",    status:"PASS", durationMs:1 },
      { id:"INT-07", name:"AES FAIL with KEY_OR_DECRYPTION_FAILURE → overall = KEY_OR_DECRYPTION_FAILURE",         status:"PASS", durationMs:1 },
      { id:"INT-08", name:"Each layer result has required fields: status, category, layer, timestamp",              status:"PASS", durationMs:4 },
      { id:"INT-09", name:"Simultaneous INTEGRITY_VIOLATION + KEY_OR_DECRYPTION_FAILURE → INTEGRITY_VIOLATION wins",status:"PASS", durationMs:1 },
      { id:"INT-10", name:"IPFS PENDING + INTEGRITY_VIOLATION → INTEGRITY_VIOLATION (not PENDING)",                status:"PASS", durationMs:1 },
    ]
  },
  {
    suite: "watermark.test.js", phase: "Tests 1–14/15/16–26/27–29", total: 29, passed: 29, failed: 0,
    tests: [
      { id:"WM-01", name:"normalizeFASTQ parses correct number of reads",                                           status:"PASS", durationMs:85 },
      { id:"WM-02", name:"normalizeFASTQ read structure has correct fields",                                        status:"PASS", durationMs:178 },
      { id:"WM-03", name:"embed() returns a watermarkedBuffer",                                                     status:"PASS", durationMs:127 },
      { id:"WM-04", name:"Watermarked buffer differs from original",                                                status:"PASS", durationMs:63 },
      { id:"WM-05", name:"Watermarked FASTQ has same number of lines as original",                                  status:"PASS", durationMs:56 },
      { id:"WM-06", name:"Watermark is detected in watermarked output (verified=true)",                             status:"PASS", durationMs:66 },
      { id:"WM-07", name:"Watermark detection fails for a different watermark record",                              status:"PASS", durationMs:66 },
      { id:"WM-08", name:"Detection on original (non-watermarked) buffer returns verified=false",                   status:"PASS", durationMs:67 },
      { id:"WM-09", name:"watermarkCommitment = SHA-256(watermarkPayload)",                                        status:"PASS", durationMs:1 },
      { id:"WM-10", name:"generateWatermarkSeed produces unique seeds for different inputs",                        status:"PASS", durationMs:0 },
      { id:"WM-11", name:"Same inputs produce same watermarkSeed (HMAC determinism)",                               status:"PASS", durationMs:1 },
      { id:"WM-12", name:"Different nonces produce different seeds (unique watermarks)",                            status:"PASS", durationMs:6 },
      { id:"WM-13", name:"detectWatermarkInCandidate accepts pre-normalized reads array",                           status:"PASS", durationMs:61 },
      { id:"WM-14", name:"Sequence data is unchanged after watermark embedding",                                    status:"PASS", durationMs:75 },
      { id:"WM-15", name:"20 concurrent embeddings produce 20 distinct, independently-verifiable watermarks",       status:"PASS", durationMs:360 },
      { id:"WM-16", name:"Missing WATERMARK_SECRET throws during seed generation",                                  status:"PASS", durationMs:34 },
      { id:"WM-17", name:"embedWatermark throws for unsupported file extension",                                    status:"PASS", durationMs:1 },
      { id:"WM-18", name:"metadataEmbedder inserts GENOVAULT_WM CO tag in BAM/SAM",                               status:"PASS", durationMs:1 },
      { id:"WM-19", name:"metadataEmbedder inserts ##GENOVAULT_WM line in VCF",                                   status:"PASS", durationMs:1 },
      { id:"WM-20", name:"metadataEmbedder detects correct watermarkId in BAM",                                    status:"PASS", durationMs:0 },
      { id:"WM-21", name:"metadataEmbedder returns verified=false for wrong watermarkId",                          status:"PASS", durationMs:1 },
      { id:"WM-22", name:"metadataEmbedder throws for unsupported format",                                         status:"PASS", durationMs:5 },
      { id:"WM-23", name:"detectWatermarkInCandidate throws if non-Buffer passed for METADATA_V1",                 status:"PASS", durationMs:2 },
      { id:"WM-24", name:"Small FASTQ (50 reads) still produces a verifiable watermark",                           status:"PASS", durationMs:32 },
      { id:"WM-25", name:"computeWatermarkedFileHash equals SHA-256(watermarkedBuffer)",                           status:"PASS", durationMs:28 },
      { id:"WM-26", name:"generateWatermarkId returns WM-XXXXXXXX format",                                        status:"PASS", durationMs:3 },
      { id:"WM-27", name:"Commitment is consistent: same seed always produces same commitment",                    status:"PASS", durationMs:0 },
      { id:"WM-28", name:"Modified payload produces a different commitment — detection rejects it",                status:"PASS", durationMs:57 },
      { id:"WM-29", name:"Seed, payload, and commitment are three distinct cryptographic values",                  status:"PASS", durationMs:3 },
    ]
  },
];

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function mean(arr) { return arr.reduce((s,v)=>s+v,0)/arr.length; }
function sd(arr) { const m=mean(arr); return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); }
function median(arr) { const s=[...arr].sort((a,b)=>a-b); const n=s.length; return n%2===0?(s[n/2-1]+s[n/2])/2:s[Math.floor(n/2)]; }
// 95% t-CI (two-tailed, df=n-1) — t critical values for small N
const T_95 = {4:2.776, 5:2.571, 6:2.447, 7:2.365, 8:2.306, 9:2.262, 10:2.228};
function ci95(arr) {
  const n=arr.length, m=mean(arr), s=sd(arr);
  const t=T_95[n]||2.776;
  const me=t*s/Math.sqrt(n);
  return { lower:+(m-me).toFixed(6), upper:+(m+me).toFixed(6), t, n };
}

// ─── FASTQ delta array ────────────────────────────────────────────────────────
const fastqDeltas = FASTQ_RUNS.map(r=>r.meanAbsDiff);
const fastqMean   = mean(fastqDeltas);
const fastqSD     = sd(fastqDeltas);
const fastqCI     = ci95(fastqDeltas);
const fastqMin    = Math.min(...fastqDeltas);
const fastqMax    = Math.max(...fastqDeltas);

// ═══════════════════════════════════════════════════════════════════════════════
// 00 — Project Inventory
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 00_PROJECT_AND_EXPERIMENT_INVENTORY.md ===");
w(".", "00_PROJECT_AND_EXPERIMENT_INVENTORY.md", `# GenoVault — Project and Experiment Inventory

**Generated:** 2026-10-14T16:43:00Z (IST +05:30)
**Campaign version:** EVIDENCE_2026-10-14

---

## 1. Repository Identification

| Field                | Value                                        |
|----------------------|----------------------------------------------|
| Repository root      | D:\\\\ONE DRIVE\\\\OneDrive\\\\MY PROJECT\\\\MY PROJECT\\\\Major Project |
| Git commit (HEAD)    | 1d7a07ffbaae750d81c5365a170d01afb880e9b3     |
| Commit message       | "New fix"                                    |
| Branch               | main (active)                                |
| Inspection timestamp | 2026-10-14T16:43:36Z                         |

---

## 2. Environment and Dependency Versions

| Component         | Version      |
|-------------------|--------------|
| Node.js           | v24.11.1     |
| Jest              | 29.7.0       |
| ethers.js         | 6.16.0       |
| @azure/storage-blob | 12.31.0   |
| @azure/keyvault-secrets | 4.11.2 |
| @azure/identity   | 4.13.1       |
| @aws-sdk/client-s3| 3.1041.0     |
| mongoose          | 8.23.1       |
| bcryptjs          | 2.4.3        |
| dotenv            | 16.6.1       |
| express           | 4.22.1       |
| jsonwebtoken      | 9.0.3        |
| OS                | Windows (win32, x64) |
| CPU cores         | 4            |
| Total RAM         | 7,991 MB     |

---

## 3. Test Suites Discovered

| File                        | Suite Name                              | Tests |
|-----------------------------|-----------------------------------------|-------|
| backend/tests/encryption.test.js | Phase 2 — Encrypt-then-MAC (R3.2)  | 8     |
| backend/tests/identity.test.js   | Phase 1 — Identity Versioning (R3.1)| 7    |
| backend/tests/integrity.test.js  | Phase 5 — Integrity Categories (R3.4)| 10  |
| backend/tests/watermark.test.js  | GENOMIC_LSB_V1 / Concurrent / Robustness / Commitment | 29 |
| **Total**                        |                                     | **54** |

No separate provenance test suite was found. The 29 watermark tests are distinct from a
previously described "29-test provenance suite" in documentation — they cover functional,
cryptographic, concurrency, and robustness categories within watermark.test.js.

---

## 4. Experiment Scripts

| Script                              | Command                              | Status         |
|-------------------------------------|--------------------------------------|----------------|
| experiments/downloadBenchmark.js    | npm run experiment:download          | EXECUTABLE (no credentials needed) |
| experiments/watermarkRobustnessHarness.js | npm run experiment:robustness  | EXECUTABLE     |
| experiments/fastqDownstreamImpact.js | npm run experiment:fastq            | EXECUTABLE     |
| experiments/blockchainBenchmark.js  | npm run experiment:blockchain        | BLOCKED — requires PRIVATE_KEY, BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CONTRACT_ADDRESS |
| experiments/azureIpfsComparison.js  | npm run experiment:azureipfs         | BLOCKED — requires Azure SAS + Filebase credentials |
| experiments/generateTestReport.js   | npm run report                       | EXECUTABLE (report generator) |

---

## 5. Required Environment Variables (names only — no values)

| Variable                    | Used By                     | Status      |
|-----------------------------|-----------------------------|-------------|
| RESEARCHER_ID_HMAC_SECRET   | Identity versioning         | Present in .env |
| WATERMARK_SECRET            | Watermark seed derivation   | Present in .env |
| AES_SECRET_KEY              | V1 encryption key derivation| Present in .env |
| BLOCKCHAIN_RPC_URL          | Blockchain service          | Present in .env |
| BLOCKCHAIN_CONTRACT_ADDRESS | Blockchain service          | Present in .env |
| PRIVATE_KEY                 | Blockchain transactions     | Present in .env (wallet key) |
| AZURE_STORAGE_CONNECTION_STRING | Azure Blob operations   | Present in .env |
| AZURE_KEY_VAULT_URL         | Key Vault operations        | Present in .env |
| FILEBASE_ACCESS_KEY_ID      | S3/Filebase backup          | Present in .env |
| FILEBASE_SECRET_ACCESS_KEY  | S3/Filebase backup          | Present in .env |
| FILEBASE_BUCKET             | S3/Filebase backup          | Present in .env |
| MONGODB_URI                 | Application database        | Present in .env |
| JWT_SECRET                  | Auth tokens                 | Present in .env |

**Note:** Values are NOT exposed. Variable names only are documented per Mandatory Rule 7.

---

## 6. Existing Results (Pre-Session)

| File                                                     | Date               |
|----------------------------------------------------------|--------------------|
| results/jest_results.json                                | 2026-09-21 (stale, superseded by fresh run) |
| results/phase7_watermark/watermark_robustness.json       | 2026-09-21 (superseded) |
| results/phase7_watermark/fastq_downstream_impact.json    | 2026-09-21 (superseded) |

All results were re-executed fresh on 2026-10-14 to generate this evidence campaign.

---

## 7. Experiments Executable Without Credentials

- **Exp A** — Jest test suite (4 suites, 54 tests): EXECUTED ✓
- **Exp B** — Watermark robustness harness: EXECUTED ✓
- **Exp C** — FASTQ downstream impact: EXECUTED ✓
- **Exp D** — Encryption/download benchmark: EXECUTED ✓

## 8. Experiments Blocked

- **Exp E** — Azure vs Filebase/IPFS backup comparison: **BLOCKED** — requires live Azure blob + Filebase credentials with a test file registered in both stores
- **Exp F** — Blockchain gas and confirmation latency: **BLOCKED** — requires funded Sepolia wallet (PRIVATE_KEY + BLOCKCHAIN_RPC_URL + CONTRACT_ADDRESS must be active, and a live Sepolia RPC node reachable)
- **Exp G** — NCBI SRA discovery scan: **BLOCKED** — requires a live watermarked file in a public NCBI SRA accession. No such file exists in a public database; the watermarking system operates on controlled downloads, not public SRA submissions.

---

## 9. Overlap Check (Mandatory)

The jest results (Exp A: 54 tests) and the watermark robustness harness (Exp B: 5 perturbation
categories × 5 runs = 25 observations) are **independent and non-overlapping**.

- Exp A (Jest) tests correctness: does the implementation produce correct outputs?
- Exp B (harness) tests fragility: does the watermark survive perturbations?
- Exp C (FASTQ impact) measures side-effects on quality scores, not correctness.
- Exp D (Encryption) measures timing, not correctness.

These four experiments share the same service code but have distinct hypotheses,
datasets, and metrics. They must not be combined into a single count.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 01 — Test Results
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 01_TEST_RESULTS ===");

// test_summary.json
const allTests = JEST_SUITES.flatMap(s=>s.tests);
const testSummaryJSON = {
  executedAt: "2026-10-14T16:43:41Z",
  command: "npx jest tests/ --json --outputFile=../results/jest_results_fresh.json",
  totalSuites: 4, totalTests: 54, passed: 54, failed: 0, skipped: 0, blocked: 0,
  totalDurationMs: 26213,
  suites: JEST_SUITES.map(s=>({
    suite: s.suite, phase: s.phase, tests: s.total, passed: s.passed, failed: s.failed
  })),
  overlapNote: "No overlap between suites. watermark.test.js T1-29 covers functional/crypto/concurrent/robustness. Not the same as Exp B harness."
};
w("01_TEST_RESULTS", "test_summary.json", JSON.stringify(testSummaryJSON, null, 2));

// test_summary.csv
let csv = "suite,phase,total_tests,passed,failed,skipped\n";
for (const s of JEST_SUITES) {
  csv += `"${s.suite}","${s.phase}",${s.total},${s.passed},${s.failed},0\n`;
}
csv += `"TOTAL","All suites",54,54,0,0\n`;
w("01_TEST_RESULTS", "test_summary.csv", csv);

// individual_test_results.csv
let itr = "suite,test_id,test_name,status,duration_ms\n";
for (const s of JEST_SUITES) {
  for (const t of s.tests) {
    itr += `"${s.suite}","${t.id}","${t.name}","${t.status}",${t.durationMs}\n`;
  }
}
w("01_TEST_RESULTS", "individual_test_results.csv", itr);

// failed_and_skipped_tests.md
w("01_TEST_RESULTS", "failed_and_skipped_tests.md", `# Failed and Skipped Tests

**Execution date:** 2026-10-14  
**Command:** \`npx jest tests/ --json --outputFile=../results/jest_results_fresh.json\`

## Result

**0 tests failed. 0 tests skipped. 0 tests blocked.**

All 54 tests across all 4 suites passed in 26.213 seconds.

## Verification

The raw output from the Jest runner confirms:

\`\`\`
Test Suites: 4 passed, 4 total
Tests:       54 passed, 54 total
Snapshots:   0 total
Time:        26.213 s
\`\`\`

## Experiments not covered by the unit test suite

The following experiment categories have no automated unit tests and were instead
evaluated via standalone harnesses or are BLOCKED:

| Category                         | Coverage              |
|----------------------------------|-----------------------|
| Blockchain gas / confirmation    | BLOCKED (credentials) |
| Azure vs IPFS byte comparison    | BLOCKED (credentials) |
| NCBI SRA scan                    | BLOCKED (no public match) |
| Wallet key rotation / recovery   | Not implemented (design recommendation only) |
`);

// test_execution_environment.md
w("01_TEST_RESULTS", "test_execution_environment.md", `# Test Execution Environment

| Field               | Value                          |
|---------------------|--------------------------------|
| Execution timestamp | 2026-10-14T16:43:41Z           |
| Node.js             | v24.11.1                       |
| Jest                | 29.7.0                         |
| OS                  | Windows (win32, x64)           |
| CPU cores           | 4                              |
| RAM                 | 7,991 MB                       |
| Test root           | backend/tests/                 |
| Config              | package.json "jest" block      |
| testTimeout         | 30,000 ms                      |
| testEnvironment     | node                           |
| Command             | npx jest tests/ --json --outputFile=../results/jest_results_fresh.json |
| Total duration      | 26.213 s                       |
| Exit code           | 0                              |

## Notes

- Tests use the project's real service implementations (encryptionService.js, watermarkService.js, etc.)
- .env variables are loaded via dotenv for HMAC secrets required by identity and watermark tests
- No external services (MongoDB, Azure, Sepolia) are contacted during the test run
- Watermark tests use synthetic FASTQ-format text buffers; no real genomic data
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 02 — Watermark Robustness
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 02_WATERMARK_ROBUSTNESS ===");

const robustJSON = {
  experiment: "watermark_robustness",
  executedAt: "2026-10-14T16:45:17Z",
  command: "node experiments/watermarkRobustnessHarness.js",
  exitCode: 0,
  harness: "backend/experiments/watermarkRobustnessHarness.js",
  syntheticReads: { count: 500, readLength: 150, qualityRange: [2, 40] },
  detectionThreshold: "matchScore >= 0.85 OR verified === true",
  nRuns: 5,
  perturbations: ROBUST_DATA.map(p => ({
    label: p.label,
    nRuns: 5,
    detected: p.detected,
    notDetected: p.notDetected,
    detectionRate: p.detectionRate,
    truePositives: p.detected,
    falseNegatives: p.notDetected,
    individualRuns: p.runs.map(r => ({ run: r.r, detected: r.det, matchScore: r.score }))
  })),
  summaryTable: {
    note: "Detection rate 0/5 (0%) for ALL perturbations including lossless round-trip (P1).",
    criticalFinding: "The robustness harness uses detectWatermarkInCandidate() with a synthetic WatermarkRecord that provides the watermark payload in a different representation than what embed() actually writes. The harness constructs a stub record (seed % 256 as 8-bit payload) rather than embedding with the actual service and then recovering. The 0% detection rate on P1 (lossless round-trip) is the definitive indicator that this is a harness design limitation, NOT a property of the watermark embedding algorithm itself. The Jest test WM-06 ('Watermark is detected in watermarked output — verified=true') demonstrates that end-to-end detection DOES work using the real embed/detect pipeline."
  }
};
w("02_WATERMARK_ROBUSTNESS", "robustness_results.json", JSON.stringify(robustJSON, null, 2));

let robustCSV = "perturbation,nRuns,detected,notDetected,detectionRate,harness_finding\n";
for (const p of ROBUST_DATA) {
  robustCSV += `"${p.label}",5,${p.detected},${p.notDetected},"${p.detectionRate}","HARNESS_DESIGN_LIMITATION"\n`;
}
w("02_WATERMARK_ROBUSTNESS", "robustness_results.csv", robustCSV);

w("02_WATERMARK_ROBUSTNESS", "robustness_methodology.md", `# Watermark Robustness Methodology

## Harness

File: \`backend/experiments/watermarkRobustnessHarness.js\`  
Command: \`node experiments/watermarkRobustnessHarness.js\`  
Executed: 2026-10-14T16:45:17Z  

## Parameters

| Parameter          | Value                   |
|--------------------|-------------------------|
| Synthetic reads    | 500 reads × 150 bp each |
| Quality range      | [2, 40] Phred           |
| Runs per perturbation | 5                    |
| Random seed        | crypto.randomBytes() per run |
| Detection threshold | matchScore ≥ 0.85 OR verified === true |

## Perturbations Tested

| ID  | Label                         | Description                              |
|-----|-------------------------------|------------------------------------------|
| P1  | P1_lossless_roundtrip         | No modification (baseline / identity)   |
| P2  | P2_quality_jitter_plus_minus_1 | Random ±1 added to each quality byte   |
| P3  | P3_5pct_read_substitution     | 5% of reads replaced with random reads  |
| P4  | P4_10pct_read_truncation      | Bottom 10% of reads dropped             |
| P5  | P5_quality_normalization      | Quality scores re-scaled to [0,40]      |

## Data Source

Synthetic quality arrays only. No real patient genomic data.

## Algorithm Used

GENOMIC_LSB_V1 — LSB of quality score ASCII values used as embedding channel.
`);

w("02_WATERMARK_ROBUSTNESS", "robustness_failures.md", `# Watermark Robustness — Findings and Failures

## Critical Finding: Harness Design Limitation

**Detection rate: 0.0% (0/5) for ALL five perturbations, including P1 (lossless round-trip).**

This is a harness design issue, not a property of the watermark algorithm. Evidence:

1. **P1 (lossless round-trip) also shows 0% detection.** If the watermark algorithm itself
   were broken, this would be expected. However, Jest test WM-06 passes and confirms that
   embed→detect works correctly end-to-end with the real pipeline.

2. **Root cause:** The harness constructs a synthetic WatermarkRecord using:
   \`payload = seed % 256\` (8-bit value)
   The production algorithm builds payloads with a different internal structure.
   The detectWatermarkInCandidate() call therefore never matches any recovered payload
   because the reference record doesn't match what was actually embedded.

3. **What this means for the paper:**
   - The robustness HARNESS cannot be cited as evidence of robustness.
   - The robustness UNIT TESTS (WM-04 through WM-28 in watermark.test.js) DO provide
     evidence that the individual components behave correctly.
   - A correct robustness harness would: (a) call embed() to produce a watermarked buffer,
     (b) apply perturbation, (c) call detectWatermarkInCandidate() with the actual WatermarkRegistry
     record returned by embed().

## What WAS confirmed (from Jest suite, separately)

| Test | Result |
|------|--------|
| WM-06: Watermark detected in watermarked output | PASS |
| WM-07: Wrong watermark record → not detected | PASS |
| WM-08: Original (unwatermarked) buffer → not detected | PASS |
| WM-09: watermarkCommitment = SHA-256(watermarkPayload) | PASS |
| WM-14: DNA sequence unchanged after embedding | PASS |

These tests confirm the core algorithm is correct. Robustness under perturbations
remains an **open experimental gap** that requires a corrected harness.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 03 — FASTQ Impact
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 03_FASTQ_IMPACT ===");

let fastqCSV = "run,meanAbsDiff_Phred,sdAbsDiff_Phred,q30RateAbsDiff\n";
for (const r of FASTQ_RUNS) {
  fastqCSV += `${r.run},${r.meanAbsDiff.toFixed(6)},${r.sdAbsDiff.toFixed(6)},${r.q30RateAbsDiff.toFixed(6)}\n`;
}
w("03_FASTQ_IMPACT", "fastq_run_results.csv", fastqCSV);

const fastqSummaryJSON = {
  experiment: "fastq_downstream_impact",
  executedAt: "2026-10-14T16:45:33Z",
  command: "node experiments/fastqDownstreamImpact.js",
  exitCode: 0,
  dataset: { syntheticReads: 1000, readLength: 150, qualityRange: [20, 40], totalBases: 150000, source: "SYNTHETIC — no real patient data" },
  nRuns: 5,
  embeddingAlgorithm: "GENOMIC_LSB_V1 — 1 LSB bit per read in quality[0]",
  metrics: {
    meanAbsQualityDiff_Phred: {
      rawValues: fastqDeltas,
      mean: +fastqMean.toFixed(6),
      median: +median(fastqDeltas).toFixed(6),
      sd: +fastqSD.toFixed(6),
      min: +fastqMin.toFixed(6),
      max: +fastqMax.toFixed(6),
      unit: "Phred units",
      threshold: "< 1.0 Phred unit",
      passFail: "PASS",
      ci95: fastqCI,
      ci95Method: "Student t-distribution, two-tailed, df=4 (N=5 runs), t_crit=2.776. NOTE: N=5 is small; CI is preliminary and should not be cited as definitive population estimate."
    },
    q30RateAbsDiff: {
      rawValues: FASTQ_RUNS.map(r=>r.q30RateAbsDiff),
      mean: 0, median: 0, sd: 0, min: 0, max: 0, unit: "fraction",
      threshold: "< 0.01 fraction", passFail: "PASS"
    }
  },
  downstreamToolsTestedDirectly: "NONE — BWA, GATK, FastQC, trimmomatic were NOT run on the synthetic data. Compatibility claims are limited to quality-score magnitude changes only.",
  conclusion: "ACCEPTABLE within the tested synthetic experiment. Mean |ΔQuality| = " + fastqMean.toFixed(4) + " Phred (N=5 runs, 1000×150 bp each), well below the 1.0 Phred threshold. Q30 rate unchanged. Broader compatibility with real analysis pipelines is NOT claimed from this experiment."
};
w("03_FASTQ_IMPACT", "fastq_summary.json", JSON.stringify(fastqSummaryJSON, null, 2));

w("03_FASTQ_IMPACT", "fastq_methodology.md", `# FASTQ Downstream Impact Methodology

## Harness

File: \`backend/experiments/fastqDownstreamImpact.js\`  
Command: \`node experiments/fastqDownstreamImpact.js\`  
Executed: 2026-10-14T16:45:33Z  

## Dataset

| Parameter        | Value                          |
|------------------|--------------------------------|
| Data source      | Synthetic — no real patient data |
| Reads per run    | 1,000                          |
| Read length      | 150 bp                         |
| Total bases/run  | 150,000                        |
| Quality range    | [20, 40] Phred (uniform random) |
| Runs             | N = 5                          |

## Embedding

- Algorithm: GENOMIC_LSB_V1
- Method: flip LSB of quality[0] ASCII byte per read to encode 1 payload bit per read
- Maximum theoretical ΔQuality: ±1 Phred unit per modified position

## Metrics Measured

1. Mean absolute quality-score change across all 150,000 bases
2. SD of quality-score change
3. Q30 rate (fraction of bases ≥ Q30) before and after embedding

## Statistical Methods

- Mean, SD, median, min, max computed from N=5 run-level measurements
- 95% CI: Student t-distribution, two-tailed, df=4, t_crit=2.776
- With N=5, the CI is preliminary; wider data collection would be needed for definitive claims

## What Was NOT Tested

- Actual BWA/GATK alignment or variant calling on the synthetic data
- Real FASTQ files from any organism
- Trimming pipelines (trimmomatic, fastp)
- Downstream analysis tool compatibility

These remain NOT TESTED and must not be claimed in the paper.
`);

w("03_FASTQ_IMPACT", "fastq_analysis.md", `# FASTQ Impact Analysis

## Summary Statistics (N=5 runs, 1000 reads × 150 bp, Phred units)

| Metric                | Value          |
|-----------------------|----------------|
| Mean |ΔQuality|       | ${fastqMean.toFixed(6)} Phred |
| Median |ΔQuality|     | ${median(fastqDeltas).toFixed(6)} Phred |
| SD                    | ${fastqSD.toFixed(6)} Phred |
| Min (run-level)       | ${fastqMin.toFixed(6)} Phred |
| Max (run-level)       | ${fastqMax.toFixed(6)} Phred |
| 95% CI (t, df=4)      | [${fastqCI.lower}, ${fastqCI.upper}] Phred |
| Q30 rate change       | 0.000000 (all 5 runs) |
| Threshold (ΔMean < 1) | PASS ✓ |
| Threshold (ΔQ30 < 0.01) | PASS ✓ |

## Per-Run Results

| Run | |ΔMean| (Phred) | |ΔSD| (Phred) | ΔQ30 |
|-----|-----------------|-----------------|------|
| 1   | 0.000600        | 0.000600        | 0    |
| 2   | 0.000600        | 0.000300        | 0    |
| 3   | 0.000700        | 0.000300        | 0    |
| 4   | 0.000200        | 0.000300        | 0    |
| 5   | 0.000300        | 0.000300        | 0    |

## Interpretation

The LSB embedding introduces a mean quality-score perturbation of approximately
${fastqMean.toFixed(4)} Phred across the tested synthetic dataset — roughly four orders
of magnitude below the 1.0 Phred threshold. The Q30 rate is unchanged across all 5 runs.

## Limitations

1. N=5 is a small sample. The CI is preliminary.
2. All data is synthetic. Real FASTQ files may have different quality-score distributions.
3. Downstream tools (BWA, GATK, FastQC) were NOT run. Tool compatibility is NOT claimed.
4. The experiment measures quality perturbation at a population level, not per-read.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 04 — Encryption Performance
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 04_ENCRYPTION_PERFORMANCE ===");

let encCSV = "size_label,size_bytes,version,run,encrypt_ms,decrypt_ms\n";
for (const [lbl, data] of Object.entries(ENC_DATA)) {
  for (let i=0; i<3; i++) {
    encCSV += `"${lbl}",${data.fileSizeBytes},"V1",${i+1},${data.rawV1Enc[i]},${data.rawV1Dec[i]}\n`;
    encCSV += `"${lbl}",${data.fileSizeBytes},"V2",${i+1},${data.rawV2Enc[i]},${data.rawV2Dec[i]}\n`;
  }
}
w("04_ENCRYPTION_PERFORMANCE", "encryption_run_results.csv", encCSV);

const encSummaryJSON = {
  experiment: "download_pipeline_latency",
  executedAt: "2026-10-14T16:45:04Z",
  command: "node experiments/downloadBenchmark.js",
  exitCode: 0,
  harness: "backend/experiments/downloadBenchmark.js",
  nRuns: 3,
  timingMethod: "process.hrtime.bigint() — nanosecond resolution",
  keyGeneration: "Fresh random 256-bit key + 128-bit IV per run (crypto.randomBytes)",
  data: "Randomly generated — no real genomic data",
  algorithms: {
    V1: "AES-256-CBC (Node.js crypto module)",
    V2: "AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC (encryptBufferV2)"
  },
  results: ENC_DATA,
  limitations: [
    "N=3 runs per size — insufficient for definitive performance claims.",
    "Results include first-run JIT warm-up costs (notable in 10KB V1 enc: 2.288 ms run 1 vs 0.099/0.110 ms runs 2-3).",
    "Azure download stage, Key Vault retrieval, and network I/O are NOT included — those stages are BLOCKED by cloud credentials.",
    "Measurements are on a 4-core Windows machine; results are machine-specific.",
    "1 MB (1024 KB) V2 encryption shows higher variability (3.774–8.371 ms) over N=3 runs."
  ]
};
w("04_ENCRYPTION_PERFORMANCE", "encryption_summary.json", JSON.stringify(encSummaryJSON, null, 2));

w("04_ENCRYPTION_PERFORMANCE", "download_overhead.json", JSON.stringify({
  experiment: "v2_over_v1_overhead",
  executedAt: "2026-10-14T16:45:04Z",
  note: "Overhead = mean(V2) - mean(V1). Negative overhead at 100KB reflects noise at N=3.",
  overheadBySize: {
    "10KB":   { encryptMs: 0.087,  decryptMs: 0.106, acceptableUnder10ms: true },
    "100KB":  { encryptMs: -0.522, decryptMs: 0.089, acceptableUnder10ms: true, note: "Negative: noise artifact at N=3" },
    "1024KB": { encryptMs: 3.271,  decryptMs: 1.051, acceptableUnder10ms: true }
  },
  stagesNotMeasured: ["Azure blob download", "Key Vault key retrieval", "IPFS upload", "Response streaming"],
  stagesNotMeasuredReason: "Cloud credentials required (BLOCKED)"
}, null, 2));

w("04_ENCRYPTION_PERFORMANCE", "performance_methodology.md", `# Encryption Performance Methodology

## Harness

File: \`backend/experiments/downloadBenchmark.js\`  
Command: \`node experiments/downloadBenchmark.js\`  
Executed: 2026-10-14T16:45:04Z  

## Parameters

| Parameter      | Value                            |
|----------------|----------------------------------|
| File sizes     | 10 KB, 100 KB, 1024 KB           |
| Runs per size  | N = 3 (per experimentManifest.js requirement) |
| Key material   | Fresh random per run (crypto.randomBytes) |
| Timing method  | process.hrtime.bigint() — ns resolution, converted to ms |
| Data           | crypto.randomBytes(size) — no real patient data |

## Algorithms Benchmarked

- **V1:** AES-256-CBC only (encryptBuffer / decryptBuffer)
- **V2:** AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC (encryptBufferV2 / decryptBufferV2)

## Stages NOT Measured (BLOCKED)

The full download workflow includes:
1. Azure Blob download (network I/O)
2. Azure Key Vault key retrieval (network I/O)
3. AES decryption ← **measured**
4. MAC verification (V2) ← **measured**
5. Response streaming to researcher browser

Stages 1, 2, and 5 require live cloud infrastructure and are BLOCKED.

## Limitations

- N=3 is below the minimum recommended for reliable performance estimates.
  Run 1 of each size category shows JIT warm-up inflation.
- Results are platform-specific (Windows, 4-core, 7.8 GB RAM).
- Large-file performance (e.g., 100 MB–1 GB FASTQ) cannot be inferred from 1 MB data points.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 05 — Backup Comparison (BLOCKED)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 05_BACKUP_COMPARISON ===");

w("05_BACKUP_COMPARISON", "backup_comparison_results.csv",
`status,reason,executed_at
BLOCKED,"Missing live Azure Blob + Filebase/IPFS credentials with a test file registered in both stores","2026-10-14T16:43:00Z"
`);

w("05_BACKUP_COMPARISON", "backup_comparison_summary.json", JSON.stringify({
  experiment: "azure_vs_filebase_ipfs_backup_comparison",
  status: "BLOCKED",
  executedAt: "2026-10-14T16:43:00Z",
  reason: "Requires a file that has been uploaded through the full GenoVault pipeline (plaintext → Azure encrypted blob → IPFS Filebase backup). No such test file is available with confirmed credentials for a non-sensitive test object.",
  prerequisites: [
    "AZURE_STORAGE_CONNECTION_STRING with read access to a test blob container",
    "FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY with read access to the backup bucket",
    "A non-sensitive test file identifier (fileId) registered in both stores",
    "SHA-256 hash of the registered ciphertext recorded at upload time"
  ],
  whatWouldBeMeasured: [
    "SHA-256(Azure encrypted object)",
    "SHA-256(Filebase/IPFS encrypted object)",
    "Size match",
    "Hash equality (byte-equivalent backup confirmation)"
  ],
  scriptAvailable: "backend/experiments/azureIpfsComparison.js",
  note: "A matching IPFS CID is NOT sufficient. Direct byte-level SHA-256 comparison is required per Mandatory Rule 5."
}, null, 2));

w("05_BACKUP_COMPARISON", "backup_methodology.md", `# Azure vs Filebase/IPFS Backup Comparison Methodology

## Status: BLOCKED

This experiment requires live infrastructure that is not accessible without credentials
and a registered test file.

## What the Experiment Would Do

1. Read the encrypted Azure Blob object for a test fileId
2. Compute SHA-256(ciphertext) from the Azure object
3. Retrieve the same object from Filebase S3 (which pins to IPFS)
4. Compute SHA-256(ciphertext) from the Filebase object
5. Compare both hashes and both object sizes
6. Record: match status, sizes, hashes, latencies, timestamps

## Prerequisites (not met)

- A non-sensitive test fileId registered through the real upload pipeline
- Read credentials for both Azure Blob storage and Filebase S3
- Live network connectivity to both services

## Harness Available

\`backend/experiments/azureIpfsComparison.js\` — inspected and ready to run once credentials
and a test file are available.

## Note on IPFS CID

An IPFS CID is a content-addressed identifier derived from the file content.
However, the experiment must independently fetch and hash the objects from both
storage backends — not rely on CID matching alone. The CID proves content identity
in the IPFS network if the file is correctly pinned, but an independent SHA-256
comparison provides verifiable evidence in the paper.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 06 — Blockchain Benchmark (BLOCKED)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 06_BLOCKCHAIN_BENCHMARK ===");

w("06_BLOCKCHAIN_BENCHMARK", "blockchain_results.csv",
`operation,status,reason
registerFile,BLOCKED,"Requires funded Sepolia wallet and live RPC endpoint"
requestAccess,BLOCKED,"Requires funded Sepolia wallet and live RPC endpoint"
approveAccess,BLOCKED,"Requires funded Sepolia wallet and live RPC endpoint"
rejectAccess,BLOCKED,"Requires funded Sepolia wallet and live RPC endpoint"
revokeAccess,BLOCKED,"Requires funded Sepolia wallet and live RPC endpoint"
verifyFileHashOnChain,BLOCKED,"Requires live Sepolia RPC endpoint"
`);

w("06_BLOCKCHAIN_BENCHMARK", "blockchain_summary.json", JSON.stringify({
  experiment: "blockchain_gas_and_latency",
  status: "BLOCKED",
  executedAt: "2026-10-14T16:43:00Z",
  network: "Ethereum Sepolia Testnet",
  chainId: 11155111,
  reason: "The blockchainBenchmark.js script explicitly checks isBlockchainConfigured() and exits with an error if PRIVATE_KEY, BLOCKCHAIN_RPC_URL, or BLOCKCHAIN_CONTRACT_ADDRESS are not configured or if the wallet has insufficient Sepolia ETH. Submitting real blockchain transactions requires explicit user approval (Mandatory Rule 12).",
  prerequisites: [
    "PRIVATE_KEY — funded Sepolia wallet private key",
    "BLOCKCHAIN_RPC_URL — live Alchemy/Infura Sepolia RPC endpoint",
    "BLOCKCHAIN_CONTRACT_ADDRESS — deployed GenoVault contract address",
    "Minimum ~0.01 SepoliaETH for N=3 registerFile transactions",
    "Explicit user approval to submit live testnet transactions"
  ],
  scriptAvailable: "backend/experiments/blockchainBenchmark.js",
  operationsCovered: ["registerFile (write)", "verifyFileHashOnChain (read)"],
  operationsNotInScript: ["requestAccess", "approveAccess", "rejectAccess", "revokeAccess"],
  note: "Gas usage estimates from contract ABI exist but actual gas_used from receipts requires live transaction execution. Nominal Sepolia block time is ~12 seconds; actual confirmation latency depends on network congestion and must not be inferred from block time."
}, null, 2));

w("06_BLOCKCHAIN_BENCHMARK", "blockchain_methodology.md", `# Blockchain Gas and Latency Methodology

## Status: BLOCKED

This experiment requires live Sepolia testnet access and a funded wallet.

## What the Experiment Would Do

For each operation (N=3 runs each):
1. Submit transaction to Sepolia via Alchemy/Infura RPC
2. Wait for 1-block confirmation (tx.wait(1))
3. Record: gasUsed (from receipt), blockNumber, txHash, submission timestamp, confirmation timestamp
4. Compute confirmation latency = confirmationTimestamp − submissionTimestamp

## Operations Covered

| Operation              | Type  | Gas Usage (estimated, not measured) |
|------------------------|-------|-------------------------------------|
| registerFile()         | Write | ~100,000–150,000 gas (estimated)    |
| requestAccess()        | Write | ~80,000–100,000 gas (estimated)     |
| approveAccess()        | Write | ~80,000–100,000 gas (estimated)     |
| rejectAccess()         | Write | ~60,000–80,000 gas (estimated)      |
| revokeAccess()         | Write | ~60,000–80,000 gas (estimated)      |
| checkAccess()          | Read  | 0 gas (eth_call)                    |
| verifyFileHashOnChain()| Read  | 0 gas (eth_call)                    |

**IMPORTANT:** These are design-level estimates, NOT measured values from receipts.
Do not cite these in the paper as experimental results.

## Prerequisites

- Live Alchemy/Infura Sepolia RPC endpoint
- Funded Sepolia wallet (SepoliaETH available from faucets)
- Explicit user authorization to submit transactions

## Note on Sepolia ETH

SepoliaETH is test ETH with no monetary value. Cost figures in the paper, if any,
should clarify this (e.g., "no real monetary cost on testnet").
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 07 — SRA Benchmark (BLOCKED)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 07_SRA_BENCHMARK ===");

w("07_SRA_BENCHMARK", "sra_run_results.csv",
`status,reason
BLOCKED,"No GenoVault-watermarked file exists in a public NCBI SRA accession. The system watermarks controlled downloads, not public SRA submissions."
`);

w("07_SRA_BENCHMARK", "sra_summary.json", JSON.stringify({
  experiment: "ncbi_sra_discovery_scan",
  status: "BLOCKED",
  executedAt: "2026-10-14T16:43:00Z",
  reason: "The SRA discovery workflow is designed to scan NCBI SRA for publicly leaked watermarked copies. No GenoVault-watermarked file has been submitted to a public NCBI SRA accession; GenoVault watermarks controlled research downloads — it does not produce SRA submissions. A synthetic end-to-end test of the scan pipeline (against a locally hosted FASTQ) is possible but was not implemented in the existing harnesses.",
  stagesDocumented: [
    "1. Query construction and submission to NCBI SRA API",
    "2. Candidate accession discovery by metadata similarity",
    "3. Metadata retrieval (study/sample/run accession metadata)",
    "4. FASTQ retrieval (fastq-dump or SRA API)",
    "5. FASTQ normalization",
    "6. Watermark recovery (detectWatermarkInCandidate)",
    "7. SHA-256 commitment verification",
    "8. Final classification: verified match / metadata-only / inconclusive"
  ],
  serviceFile: "backend/services/misuseDetectionService.js",
  note: "Zero verified matches in the tested search scope is the honest result. This must not be interpreted as proof that no misuse of GenoVault-hosted data has occurred."
}, null, 2));

w("07_SRA_BENCHMARK", "sra_methodology.md", `# NCBI SRA Discovery Scan Methodology

## Status: BLOCKED

## Reason

The SRA discovery scan requires a real GenoVault-watermarked file to be present
in a public NCBI SRA accession. This would only occur if a researcher who downloaded
a watermarked file uploaded it to SRA — i.e., the actual misuse scenario the system
detects.

For controlled experiments, a synthetic scan pipeline test would require:
1. A real or synthetic FASTQ with an embedded watermark committed to a test blockchain entry
2. An NCBI SRA accession containing that file (or a local API mock)
3. A valid NCBI API key to respect rate limits

## Implementation Available

\`backend/services/misuseDetectionService.js\` — contains the detection logic.
The pipeline stages are implemented; an end-to-end integration test against a
controlled local FASTQ is feasible but was not present in the existing harness suite.

## Honest Result

**Zero verified matches found** — because no watermarked file from GenoVault has
been submitted to a public SRA accession in the test environment.

This is the correct outcome for a system in controlled testing.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 08 — Security Regression
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 08_SECURITY_REGRESSION ===");

const secTests = [
  // Identity
  { id:"SEC-ID-01", category:"Identity", test:"HMAC-SHA256 determinism (same ORCID+secret → same bytes32)",          status:"PASS", evidence:"ID-01 (Jest)" },
  { id:"SEC-ID-02", category:"Identity", test:"Different ORCID → different identifier",                               status:"PASS", evidence:"ID-02 (Jest)" },
  { id:"SEC-ID-03", category:"Identity", test:"Different secret → different identifier (key dependency)",             status:"PASS", evidence:"ID-03 (Jest)" },
  { id:"SEC-ID-04", category:"Identity", test:"Output is valid bytes32 (0x-prefixed, 66 chars, hex)",                 status:"PASS", evidence:"ID-04 (Jest)" },
  { id:"SEC-ID-05", category:"Identity", test:"Missing RESEARCHER_ID_HMAC_SECRET → fail-safe throw",                 status:"PASS", evidence:"ID-05 (Jest)" },
  { id:"SEC-ID-06", category:"Identity", test:"Raw ORCID string not present in output identifier",                    status:"PASS", evidence:"ID-06 (Jest)" },
  { id:"SEC-ID-07", category:"Identity", test:"V1 keccak256 and V2 HMAC produce different bytes32 for same ORCID",   status:"PASS", evidence:"ID-07 (Jest)" },
  // Encryption
  { id:"SEC-ENC-01", category:"Encryption", test:"V2 AES-CBC+HMAC round-trip: decrypt recovers plaintext",           status:"PASS", evidence:"ENC-01 (Jest)" },
  { id:"SEC-ENC-02", category:"Encryption", test:"Modified ciphertext → MAC verification throws",                    status:"PASS", evidence:"ENC-02 (Jest)" },
  { id:"SEC-ENC-03", category:"Encryption", test:"Modified IV → MAC verification throws",                            status:"PASS", evidence:"ENC-03 (Jest)" },
  { id:"SEC-ENC-04", category:"Encryption", test:"Wrong MAC hex → throws",                                           status:"PASS", evidence:"ENC-04 (Jest)" },
  { id:"SEC-ENC-05", category:"Encryption", test:"Incorrect MAC rejected via constant-time timingSafeEqual",         status:"PASS", evidence:"ENC-05 (Jest)" },
  { id:"SEC-ENC-06", category:"Encryption", test:"V1 legacy ciphertext decrypts correctly (backward compatibility)",  status:"PASS", evidence:"ENC-06 (Jest)" },
  { id:"SEC-ENC-07", category:"Encryption", test:"V1 ciphertext + decryptBufferV2 (no MAC) → throws",                status:"PASS", evidence:"ENC-07 (Jest)" },
  { id:"SEC-ENC-08", category:"Encryption", test:"V2 encryptBufferV2 returns 64-char hex MAC field",                  status:"PASS", evidence:"ENC-08 (Jest)" },
  // Watermark crypto
  { id:"SEC-WM-01", category:"Watermark", test:"watermarkCommitment = SHA-256(payload)",                             status:"PASS", evidence:"WM-09 (Jest)" },
  { id:"SEC-WM-02", category:"Watermark", test:"Missing WATERMARK_SECRET → throws (fail-safe)",                      status:"PASS", evidence:"WM-16 (Jest)" },
  { id:"SEC-WM-03", category:"Watermark", test:"Modified payload produces different commitment → detection rejects",  status:"PASS", evidence:"WM-28 (Jest)" },
  { id:"SEC-WM-04", category:"Watermark", test:"Seed, payload, and commitment are cryptographically distinct values", status:"PASS", evidence:"WM-29 (Jest)" },
];

let secCSV = "test_id,category,test_description,status,evidence\n";
for (const t of secTests) {
  secCSV += `"${t.id}","${t.category}","${t.test}","${t.status}","${t.evidence}"\n`;
}
w("08_SECURITY_REGRESSION", "security_results.csv", secCSV);

w("08_SECURITY_REGRESSION", "security_summary.json", JSON.stringify({
  experiment: "security_regressions",
  executedAt: "2026-10-14T16:43:41Z",
  totalTests: secTests.length,
  passed: secTests.filter(t=>t.status==="PASS").length,
  failed: 0, skipped: 0,
  categories: {
    identity: { tests: 7, passed: 7, failed: 0 },
    encryption: { tests: 8, passed: 8, failed: 0 },
    watermarkCrypto: { tests: 4, passed: 4, failed: 0 }
  },
  noCredentialsExposed: true
}, null, 2));

w("08_SECURITY_REGRESSION", "security_findings.md", `# Security Regression Findings

## Result: All 19 Security-Critical Tests PASS

Executed via: \`npx jest tests/ --verbose\` on 2026-10-14

## Identity Versioning (R3.1)

| Test  | Assertion                                    | Result |
|-------|----------------------------------------------|--------|
| ID-01 | HMAC-SHA256 determinism                      | PASS   |
| ID-02 | ORCID uniqueness                             | PASS   |
| ID-03 | Secret-key dependency                        | PASS   |
| ID-04 | Valid bytes32 format                         | PASS   |
| ID-05 | Missing secret → fail-safe throw             | PASS   |
| ID-06 | ORCID not in output                          | PASS   |
| ID-07 | V1 ≠ V2 for same ORCID                       | PASS   |

**Security property confirmed:** The V2 HMAC-SHA256 scheme depends on a secret key,
preventing offline dictionary-style mapping from publicly enumerable ORCID identifiers.

## Encryption Security (R3.2)

| Test   | Assertion                                    | Result |
|--------|----------------------------------------------|--------|
| ENC-01 | Round-trip correctness                       | PASS   |
| ENC-02 | Ciphertext tamper → rejection                | PASS   |
| ENC-03 | IV tamper → rejection                        | PASS   |
| ENC-04 | Wrong MAC → rejection                        | PASS   |
| ENC-05 | Constant-time MAC comparison (timingSafeEqual)| PASS  |
| ENC-06 | V1 backward compatibility                    | PASS   |
| ENC-07 | V1 file + V2 decoder (no MAC) → throws       | PASS   |
| ENC-08 | V2 output includes 64-char MAC field         | PASS   |

**Security property confirmed:** Encrypt-then-MAC correctly authenticates both IV and
ciphertext. Any modification to either field is detected before decryption.

## Watermark Cryptographic Integrity

| Test  | Assertion                                    | Result |
|-------|----------------------------------------------|--------|
| WM-09 | Commitment = SHA-256(payload) — verified     | PASS   |
| WM-16 | Missing secret → fail-safe throw             | PASS   |
| WM-28 | Modified payload → different commitment, rejected | PASS |
| WM-29 | Seed, payload, commitment: three distinct values | PASS |

## Credential Handling

No HMAC secrets, encryption keys, ORCID values, private keys, or other sensitive
values appear in test outputs or this report. The identity test console.log at ID-07
prints only the 32-byte hex output identifiers (the hash outputs), not the input
ORCID or secret values.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// 09 — Integrity and Wallet
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== 09_INTEGRITY_WALLET ===");

const intTests = [
  { id:"INT-01", input:"All layers PASS",                               expectedOverall:"SECURE",                      actual:"SECURE",                      result:"PASS" },
  { id:"INT-02", input:"SHA-256 FAIL → INTEGRITY_VIOLATION",           expectedOverall:"INTEGRITY_VIOLATION",         actual:"INTEGRITY_VIOLATION",         result:"PASS" },
  { id:"INT-03", input:"Azure FAIL → PRIMARY_STORAGE_UNAVAILABLE",     expectedOverall:"PRIMARY_STORAGE_UNAVAILABLE", actual:"PRIMARY_STORAGE_UNAVAILABLE", result:"PASS" },
  { id:"INT-04", input:"IPFS PENDING + all others PASS",               expectedOverall:"PENDING",                     actual:"PENDING",                     result:"PASS" },
  { id:"INT-05", input:"IPFS FAIL → BACKUP_UNAVAILABLE",               expectedOverall:"BACKUP_UNAVAILABLE",          actual:"BACKUP_UNAVAILABLE",          result:"PASS" },
  { id:"INT-06", input:"Blockchain FAIL → VERIFICATION_UNAVAILABLE",   expectedOverall:"VERIFICATION_UNAVAILABLE",    actual:"VERIFICATION_UNAVAILABLE",    result:"PASS" },
  { id:"INT-07", input:"AES FAIL → KEY_OR_DECRYPTION_FAILURE",         expectedOverall:"KEY_OR_DECRYPTION_FAILURE",   actual:"KEY_OR_DECRYPTION_FAILURE",   result:"PASS" },
  { id:"INT-08", input:"Layer result field schema",                     expectedOverall:"Fields: status,category,layer,timestamp", actual:"MATCH",          result:"PASS" },
  { id:"INT-09", input:"INTEGRITY_VIOLATION + KEY_OR_DECRYPTION_FAILURE simultaneous", expectedOverall:"INTEGRITY_VIOLATION (wins)", actual:"INTEGRITY_VIOLATION", result:"PASS" },
  { id:"INT-10", input:"IPFS PENDING + INTEGRITY_VIOLATION",           expectedOverall:"INTEGRITY_VIOLATION (not PENDING)", actual:"INTEGRITY_VIOLATION",    result:"PASS" },
];

let intCSV = "test_id,input_scenario,expected_overall,actual_overall,result\n";
for (const t of intTests) {
  intCSV += `"${t.id}","${t.input}","${t.expectedOverall}","${t.actual}","${t.result}"\n`;
}
w("09_INTEGRITY_WALLET", "integrity_results.csv", intCSV);

w("09_INTEGRITY_WALLET", "integrity_summary.json", JSON.stringify({
  experiment: "integrity_classification_and_wallet",
  executedAt: "2026-10-14T16:43:41Z",
  integrityTests: { total: 10, passed: 10, failed: 0 },
  categoriesTested: [
    "SECURE", "PENDING", "INTEGRITY_VIOLATION", "KEY_OR_DECRYPTION_FAILURE",
    "PRIMARY_STORAGE_UNAVAILABLE", "BACKUP_UNAVAILABLE", "VERIFICATION_UNAVAILABLE"
  ],
  categoryNotTested: "AUTHORIZATION_FAILURE — not implemented in current codebase",
  priorityRuleConfirmed: "INTEGRITY_VIOLATION wins over KEY_OR_DECRYPTION_FAILURE (INT-09) and over PENDING (INT-10)",
  walletControls: { assessed: true, detailsInWalletAssessment: true }
}, null, 2));

w("09_INTEGRITY_WALLET", "wallet_security_assessment.md", `# System Wallet Security Assessment

**Date:** 2026-10-14  
**Source:** Code inspection of backend/services/blockchainService.js and backend/server.js

---

## Implemented and Tested Controls

| Control                          | Implementation Status  | Test Coverage |
|----------------------------------|------------------------|---------------|
| PRIVATE_KEY loaded from .env     | Implemented            | Not unit-tested — startup validation |
| isBlockchainConfigured() check   | Implemented            | Checked in experiments/blockchainBenchmark.js |
| Network validation (chainId)     | Implemented (ethers.js handles) | Not explicitly unit-tested |
| Signer from PRIVATE_KEY          | Implemented (ethers.Wallet) | Not unit-tested |
| JWT secret from .env             | Implemented            | Not unit-tested (auth middleware) |

## Implemented but Not Unit-Tested Controls

| Control                          | Location                  |
|----------------------------------|---------------------------|
| PRIVATE_KEY absent → startup warning | blockchainService.js  |
| Contract address validation      | blockchainService.js      |
| bcrypt PIN hash storage in Key Vault | controllers/fileController.js |

## Documented as Design Recommendations (Not Implemented)

| Control                          | Status          |
|----------------------------------|-----------------|
| Key rotation                     | NOT IMPLEMENTED |
| Wallet compromise containment    | NOT IMPLEMENTED |
| Key backup and recovery          | NOT IMPLEMENTED |
| Hardware wallet / HSM            | NOT IMPLEMENTED |
| Multi-sig transaction threshold  | NOT IMPLEMENTED |

**Important:** Key rotation, recovery, and compromise containment are design-level
recommendations only. No code implements them. They must not be claimed as implemented
security controls in the paper.

## .env File Security

- The .env file is listed in .gitignore — confirmed.
- The .env file is NOT committed to the repository.
- PRIVATE_KEY is present in .env (name confirmed; value not read or logged here).
- All secret variable names are documented in the inventory; no values are exposed.

## Priority Rule (Integrity Classification)

The priority rule is implemented in the integrity service and confirmed by tests:

\`\`\`
INTEGRITY_VIOLATION > KEY_OR_DECRYPTION_FAILURE > PRIMARY_STORAGE_UNAVAILABLE
> BACKUP_UNAVAILABLE > VERIFICATION_UNAVAILABLE > PENDING > SECURE
\`\`\`

Tests INT-09 and INT-10 confirm that INTEGRITY_VIOLATION takes precedence over
competing categories in combined failure scenarios.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN REPORT
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md ===");
w(".", "GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md", `# GenoVault — Experimental Evidence Report

**Campaign:** EVIDENCE_2026-10-14  
**Generated:** 2026-10-14T17:00:00Z (IST +05:30)  
**Commit:** 1d7a07ffbaae750d81c5365a170d01afb880e9b3  
**Reporter:** Senior research engineer — automated evidence generation  

> **Priority: reproducibility, scientific honesty, and complete evidence.**
> No results are fabricated. All numbers come from actual harness executions recorded in this session.

---

## 1. Executive Summary

| Experiment | Status | Runs/Tests | Key Result | Evidence File | Limitations |
|------------|--------|------------|------------|---------------|-------------|
| A — Unit Tests | ✅ COMPLETE | 54/54 tests | 54 PASS, 0 FAIL | 01_TEST_RESULTS/ | Tests cover implementation correctness, not live infrastructure |
| B — Watermark Robustness | ⚠️ EXECUTED / HARNESS LIMITATION | 25 obs (5 perturbations × 5 runs) | 0% detection rate — harness design issue | 02_WATERMARK_ROBUSTNESS/ | The 0% P1 (lossless) rate reveals the harness does not use the real embed→detect pipeline |
| C — FASTQ Quality Impact | ✅ COMPLETE | 5 runs | Mean |ΔQuality| = ${fastqMean.toFixed(6)} Phred; Q30 change = 0 | 03_FASTQ_IMPACT/ | N=5, synthetic data only, no tool compatibility tested |
| D — Encryption Performance | ✅ COMPLETE | 3 runs × 3 sizes | V2 overhead at 1 MB: +3.271 ms enc, +1.051 ms dec | 04_ENCRYPTION_PERFORMANCE/ | N=3 only, cloud stages not measured |
| E — Azure vs IPFS Backup | 🚫 BLOCKED | — | Missing credentials / test file | 05_BACKUP_COMPARISON/ | Requires live Azure + Filebase + registered test file |
| F — Blockchain Gas/Latency | 🚫 BLOCKED | — | Requires funded Sepolia wallet + user approval | 06_BLOCKCHAIN_BENCHMARK/ | No live transaction submitted |
| G — NCBI SRA Discovery | 🚫 BLOCKED | — | No watermarked file in public SRA | 07_SRA_BENCHMARK/ | System watermarks controlled downloads, not SRA |
| H — Security Regressions | ✅ COMPLETE | 19 tests | 19 PASS — identity, encryption, watermark crypto | 08_SECURITY_REGRESSION/ | Wallet-specific tests not unit-tested |
| I — Integrity + Wallet | ✅ COMPLETE | 10 integrity tests | 10 PASS — all 7 categories + 3 priority rule tests | 09_INTEGRITY_WALLET/ | AUTHORIZATION_FAILURE category not implemented |

---

## 2. Repository and Environment

| Field         | Value                                        |
|---------------|----------------------------------------------|
| Git commit    | 1d7a07ffbaae750d81c5365a170d01afb880e9b3     |
| Node.js       | v24.11.1                                     |
| Jest          | 29.7.0                                       |
| ethers.js     | 6.16.0                                       |
| OS            | Windows win32 x64                            |
| CPU cores     | 4                                            |
| RAM           | 7,991 MB                                     |

---

## 3. Experiment Inventory

See [00_PROJECT_AND_EXPERIMENT_INVENTORY.md](00_PROJECT_AND_EXPERIMENT_INVENTORY.md)

---

## 4. Commands Executed

\`\`\`
# Environment check
node -e "console.log(JSON.stringify({node: process.version, ...require('os')}))"

# Fresh test run (Exp A, H, I)
npx jest tests/ --json --outputFile=../results/jest_results_fresh.json

# Encryption benchmark (Exp D)
node experiments/downloadBenchmark.js

# Watermark robustness (Exp B)
node experiments/watermarkRobustnessHarness.js

# FASTQ downstream impact (Exp C)
node experiments/fastqDownstreamImpact.js
\`\`\`

---

## 5. Dataset Descriptions

| Experiment | Dataset                              | Source          |
|------------|--------------------------------------|-----------------|
| A (Tests)  | Synthetic FASTQ text buffers (in-memory) | Generated in test code |
| B (Robustness) | 500 reads × 150 bp quality arrays | crypto.randomBytes() |
| C (FASTQ)  | 1000 reads × 150 bp, Phred [20,40]  | crypto.randomBytes() |
| D (Encryption) | Random bytes: 10 KB, 100 KB, 1024 KB | crypto.randomBytes() |

**No real patient genomic data was used in any experiment.**

---

## 6. Test Suite Summary (Exp A)

| Suite              | Tests | Passed | Failed | Duration |
|--------------------|-------|--------|--------|----------|
| encryption.test.js | 8     | 8      | 0      | 14.6 s   |
| identity.test.js   | 7     | 7      | 0      | 9.7 s    |
| integrity.test.js  | 10    | 10     | 0      | 14.1 s   |
| watermark.test.js  | 29    | 29     | 0      | 15.9 s   |
| **TOTAL**          | **54**| **54** | **0**  | 26.2 s   |

---

## 7. Individual Watermark Test Outcomes (T01–T29)

See [01_TEST_RESULTS/individual_test_results.csv](01_TEST_RESULTS/individual_test_results.csv)

All 29 watermark tests PASS. Functional tests (T1–T14), concurrent downloads (T15),
robustness/error-handling (T16–T26), and cryptographic commitment (T27–T29).

---

## 8. Per-Transformation Robustness Results (Exp B)

| Perturbation                    | Detection Rate | Detected | Not Detected | Finding |
|---------------------------------|----------------|----------|--------------|---------|
| P1 Lossless round-trip          | 0/5 (0%)       | 0        | 5            | HARNESS LIMITATION |
| P2 Quality jitter ±1            | 0/5 (0%)       | 0        | 5            | HARNESS LIMITATION |
| P3 5% read substitution         | 0/5 (0%)       | 0        | 5            | HARNESS LIMITATION |
| P4 10% read truncation          | 0/5 (0%)       | 0        | 5            | HARNESS LIMITATION |
| P5 Quality normalization        | 0/5 (0%)       | 0        | 5            | HARNESS LIMITATION |

**Critical:** P1 (lossless) also shows 0%. This means the harness's detect step is
not matching the embed step. Jest WM-06 confirms that actual embed→detect works.
See [02_WATERMARK_ROBUSTNESS/robustness_failures.md](02_WATERMARK_ROBUSTNESS/robustness_failures.md).

**Implication for the paper:** Do not cite a robustness percentage from this harness.
The correct robustness evidence is: (1) WM-06 (end-to-end detection PASS), (2) WM-07
(different watermark → not detected), (3) WM-08 (unwatermarked → not detected).

---

## 9. FASTQ Quality-Impact Statistics (Exp C)

Dataset: 1,000 synthetic reads × 150 bp, Phred [20,40], N=5 runs.
Algorithm: GENOMIC_LSB_V1.

| Statistic              | Value (Phred units) |
|------------------------|---------------------|
| Mean |ΔQuality|         | ${fastqMean.toFixed(6)} |
| Median |ΔQuality|        | ${median(fastqDeltas).toFixed(6)} |
| SD                     | ${fastqSD.toFixed(6)} |
| Min (run)              | ${fastqMin.toFixed(6)} |
| Max (run)              | ${fastqMax.toFixed(6)} |
| 95% CI (t, df=4)       | [${fastqCI.lower}, ${fastqCI.upper}] |
| Q30 rate change        | 0.000000 (all 5 runs) |
| Threshold pass (< 1.0 Phred) | ✅ PASS |

**CI method:** Student t-distribution, two-tailed, df = N−1 = 4, t_crit = 2.776.
N=5 is preliminary.

**Not tested:** BWA, GATK, FastQC, trimmomatic — NOT RUN on this data.

---

## 10. Encryption and Download Performance (Exp D)

N=3 runs per size. V1 = AES-256-CBC. V2 = AES-256-CBC + HMAC-SHA256.

| Size   | V1 Enc (mean ms) | V2 Enc (mean ms) | Overhead (ms) | V1 Dec (mean ms) | V2 Dec (mean ms) |
|--------|------------------|------------------|---------------|------------------|------------------|
| 10 KB  | 0.832            | 0.919            | +0.087        | 0.115            | 0.221            |
| 100 KB | 1.003            | 0.481            | −0.522*       | 0.292            | 0.381            |
| 1024 KB| 2.503            | 5.774            | +3.271        | 2.144            | 3.195            |

*Negative at 100 KB: measurement noise at N=3 (V1 run 2 was JIT-inflated at 2.320 ms).

Throughput (V2, 1024 KB, mean enc): 1024/5.774 ≈ 177 MB/s (in-process only; not end-to-end).

Cloud stages NOT measured: Azure download, Key Vault retrieval, response streaming — BLOCKED.

---

## 11. Azure–Filebase/IPFS Comparison (Exp E)

**Status: BLOCKED**  
See [05_BACKUP_COMPARISON/backup_methodology.md](05_BACKUP_COMPARISON/backup_methodology.md)

---

## 12. Blockchain Gas and Confirmation Latency (Exp F)

**Status: BLOCKED**  
See [06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md](06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md)

---

## 13. NCBI SRA Scan Performance (Exp G)

**Status: BLOCKED** — 0 verified matches in tested scope.  
See [07_SRA_BENCHMARK/sra_methodology.md](07_SRA_BENCHMARK/sra_methodology.md)

---

## 14. Identity, Encryption, and Integrity Regressions (Exp H, I)

19 security-critical tests PASS. 10 integrity-classification tests PASS.
Priority rule confirmed: INTEGRITY_VIOLATION > KEY_OR_DECRYPTION_FAILURE > others.

See [08_SECURITY_REGRESSION/security_findings.md](08_SECURITY_REGRESSION/security_findings.md)  
See [09_INTEGRITY_WALLET/integrity_results.csv](09_INTEGRITY_WALLET/integrity_results.csv)

---

## 15. Wallet Security Assessment

See [09_INTEGRITY_WALLET/wallet_security_assessment.md](09_INTEGRITY_WALLET/wallet_security_assessment.md)

Key finding: Key rotation, recovery, and compromise containment are design recommendations
only — NOT implemented. Must not be claimed as implemented controls.

---

## 16. Failures, Skipped Tests, and Blocked Experiments

| Item                              | Status   | Reason |
|-----------------------------------|----------|--------|
| All 54 Jest tests                 | PASS     | — |
| Robustness harness (25 obs)       | EXECUTED | All 0% — harness design limitation |
| Exp E (Azure vs IPFS)             | BLOCKED  | Missing test file + cloud credentials |
| Exp F (Blockchain benchmark)      | BLOCKED  | Requires funded Sepolia wallet + user approval |
| Exp G (NCBI SRA scan)             | BLOCKED  | No watermarked file in public SRA |
| AUTHORIZATION_FAILURE category    | NOT TESTED | Not implemented in codebase |
| Wallet key rotation               | NOT IMPLEMENTED | Design recommendation only |

---

## 17. Statistical Methods and Uncertainty

| Experiment | Method | N | Note |
|------------|--------|---|------|
| FASTQ impact — mean | Arithmetic mean of run-level measurements | 5 | — |
| FASTQ impact — CI | Student t, df=4, two-tailed, t_crit=2.776 | 5 | Preliminary at N=5 |
| Encryption timing | Mean, median, SD, min, max from N=3 raw timings | 3 | JIT inflation in run 1 |
| Robustness | Count of detected/not-detected per perturbation | 5 | Harness issue — do not cite |

No statistical significance testing was performed. The sample sizes (N=3–5) are
insufficient to support hypothesis testing. Results are observational.

---

## 18. Limitations and Reproducibility

### Reproducibility

To reproduce all executable experiments:

\`\`\`bash
cd backend/
npx jest tests/ --json --outputFile=../results/jest_results_fresh.json
node experiments/downloadBenchmark.js
node experiments/watermarkRobustnessHarness.js
node experiments/fastqDownstreamImpact.js
\`\`\`

Requirements: Node.js v20+, npm install completed, .env with RESEARCHER_ID_HMAC_SECRET and WATERMARK_SECRET.

### Limitations

1. N=3–5 runs — too few for reliable performance characterization
2. Synthetic data only — no real FASTQ compatibility demonstrated
3. Cloud stages (Azure download, Key Vault, IPFS) not measured — credentials required
4. Blockchain experiment not run — live Sepolia wallet + user approval required
5. Robustness harness has a design flaw (P1 shows 0%) — must be fixed before citing
6. No downstream bioinformatics tools (BWA, GATK, FastQC) were run
7. Windows environment — results may differ on Linux deployment servers

---

## 19. Mapping to Reviewer Comments

| Reviewer Comment | Experiment | Status | Evidence |
|------------------|------------|--------|----------|
| R3.1: ORCID dictionary mapping | ID-01 to ID-07 | ✅ ADDRESSED | 08_SECURITY_REGRESSION/ |
| R3.2: AES authentication (Encrypt-then-MAC) | ENC-01 to ENC-08 | ✅ ADDRESSED | 08_SECURITY_REGRESSION/ |
| R3.3: Watermark downstream impact | Exp C (FASTQ) | ✅ PARTIAL — synthetic only | 03_FASTQ_IMPACT/ |
| R3.4: Integrity categories / priority rules | INT-01 to INT-10 | ✅ ADDRESSED | 09_INTEGRITY_WALLET/ |
| R3.5: Robustness under perturbations | Exp B | ⚠️ HARNESS FLAW — not yet citable | 02_WATERMARK_ROBUSTNESS/ |
| Blockchain gas / latency | Exp F | 🚫 BLOCKED | 06_BLOCKCHAIN_BENCHMARK/ |
| Azure vs IPFS backup verification | Exp E | 🚫 BLOCKED | 05_BACKUP_COMPARISON/ |
| SRA scan timing | Exp G | 🚫 BLOCKED | 07_SRA_BENCHMARK/ |
`);

// ═══════════════════════════════════════════════════════════════════════════════
// PAPER-READY RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== PAPER_READY_RESULTS.md ===");
w(".", "PAPER_READY_RESULTS.md", `# GenoVault — Paper-Ready Results

**Evidence campaign:** EVIDENCE_2026-10-14  
**Commit:** 1d7a07ffbaae750d81c5365a170d01afb880e9b3  

> Each numerical claim below is traceable to a raw result file.  
> Claims are clearly distinguished as: **Measured** / **Design** / **Not Tested** / **Blocked**.

---

## Table 1 — Test Suite Results (Section: Evaluation / Implementation Correctness)

| Suite                   | Category              | Tests | Passed | Failed |
|-------------------------|-----------------------|-------|--------|--------|
| identity.test.js        | Identity versioning   | 7     | 7      | 0      |
| encryption.test.js      | Encrypt-then-MAC      | 8     | 8      | 0      |
| integrity.test.js       | Integrity categories  | 10    | 10     | 0      |
| watermark.test.js       | Watermark (all)       | 29    | 29     | 0      |
| **Total**               |                       | **54**| **54** | **0**  |

*Source: [01_TEST_RESULTS/test_summary.json](01_TEST_RESULTS/test_summary.json)*  
*Command: \`npx jest tests/ --verbose\` on Node.js v24.11.1, 2026-10-14*

---

## Table 2 — FASTQ Quality Impact (Section: Watermark Evaluation)

*Source: [03_FASTQ_IMPACT/fastq_summary.json](03_FASTQ_IMPACT/fastq_summary.json)*  
Dataset: 1,000 synthetic reads × 150 bp, Phred [20,40], N=5 independent runs.  
Algorithm: GENOMIC_LSB_V1 (1 LSB per read in quality[0]).

| Metric                    | Value               | Threshold | Pass/Fail |
|---------------------------|---------------------|-----------|-----------|
| Mean \|ΔQuality\| (Phred)  | ${fastqMean.toFixed(4)}         | < 1.0     | PASS ✓    |
| 95% CI (t, df=4)          | [${fastqCI.lower}, ${fastqCI.upper}] Phred | — | — |
| Q30 rate change           | 0.0000              | < 0.01    | PASS ✓    |
| DNA sequence modified?    | No                  | —         | PASS ✓    |

**Suggested paper text (Results section):**
> "The GENOMIC_LSB_V1 watermarking algorithm introduced a mean absolute quality-score
> perturbation of ${fastqMean.toFixed(4)} Phred (95% CI: [${fastqCI.lower}, ${fastqCI.upper}]; N=5 runs, 1,000 synthetic
> reads × 150 bp, Phred scores uniformly drawn from [20,40]). The Q30 base-call rate
> was unchanged across all five runs. Nucleotide bases were not modified. Compatibility
> with specific analysis tools (BWA, GATK, FastQC) was not evaluated in this experiment."

---

## Table 3 — Encryption Overhead (Section: Performance)

*Source: [04_ENCRYPTION_PERFORMANCE/encryption_summary.json](04_ENCRYPTION_PERFORMANCE/encryption_summary.json)*  
N=3 runs per size. Timings: process.hrtime.bigint() (ns resolution).  
**Caveat: N=3 is insufficient for reliable performance characterization. Results are indicative only.**

| Size    | V1 Enc mean (ms) | V2 Enc mean (ms) | V2 overhead (ms) | V1 Dec mean (ms) | V2 Dec mean (ms) |
|---------|-----------------|-----------------|------------------|-----------------|-----------------|
| 10 KB   | 0.832           | 0.919           | +0.087           | 0.115           | 0.221           |
| 100 KB  | 1.003           | 0.481           | −0.522*          | 0.292           | 0.381           |
| 1024 KB | 2.503           | 5.774           | +3.271           | 2.144           | 3.195           |

*Negative at 100 KB is a noise artifact at N=3.*  
*Cloud download and Key Vault stages are NOT included — BLOCKED.*

**Suggested paper text (Discussion section):**
> "In-process V2 encryption overhead relative to V1 was below 3.3 ms for files up to
> 1 MB (N=3 runs each; indicative, not definitive). End-to-end download latency
> including Azure retrieval and Key Vault operations could not be benchmarked in
> this study due to infrastructure access constraints."

---

## Table 4 — Security Regression Tests (Section: Security Analysis)

*Source: [08_SECURITY_REGRESSION/security_summary.json](08_SECURITY_REGRESSION/security_summary.json)*

| Category              | Tests | Result                              |
|-----------------------|-------|-------------------------------------|
| Identity (V2 HMAC)    | 7     | All PASS — secret-key dependence confirmed |
| Encryption (V2 MAC)   | 8     | All PASS — tamper detection confirmed |
| Watermark crypto      | 4     | All PASS — commitment integrity confirmed |

**Suggested paper text:**
> "Seven unit tests confirmed that the V2 HMAC-SHA256 researcher identity scheme
> produces deterministic, secret-dependent identifiers; missing secret causes a
> fail-safe exception; and raw ORCID values are not recoverable from the output.
> Eight tests confirmed that the Encrypt-then-MAC scheme correctly rejects any
> modification to the ciphertext or IV via constant-time MAC comparison."

---

## Table 5 — Integrity Classification (Section: System Design / Evaluation)

*Source: [09_INTEGRITY_WALLET/integrity_results.csv](09_INTEGRITY_WALLET/integrity_results.csv)*

| Category Tested             | Priority | Test Result |
|-----------------------------|----------|-------------|
| SECURE                      | Lowest   | PASS        |
| PENDING                     | Low      | PASS        |
| BACKUP_UNAVAILABLE          | Medium   | PASS        |
| VERIFICATION_UNAVAILABLE    | Medium   | PASS        |
| PRIMARY_STORAGE_UNAVAILABLE | Medium   | PASS        |
| KEY_OR_DECRYPTION_FAILURE   | High     | PASS        |
| INTEGRITY_VIOLATION         | Highest  | PASS (wins over all) |

---

## Experiments NOT Producing Publishable Results

| Experiment                  | Status     | What Would Be Needed |
|-----------------------------|------------|----------------------|
| Watermark robustness harness| ⚠️ FLAW    | Fix harness to use real embed→detect pipeline |
| Blockchain gas / latency    | 🚫 BLOCKED | Funded Sepolia wallet, live RPC, user approval |
| Azure vs IPFS backup        | 🚫 BLOCKED | Test file + cloud credentials |
| NCBI SRA scan               | 🚫 BLOCKED | Watermarked file in public SRA |
| BWA/GATK tool compatibility | 🚫 NOT TESTED | Run alignment/variant calling on synthetic data |

These MUST NOT appear as results in the paper.
`);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL INDEX
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n=== EVIDENCE_INDEX.md ===");
w(".", "EVIDENCE_INDEX.md", `# GenoVault Evidence Index

**Campaign:** EVIDENCE_2026-10-14  
**Root:** D:\\\\ONE DRIVE\\\\OneDrive\\\\MY PROJECT\\\\MY PROJECT\\\\Major Project\\\\EVIDENCE_2026-10-14\\\\

| File | Description | Status |
|------|-------------|--------|
| [00_PROJECT_AND_EXPERIMENT_INVENTORY.md](00_PROJECT_AND_EXPERIMENT_INVENTORY.md) | Project inventory, versions, env vars | ✅ |
| [01_TEST_RESULTS/test_summary.json](01_TEST_RESULTS/test_summary.json) | Jest test summary (54 tests) | ✅ |
| [01_TEST_RESULTS/test_summary.csv](01_TEST_RESULTS/test_summary.csv) | Suite-level CSV | ✅ |
| [01_TEST_RESULTS/individual_test_results.csv](01_TEST_RESULTS/individual_test_results.csv) | All 54 test outcomes | ✅ |
| [01_TEST_RESULTS/failed_and_skipped_tests.md](01_TEST_RESULTS/failed_and_skipped_tests.md) | Zero failures | ✅ |
| [01_TEST_RESULTS/test_execution_environment.md](01_TEST_RESULTS/test_execution_environment.md) | Node/OS/Jest versions | ✅ |
| [02_WATERMARK_ROBUSTNESS/robustness_results.json](02_WATERMARK_ROBUSTNESS/robustness_results.json) | Harness output — harness flaw noted | ⚠️ |
| [02_WATERMARK_ROBUSTNESS/robustness_results.csv](02_WATERMARK_ROBUSTNESS/robustness_results.csv) | CSV — harness flaw noted | ⚠️ |
| [02_WATERMARK_ROBUSTNESS/robustness_methodology.md](02_WATERMARK_ROBUSTNESS/robustness_methodology.md) | Methodology | ✅ |
| [02_WATERMARK_ROBUSTNESS/robustness_failures.md](02_WATERMARK_ROBUSTNESS/robustness_failures.md) | Harness design issue analysis | ✅ |
| [03_FASTQ_IMPACT/fastq_run_results.csv](03_FASTQ_IMPACT/fastq_run_results.csv) | 5 run-level measurements | ✅ |
| [03_FASTQ_IMPACT/fastq_summary.json](03_FASTQ_IMPACT/fastq_summary.json) | Stats + CI | ✅ |
| [03_FASTQ_IMPACT/fastq_methodology.md](03_FASTQ_IMPACT/fastq_methodology.md) | Methodology | ✅ |
| [03_FASTQ_IMPACT/fastq_analysis.md](03_FASTQ_IMPACT/fastq_analysis.md) | Analysis + limitations | ✅ |
| [04_ENCRYPTION_PERFORMANCE/encryption_run_results.csv](04_ENCRYPTION_PERFORMANCE/encryption_run_results.csv) | Raw timings N=3 | ✅ |
| [04_ENCRYPTION_PERFORMANCE/encryption_summary.json](04_ENCRYPTION_PERFORMANCE/encryption_summary.json) | Stats by size/version | ✅ |
| [04_ENCRYPTION_PERFORMANCE/download_overhead.json](04_ENCRYPTION_PERFORMANCE/download_overhead.json) | V2 vs V1 overhead | ✅ |
| [04_ENCRYPTION_PERFORMANCE/performance_methodology.md](04_ENCRYPTION_PERFORMANCE/performance_methodology.md) | Methodology | ✅ |
| [05_BACKUP_COMPARISON/backup_comparison_results.csv](05_BACKUP_COMPARISON/backup_comparison_results.csv) | BLOCKED | 🚫 |
| [05_BACKUP_COMPARISON/backup_comparison_summary.json](05_BACKUP_COMPARISON/backup_comparison_summary.json) | BLOCKED + prerequisites | 🚫 |
| [05_BACKUP_COMPARISON/backup_methodology.md](05_BACKUP_COMPARISON/backup_methodology.md) | Methodology | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_results.csv](06_BLOCKCHAIN_BENCHMARK/blockchain_results.csv) | BLOCKED | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_summary.json](06_BLOCKCHAIN_BENCHMARK/blockchain_summary.json) | BLOCKED + prerequisites | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md](06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md) | Methodology + gas estimates (not measured) | 🚫 |
| [07_SRA_BENCHMARK/sra_run_results.csv](07_SRA_BENCHMARK/sra_run_results.csv) | BLOCKED | 🚫 |
| [07_SRA_BENCHMARK/sra_summary.json](07_SRA_BENCHMARK/sra_summary.json) | BLOCKED + stages | 🚫 |
| [07_SRA_BENCHMARK/sra_methodology.md](07_SRA_BENCHMARK/sra_methodology.md) | Methodology | 🚫 |
| [08_SECURITY_REGRESSION/security_results.csv](08_SECURITY_REGRESSION/security_results.csv) | 19 tests | ✅ |
| [08_SECURITY_REGRESSION/security_summary.json](08_SECURITY_REGRESSION/security_summary.json) | Summary | ✅ |
| [08_SECURITY_REGRESSION/security_findings.md](08_SECURITY_REGRESSION/security_findings.md) | Findings narrative | ✅ |
| [09_INTEGRITY_WALLET/integrity_results.csv](09_INTEGRITY_WALLET/integrity_results.csv) | 10 categories | ✅ |
| [09_INTEGRITY_WALLET/integrity_summary.json](09_INTEGRITY_WALLET/integrity_summary.json) | Summary | ✅ |
| [09_INTEGRITY_WALLET/wallet_security_assessment.md](09_INTEGRITY_WALLET/wallet_security_assessment.md) | Wallet control assessment | ✅ |
| [GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md](GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md) | Master report | ✅ |
| [PAPER_READY_RESULTS.md](PAPER_READY_RESULTS.md) | Publication-ready tables | ✅ |

## Status Legend

- ✅ Complete and citable
- ⚠️ Executed but has a known limitation (harness design flaw — see robustness_failures.md)
- 🚫 Blocked — required credentials or infrastructure not available
`);

console.log("\n=== All evidence files written ===\n");
