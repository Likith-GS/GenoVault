# GenoVault — Paper-Ready Results (Updated)

**Campaign:** EVIDENCE_2026-10-14  
**Commit:** 1d7a07ffbaae750d81c5365a170d01afb880e9b3  
**Updated:** 2026-10-14T17:57:00Z

> Each claim is traceable to a raw result file.  
> Markers: **Measured** / **Partially measured** / **Inference from literature** / **Not tested**

---

## Table 1 — Test Suite Results

*Source: `results/jest_results_fresh.json` | Executed: 2026-10-14 | Node v24.11.1*

| Suite | Category | Tests | Passed | Failed |
|-------|----------|-------|--------|--------|
| identity.test.js | Identity versioning (R3.1) | 7 | 7 | 0 |
| encryption.test.js | Encrypt-then-MAC (R3.2) | 8 | 8 | 0 |
| integrity.test.js | Integrity categories (R3.4) | 10 | 10 | 0 |
| watermark.test.js | Watermark (all categories) | 29 | 29 | 0 |
| **TOTAL** | | **54** | **54** | **0** |

**Suggested paper text:**
> "All 54 unit tests across four test suites pass on the production codebase
> (Node.js v24.11.1, Jest 29.7.0), validating correctness of the identity,
> encryption, integrity classification, and watermarking modules."

---

## Table 2 — Watermark Robustness (FIXED Harness v2)

*Source: `results/phase7_watermark/watermark_robustness.json` (v2_fixed)*  
*Executed: 2026-10-14T17:17:07Z*  
*Pipeline: `generateWatermarkSeed → buildWatermarkRecord → embedWatermark → perturbFn → detectWatermarkInCandidate`*  
*N=5 independent runs per perturbation, 500 synthetic reads × 150 bp*

| Perturbation | Detected | Detection Rate | Mean Score | Score Range |
|---|---|---|---|---|
| P1: Lossless round-trip | 5/5 | **100%** | 1.0000 | 1.00–1.00 |
| P2: Quality jitter ±1 | 0/5 | **0%** | 0.0000 | 0.00–0.00 |
| P3: 5% read substitution | 5/5 | **100%** | 1.0000 | 1.00–1.00 |
| P4: 10% read truncation | 0/5 | **0%** | 0.6293 avg | 0.53–0.67 |
| P5: Quality normalization | 0/5 | **0%** | 0.5094 avg | 0.45–0.59 |

**Suggested paper text:**
> "The GENOMIC_LSB_V1 watermarking scheme achieved 100% detection after a lossless
> round-trip (P1, N=5) and 100% detection after 5% random read substitution (P3, N=5),
> demonstrating that the N=7 majority-vote repetition code successfully tolerates moderate
> read loss. Quality-score jitter of ±1 Phred (P2) and global quality normalization (P5)
> rendered the LSB channel unrecoverable (0% detection), as expected for a scheme that
> encodes information in individual quality-score parity bits. Read truncation of 10%
> (P4) reduced detection to 0% at N=500 reads, yielding partial recovery scores (mean
> 0.63), consistent with an insufficient number of remaining embedding positions to
> complete majority-vote decoding. These results characterize the robustness boundary
> of the LSB scheme and guide operating recommendations."

**Limitation disclosure:**
> "All results were obtained on synthetic FASTQ data (500 reads × 150 bp per run,
> N=5 independent runs). Real genomic FASTQ files with different read-length and
> quality distributions may exhibit different robustness profiles."

---

## Table 3 — FASTQ Quality Impact

*Source: `results/phase7_watermark/fastq_downstream_impact.json`*  
*Executed: 2026-10-14T16:45:33Z | N=5 runs, 1,000 synthetic reads × 150 bp*

| Metric | Value | Threshold | Pass/Fail |
|--------|-------|-----------|-----------|
| Mean \|ΔQuality\| | **0.000440 Phred** | < 1.0 | ✅ PASS |
| 95% CI (Student t, df=4) | [−0.000109, 0.000990] Phred | — | — |
| Q30 rate change | **0.000000** (all 5 runs) | < 0.01 | ✅ PASS |
| DNA bases modified | **None** | — | ✅ PASS |

**Suggested paper text:**
> "Watermark embedding with GENOMIC_LSB_V1 introduced a mean absolute quality-score
> perturbation of 0.000440 Phred (95% CI: [−0.000109, 0.000990]; N=5 runs, 1,000
> synthetic reads × 150 bp). The Q30 base-call rate was unchanged across all runs,
> and no nucleotide bases were modified. The observed perturbation is three orders of
> magnitude below the 1.0 Phred threshold below which quality-score changes are
> considered negligible for BWA alignment and GATK variant calling [citation]."

**Required disclosure:**
> "BWA-MEM2 and GATK4 alignment/variant calling were not performed on these synthetic
> reads. The quality-impact claim is based on magnitude comparison with published
> sensitivity thresholds."

---

## Table 4 — Encryption Overhead

*Source: `results/phase4_blockchain/download_latency.json`*  
*Executed: 2026-10-14T16:45:04Z | N=3 runs (indicative)*  
*V1=AES-256-CBC | V2=AES-256-CBC+HMAC-SHA256 Encrypt-then-MAC*

| File Size | V1 Enc (ms) | V2 Enc (ms) | Overhead | V1 Dec (ms) | V2 Dec (ms) |
|-----------|------------|------------|----------|------------|------------|
| 10 KB | 0.832 | 0.919 | +0.09 ms | 0.115 | 0.221 |
| 100 KB | 1.003 | 0.481 | −0.52 ms† | 0.292 | 0.381 |
| 1024 KB | 2.503 | 5.774 | +3.27 ms | 2.144 | 3.195 |

†Noise at N=3; V1 JIT-inflated run included.

**Suggested paper text:**
> "The Encrypt-then-MAC upgrade (AES-256-CBC + HMAC-SHA256) adds a measured in-process
> overhead of approximately 3.3 ms for 1 MB files (N=3, indicative). End-to-end
> download latency including Azure Blob retrieval and Key Vault key access was not
> benchmarked in this study."

---

## Table 5 — Blockchain Pre-Submission Pipeline

*Source: `results/phase4_blockchain/blockchain_local_latency.json`*  
*Executed: 2026-10-14T17:21:22Z | N=5 runs | Offline stages only*

| Stage | Mean (ms) | Median (ms) | SD (ms) |
|-------|-----------|-------------|---------|
| SHA-256 file hash (1 MB) | 1.587 | 1.244 | 0.867 |
| HMAC owner identity hash | 0.302 | 0.104 | 0.427 |
| Nonce generation | 0.308 | 0.034 | 0.538 |
| ABI encode `registerFile()` | 3.105 | 2.356 | 2.696 |
| Offline transaction signing | 4.199 | 3.114 | 2.797 |

**Not measured (requires funded testnet):** mining latency, `gas_used`, confirmation time

**Suggested paper text:**
> "The pre-submission pipeline — including SHA-256 file hashing, HMAC identity
> derivation, ABI encoding, and transaction signing — completes in under 10 ms
> on the local node (N=5, offline). On-chain confirmation time was not measured
> in this study; nominal Sepolia block time is ≈12 s."

---

## Table 6 — SRA Detection Pipeline Latency

*Source: `results/phase8_sra/sra_local_integration.json`*  
*Executed: 2026-10-14T17:23:01Z | N=5 runs, 500 reads × 150 bp*  
*Mock: local watermarked FASTQ buffer replacing NCBI SRA network retrieval*

| Metric | Value |
|--------|-------|
| Detection rate | **5/5 (100%)** |
| Verification rate (cryptographic commitment) | **5/5 (100%)** |
| Classification | UNAUTHORIZED_REDISTRIBUTION (all 5) |
| `detectWatermarkInCandidate` latency (mean) | **4.41 ms** |
| `detectWatermarkInCandidate` latency (range) | 2.76–6.97 ms |
| FASTQ normalization latency | ~5 ms |

**Suggested paper text:**
> "In a controlled local integration test (N=5), the watermark detection pipeline
> correctly identified all five candidate files as verified matches (100% detection
> and cryptographic verification rate). The `detectWatermarkInCandidate` step
> completed in 2.76–6.97 ms per 500-read FASTQ candidate (N=5). NCBI SRA network
> retrieval and API query latency were not measured in this test."

---

## Table 7 — Security Regression Tests

*Source: `08_SECURITY_REGRESSION/security_results.csv`*

| Category | Tests | Result |
|----------|-------|--------|
| Identity V2 HMAC | 7 | All PASS |
| Encryption V2 MAC | 8 | All PASS |
| Watermark crypto | 4 | All PASS |

---

## Table 8 — Integrity Classification

*Source: `09_INTEGRITY_WALLET/integrity_results.csv`*

| Category | Priority | Result |
|----------|----------|--------|
| SECURE | Lowest | PASS |
| PENDING | Low | PASS |
| BACKUP_UNAVAILABLE | Medium | PASS |
| VERIFICATION_UNAVAILABLE | Medium | PASS |
| PRIMARY_STORAGE_UNAVAILABLE | Medium | PASS |
| KEY_OR_DECRYPTION_FAILURE | High | PASS |
| INTEGRITY_VIOLATION | Highest (wins) | PASS |

---

## Items That Cannot Be Cited

| Item | Status |
|------|--------|
| Azure–IPFS byte comparison | 🚫 Not measured |
| `registerFile()` mining latency | 🚫 Not measured |
| `gas_used` from receipt | 🚫 Not measured |
| BWA/GATK alignment results | ⚠️ Not tested — inference from literature only |
| NCBI SRA network throughput | ⚠️ Not tested — local mock only |
