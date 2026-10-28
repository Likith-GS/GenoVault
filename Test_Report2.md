# GenoVault — Corrected Test & Experimental Evidence Report

**Project:** GenoVault (Blockchain-Integrated Secure Genomic Data Vault)  
**Campaign:** `EVIDENCE_2026-10-14`  
**Git Commit (HEAD):** `1d7a07ffbaae750d81c5365a170d01afb880e9b3`  
**Report Version:** Corrected (Audit 2026-10-17)  
**Audited:** 2026-10-17 — all statistics recalculated programmatically from raw JSON/CSV files  
**Raw evidence untouched:** Original files in `EVIDENCE_2026-10-14/` and `results/` were NOT modified.

> **Scientific integrity notice:** Every numerical claim in this report is traced to a raw evidence  
> file. Results that cannot be verified from the raw data are marked **UNVERIFIED** or  
> **NOT TESTED**. No results have been fabricated or silently omitted.

---

## Table of Contents

1. [Project Architecture Overview](#1-project-architecture-overview)
2. [Test Execution Environment](#2-test-execution-environment)
3. [Statistical Formulas](#3-statistical-formulas)
4. [Experiment A — Jest Unit Tests (54 Tests)](#4-experiment-a--jest-unit-tests-54-tests)
5. [Experiment B — Watermark Robustness (FIXED v2)](#5-experiment-b--watermark-robustness-fixed-v2)
6. [Experiment C — FASTQ Quality Impact](#6-experiment-c--fastq-quality-impact)
7. [Experiment D — Encryption Performance](#7-experiment-d--encryption-performance)
8. [Experiment E — Azure vs Filebase/IPFS (LOCAL MOCK ONLY)](#8-experiment-e--azure-vs-filebaseipfs-local-mock-only)
9. [Experiment F — Blockchain Pipeline (OFFLINE ONLY)](#9-experiment-f--blockchain-pipeline-offline-only)
10. [Experiment G — SRA Scan (SYNTHETIC LOCAL TEST ONLY)](#10-experiment-g--sra-scan-synthetic-local-test-only)
11. [Security Regression & Integrity Tests](#11-security-regression--integrity-tests)
12. [Wallet Security Assessment](#12-wallet-security-assessment)
13. [Corrections and Evidence Audit Trail](#13-corrections-and-evidence-audit-trail)
14. [Paper-Ready Results (Verified)](#14-paper-ready-results-verified)
15. [Results Safe for Conference Paper](#15-results-safe-for-conference-paper)
16. [Remaining Experimental Gaps](#16-remaining-experimental-gaps)
17. [Evidence File Index](#17-evidence-file-index)

---

## 1. Project Architecture Overview

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js + Express v4.22.1 |
| Frontend | React + Vite + TypeScript |
| Database | MongoDB (mongoose 8.23.1) |
| Encryption V1 | AES-256-CBC |
| Encryption V2 | AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC) |
| Identity V1 | keccak256(ORCID) — deprecated |
| Identity V2 | HMAC-SHA256(ORCID, SECRET) → bytes32 |
| Watermarking | GENOMIC_LSB_V1 — LSB of quality[0] per read |
| Watermark Commitment | SHA-256(watermarkPayload) — anchored on blockchain |
| Primary Storage | Azure Blob Storage |
| Key Management | Azure Key Vault |
| Backup Storage | Filebase/IPFS (S3-compatible) |
| Blockchain | Ethereum Sepolia Testnet (chainId 11155111) |
| Smart Contract | Solidity via ethers.js 6.16.0 |
| Test Runner | Jest 29.7.0 |

---

## 2. Test Execution Environment

| Field | Value | Source |
|-------|-------|--------|
| Timestamp | 2026-10-14T16:43:41Z | `jest_results_fresh.json` |
| Node.js | v24.11.1 | environment file |
| Jest | 29.7.0 | `package.json` |
| OS | Windows (win32, x64) | environment file |
| CPU Cores | 4 | environment file |
| RAM | 7,991 MB | environment file |
| Jest Duration | 26.213 s | `jest_results_fresh.json` |
| Exit Code | 0 | `jest_results_fresh.json` |
| Timing method (experiments) | `process.hrtime.bigint()` — ns resolution | experiment scripts |

> **Accuracy note:** The Jest test suite tests the **repository implementation** in isolation.  
> The term "production codebase" has been corrected throughout — "repository implementation"  
> is accurate for a project not deployed to production.

---

## 3. Statistical Formulas

All statistics below were recalculated from raw data.

**Mean:** $\bar{x} = \frac{1}{N}\sum x_i$

**Sample SD:** $s = \sqrt{\frac{\sum(x_i-\bar{x})^2}{N-1}}$

**Median (N=5):** middle value of sorted array

**95% CI (Student t, df=N-1=4, two-tailed, t_crit=2.776):**

$$\text{CI}_{95\%} = \bar{x} \pm 2.776 \times \frac{s}{\sqrt{N}}$$

> Note: One earlier evidence summary used t_crit=2.571 (incorrect — that is the one-tailed value  
> for df=4). This report uses the correct two-tailed value t_crit=2.776 for df=4.

**V2 Encryption Overhead:** $\text{overhead} = \bar{x}_{V2} - \bar{x}_{V1}$

**Detection Rate:** $DR = \frac{\text{detected}}{N} \times 100\%$

**Watermark Match Score:** $\text{score} = \frac{\text{correctly decoded bits}}{\text{total encoded bits}}$

**HMAC-SHA256 Identity V2:** $\text{id} = \text{HMAC-SHA256}(\text{RESEARCHER\_ID\_HMAC\_SECRET},\; \text{ORCID})$

**Watermark Commitment:** $C = \text{SHA-256}(\text{watermarkPayload})$

**Encrypt-then-MAC V2:**
$$C = \text{AES-256-CBC}(K_{enc}, IV, P) \quad \text{MAC} = \text{HMAC-SHA256}(K_{mac}, IV \| C)$$

---

## 4. Experiment A — Jest Unit Tests (54 Tests)

**Source:** `results/jest_results_fresh.json`  
**Executed:** 2026-10-14T16:43:41Z  
**Verification:** all per-test assertion counts extracted and summed programmatically

### 4.1 Suite-Level Summary

| Suite | Phase | Tests | Passed | Failed | Assertions |
|-------|-------|-------|--------|--------|-----------|
| `identity.test.js` | Phase 1 — Identity Versioning (R3.1) | 7 | 7 | 0 | 12 |
| `encryption.test.js` | Phase 2 — Encrypt-then-MAC (R3.2) | 8 | 8 | 0 | 12 |
| `integrity.test.js` | Phase 5 — Integrity Categories (R3.4) | 10 | 10 | 0 | 37 |
| `watermark.test.js` | Tests 1–29 | 29 | 29 | 0 | 282 |
| **TOTAL** | | **54** | **54** | **0** | **343** |

> **Overlap note:** The "19 security regression tests" and "10 integrity tests" cited elsewhere  
> are **subsets** of these 54 tests, not additive. Total distinct tests = **54**.

### 4.2 Encryption Tests — 8/8 PASS

| # | Test Name | Status | Duration (ms) | Assertions |
|---|-----------|--------|---------------|-----------|
| ENC-01 | V2 encrypt → decrypt round-trip succeeds | PASS | 49 | 1 |
| ENC-02 | V2: modified ciphertext → MAC throws | PASS | 181 | 1 |
| ENC-03 | V2: modified IV → MAC throws | PASS | 1 | 1 |
| ENC-04 | V2: completely wrong MAC hex → throws | PASS | 2 | 1 |
| ENC-05 | V2: incorrect MAC rejected via `timingSafeEqual` | PASS | 1 | 1 |
| ENC-06 | V1 legacy `decryptBuffer` decrypts V1 ciphertext | PASS | 1 | 1 |
| ENC-07 | V1 file without MAC → `decryptBufferV2` throws | PASS | 101 | 1 |
| ENC-08 | `encryptBufferV2` returns 64-char hex MAC field | PASS | 25 | 5 |

### 4.3 Identity Tests — 7/7 PASS

| # | Test Name | Status | Duration (ms) | Assertions |
|---|-----------|--------|---------------|-----------|
| ID-01 | Same ORCID + same secret → same identifier (HMAC determinism) | PASS | 4 | 1 |
| ID-02 | Different ORCID → different identifier | PASS | 1 | 1 |
| ID-03 | Same ORCID + different secret → different identifier | PASS | 1 | 1 |
| ID-04 | Identifier is valid bytes32 (0x-prefixed, 66 chars, hex) | PASS | 4 | 3 |
| ID-05 | Missing `RESEARCHER_ID_HMAC_SECRET` → throws (fail-safe) | PASS | 55 | 1 |
| ID-06 | Raw ORCID string not present in returned identifier | PASS | 1 | 2 |
| ID-07 | V1 keccak256 and V2 HMAC produce different bytes32 for same ORCID | PASS | 98 | 3 |

### 4.4 Integrity Tests — 10/10 PASS

| # | Test Name | Status | Assertions |
|---|-----------|--------|-----------|
| INT-01 | All layers PASS → SECURE | PASS | 1 |
| INT-02 | SHA-256 FAIL → INTEGRITY_VIOLATION | PASS | 1 |
| INT-03 | Azure FAIL → PRIMARY_STORAGE_UNAVAILABLE | PASS | 2 |
| INT-04 | IPFS PENDING + all others PASS → PENDING | PASS | 3 |
| INT-05 | IPFS FAIL → BACKUP_UNAVAILABLE | PASS | 1 |
| INT-06 | Blockchain FAIL → VERIFICATION_UNAVAILABLE | PASS | 1 |
| INT-07 | AES FAIL → KEY_OR_DECRYPTION_FAILURE | PASS | 1 |
| INT-08 | Layer results have required fields | PASS | 25 |
| INT-09 | INTEGRITY_VIOLATION + KEY_OR_DECRYPTION_FAILURE → INTEGRITY_VIOLATION wins | PASS | 1 |
| INT-10 | IPFS PENDING + INTEGRITY_VIOLATION → INTEGRITY_VIOLATION | PASS | 1 |

> **AUTHORIZATION_FAILURE (CORRECTED):** Declared as a constant in `integrity.test.js` line 39  
> but **not used in any test case**. **Not present in the production `deriveOverallCategory()`  
> function**. Status: **NOT IMPLEMENTED. NOT TESTED.**

**Priority rule (confirmed INT-09, INT-10):**
```
INTEGRITY_VIOLATION > KEY_OR_DECRYPTION_FAILURE > PRIMARY_STORAGE_UNAVAILABLE
  > BACKUP_UNAVAILABLE > VERIFICATION_UNAVAILABLE > PENDING > SECURE
```

### 4.5 Watermark Tests — 29/29 PASS

#### Tests 1–14: Functional Tests

| # | Test Name | Status | Duration (ms) | Assertions |
|---|-----------|--------|---------------|-----------|
| WM-01 | `normalizeFASTQ` parses correct number of reads | PASS | 85 | 1 |
| WM-02 | `normalizeFASTQ` read structure has correct fields | PASS | 178 | 20 |
| WM-03 | `embed()` returns a watermarkedBuffer | PASS | 127 | 1 |
| WM-04 | Watermarked buffer differs from original | PASS | 63 | 1 |
| WM-05 | Watermarked FASTQ has same number of lines | PASS | 56 | 1 |
| WM-06 | Watermark detected in watermarked output (verified=true) | PASS | 66 | 1 |
| WM-07 | Detection fails for a different watermark record | PASS | 66 | 1 |
| WM-08 | Detection on non-watermarked buffer returns verified=false | PASS | 67 | 1 |
| WM-09 | `watermarkCommitment` = SHA-256(watermarkPayload) | PASS | 1 | 1 |
| WM-10 | `generateWatermarkSeed` produces unique seeds for different inputs | PASS | 0 | 1 |
| WM-11 | Same inputs → same `watermarkSeed` (HMAC determinism) | PASS | 1 | 1 |
| WM-12 | Different nonces → different seeds | PASS | 6 | 1 |
| WM-13 | `detectWatermarkInCandidate` accepts pre-normalized reads array | PASS | 61 | 1 |
| WM-14 | Sequence data unchanged after watermark embedding | PASS | 75 | 201 |

#### Test 15: Concurrent Downloads

| # | Test Name | Status | Duration (ms) | Assertions |
|---|-----------|--------|---------------|-----------|
| WM-15 | 20 concurrent embeddings: 20 distinct independently-verifiable watermarks | PASS | 360 | 3 |

#### Tests 16–26: Robustness Tests

| # | Test Name | Status | Duration (ms) |
|---|-----------|--------|---------------|
| WM-16 | Missing `WATERMARK_SECRET` → throws | PASS | 34 |
| WM-17 | `embedWatermark` throws for unsupported extension | PASS | 1 |
| WM-18 | `metadataEmbedder` inserts GENOVAULT_WM CO tag in BAM/SAM | PASS | 1 |
| WM-19 | `metadataEmbedder` inserts ##GENOVAULT_WM in VCF | PASS | 1 |
| WM-20 | `metadataEmbedder` detects correct watermarkId in BAM | PASS | 0 |
| WM-21 | `metadataEmbedder` returns verified=false for wrong watermarkId | PASS | 1 |
| WM-22 | `metadataEmbedder` throws for unsupported format | PASS | 5 |
| WM-23 | `detectWatermarkInCandidate` throws if non-Buffer passed for METADATA_V1 | PASS | 2 |
| WM-24 | Small FASTQ (50 reads) still produces a verifiable watermark | PASS | 32 |
| WM-25 | `computeWatermarkedFileHash` equals SHA-256(watermarkedBuffer) | PASS | 28 |
| WM-26 | `generateWatermarkId` returns WM-XXXXXXXX format | PASS | 3 |

#### Tests 27–29: Cryptographic Commitment Tests

| # | Test Name | Status | Duration (ms) | Assertions |
|---|-----------|--------|---------------|-----------|
| WM-27 | Same seed always produces same commitment (determinism) | PASS | 0 | 1 |
| WM-28 | Modified payload → different commitment → detection rejects | PASS | 57 | 1 |
| WM-29 | Seed, payload, commitment are three distinct cryptographic values | PASS | 3 | 11 |

---

## 5. Experiment B — Watermark Robustness (FIXED v2)

**Source:** `results/phase7_watermark/watermark_robustness.json` (version: `v2_fixed`)  
**Executed:** 2026-10-14T17:17:24Z | N=5 per perturbation  
**Verification:** per-run matchScores and detected flags extracted and verified from raw JSON

### 5.1 Methodology

| Parameter | Value |
|-----------|-------|
| Harness version | v2_fixed |
| Synthetic reads | 500 reads × 150 bp per run |
| Data source | `crypto.randomBytes()` — no real patient data |
| Runs per perturbation (N) | 5 |
| Algorithm | GENOMIC_LSB_V1 — 1 LSB bit per read in quality[0] |
| Detection threshold | `verified === true OR matchScore >= 0.85` |

**fixNote:** *"Uses real `embedWatermark()` output. `detectWatermarkInCandidate()` called with  
the identical WatermarkRecord used in embed(). No stub payload construction."*

### 5.2 Original Harness Flaw (preserved for transparency)

The original run showed 0.0% detection for all perturbations including P1 (lossless). Root cause: the harness constructed a synthetic WatermarkRecord using `payload = seed % 256` (8-bit stub), which does not match the production embed() payload structure. This is a **harness design error** — not a defect in the watermarking algorithm. Confirmed by WM-06 (Jest) passing independently.

### 5.3 P3 Verification (Code-Inspected)

**Question:** Does P3 (a) substitute 25 reads with random reads at the same index, (b) remove 25 reads, or (c) perform a different transformation?

**Answer (from `watermarkRobustnessHarness.js` lines 162–192, code inspection):** P3 performs **in-place substitution** — it replaces 25 of 500 reads with freshly-generated random reads *at the same array indices*. The reads array remains length 500. The replacement reads have random quality bytes; the header, plus, and sequence fields are regenerated.

**Why P3 achieves 100% detection:** Position selection uses `readIdx = digest % reads.length` (mod 500). Since reads.length is unchanged, the position mapping is identical. The 25 substituted reads have random quality LSBs at the embedding positions — ~25/500 = 5% of the 448 encoded positions are randomised. With N=7 repetition coding, majority-vote decoding tolerates up to 3 of 7 corrupted copies per payload bit. Assuming random corruption, 5% of positions ≈ 22 positions corrupted across 448 → on average 0.48 corrupted copies per 7-copy group, well below the tolerance threshold. This is not adversarial substitution — it is random noise injection within an unchanged-length array, and the result (100% detection, N=5) is mechanically expected and consistent with the algorithm design.

**P3 is NOT a test of:**
- Read deletion (the array does not shrink — that is P7)
- Adversarial substitution with reads from another genomic source
- Shuffling of read order (that is P6)

### 5.4 Results — v2_fixed (Verified from raw JSON)

| Perturbation | Detected | Rate | Mean Score | Computed SD | Per-run Scores |
|---|---|---|---|---|---|
| P1 — Lossless round-trip | **5/5** | **100%** | 1.0000 | 0.0000 | [1.0, 1.0, 1.0, 1.0, 1.0] |
| P2 — Quality jitter ±1 | **0/5** | **0%** | 0.0000 | 0.0000 | [0.0, 0.0, 0.0, 0.0, 0.0] |
| P3 — 5% read substitution (same-length) | **5/5** | **100%** | 1.0000 | 0.0000 | [1.0, 1.0, 1.0, 1.0, 1.0] |
| P4 — 10% read truncation | **0/5** | **0%** | **0.6094** | **0.0605** | [0.6563, 0.6250, 0.5313, 0.6719, 0.5625] |
| P5 — Quality normalization | **0/5** | **0%** | 0.5094 | 0.0548 | [0.4844, 0.4531, 0.4844, 0.5938, 0.5313] |

> P4 computed mean from raw runs = 0.6094, computed SD = 0.0605.  
> JSON summary states mean=0.609 (rounded), SD=0.054 — raw data is authoritative.

### 5.5 Supplemental Robustness Results — P6, P7, P8

**Source:** `results/phase7_watermark/watermark_robustness_supplemental.json`  
**Campaign:** `EVIDENCE_2026-10-17` | **Executed:** 2026-10-17T14:39:00Z | N=5  
**Data:** SYNTHETIC (crypto.randomBytes()) | 500 reads × 150 bp  
**Same pipeline as v2_fixed harness** — no implementation changes made.

#### P6 — Read Reorder (Fisher-Yates shuffle)

All 500 reads shuffled into a random order. Read count unchanged (500).

**Mechanism of failure:** Position selection computes `readIdx = HMAC(seed, counter) % 500`. Shuffling moves each read to a different array index, so the quality bytes at the expected embedding positions now belong to different reads (which were not watermarked at those positions). The decoder reads random-relative LSBs.

| Run | matchScore | verified |
|-----|-----------|----------|
| 1 | 0.5938 | false |
| 2 | 0.3906 | false |
| 3 | 0.5156 | false |
| 4 | 0.5000 | false |
| 5 | 0.5313 | false |

**Detected: 0/5 (0%) | Mean score: 0.5063 | SD: 0.0738 | Range: [0.3906, 0.5938]**

> Score ~0.5 is consistent with random-chance bit recovery (expected ≈ 0.5 under random noise).

#### P7 — 5% Read Removal (array shrinks)

25 randomly-selected reads deleted. Array shrinks from 500 to 475 reads.

**Mechanism of failure (distinct from P3):** After deletion, `reads.length = 475`. The decoder recomputes `readIdx = HMAC(seed, counter) % 475`, producing a completely different position mapping from the original `% 500`. Every position is potentially wrong — not just the 5% that were deleted.

| Run | matchScore | verified |
|-----|-----------|----------|
| 1 | 0.4219 | false |
| 2 | 0.5313 | false |
| 3 | 0.5000 | false |
| 4 | 0.4844 | false |
| 5 | 0.4844 | false |

**Detected: 0/5 (0%) | Mean score: 0.4844 | SD: 0.0398 | Range: [0.4219, 0.5313]**

> Score ~0.5 again consistent with chance. This is fundamentally different from P3 (substitution): P3 preserves reads.length=500, P7 shrinks it, destroying the entire modulo-based position mapping.

#### P8 — FASTQ Re-serialization (normalizeFASTQ → serializeFASTQ)

Watermarked buffer parsed with `normalizeFASTQ` then re-serialized with `serializeFASTQ` with no other change. Tests whether the parse/serialize cycle preserves LSB-encoded quality bytes exactly.

| Run | matchScore | verified |
|-----|-----------|----------|
| 1 | 1.0000 | true |
| 2 | 1.0000 | true |
| 3 | 1.0000 | true |
| 4 | 1.0000 | true |
| 5 | 1.0000 | true |

**Detected: 5/5 (100%) | Mean score: 1.0000 | SD: 0.0000**

> The parse/serialize round-trip is byte-level lossless for quality scores. This confirms that tools that re-serialize FASTQ using the same format will preserve the watermark, as long as they do not modify quality values.

### 5.6 Updated Limitations Table

| Property | Status | Evidence |
|----------|--------|----------|
| False-positive rate (non-watermarked file detected) | **NOT TESTED** | No experiment run |
| False-negative rate on real genomic FASTQ | **NOT TESTED** | No experiment run |
| Adversarial read substitution | **NOT TESTED** | P3 uses random-byte reads, not adversarial |
| Files with read length ≠ 150 bp | **NOT TESTED** | All experiments: 150 bp fixed |
| Real FASTQ quality distributions | **NOT TESTED** | All experiments: synthetic |
| Read reordering | **0/5 (0%)** ✅ Tested | P6, EVIDENCE_2026-10-17 |
| 5% read removal (shrinks array) | **0/5 (0%)** ✅ Tested | P7, EVIDENCE_2026-10-17 |
| FASTQ re-serialization | **5/5 (100%)** ✅ Tested | P8, EVIDENCE_2026-10-17 |

### 5.7 What Can Be Concluded

- Scheme **correctly embeds and detects** watermarks losslessly (P1: 100%, N=5). ✅
- Scheme **tolerates 5% random noise injection** into reads (P3: 100%, same-length substitution). ✅
- Scheme **survives FASTQ re-serialization** without loss (P8: 100%). ✅
- Scheme is **destroyed by read reordering** (P6: 0%) — position selection is read-index-dependent. ⚠️
- Scheme **fails after 5% read removal** (P7: 0%) — shrinking reads.length breaks all modulo-derived positions. ⚠️
- Scheme is **destroyed by ±1 quality-score jitter** (P2: 0%) — LSB channel is sensitive to parity. ⚠️
- Scheme **fails under 10% read truncation** (P4: 0%, mean score 0.61). ⚠️
- Scheme **fails under quality normalization** (P5: 0%, mean score 0.51). ⚠️
- The watermark is **NOT generally robust**. It survives only lossless transformations, re-serialization, and random in-place quality noise limited to ≤5% of positions.

---

## 6. Experiment C — FASTQ Quality Impact

**Authoritative source:** `EVIDENCE_2026-10-14/03_FASTQ_IMPACT/fastq_summary.json`  
**Raw run data:** `results/phase7_watermark/fastq_downstream_impact.json`  
**Executed:** 2026-10-14T16:45:33Z | N=5

### 6.1 Discrepancy Resolution: 0.000480 vs 0.000440 Phred

Two values appeared in earlier drafts. **Verified answer (programmatic):**

Raw `deltas.meanAbsDiff` values from `fastq_downstream_impact.json`:

| Run | Value (Phred) |
|-----|--------------|
| 1 | 0.0006 |
| 2 | 0.0006 |
| 3 | 0.0007 |
| 4 | 0.0002 |
| 5 | 0.0003 |

$$\bar{x} = \frac{0.0006+0.0006+0.0007+0.0002+0.0003}{5} = \frac{0.0024}{5} = \mathbf{0.000480 \text{ Phred}}$$

**0.000480 Phred is correct.** Confirmed by `fastq_summary.json` (`"mean": 0.00048`). The value 0.000440 was a transcription error in an earlier consolidated draft and has been removed.

### 6.2 Metric Disambiguation (IMPORTANT)

> `deltas.meanAbsDiff` measures the **absolute difference of file-level mean Phred scores**  
> (i.e., `|mean(watermarked) − mean(original)|` per run of 1,000 reads).  
> This is **NOT** the mean absolute per-base quality-score change, which would require  
> summing `|q'_i − q_i|` over all 150,000 bases. Per-base data is not stored in the raw JSON.  
> Both metrics are valid but distinct. All figures here refer to file-level mean differences.

### 6.3 Verified Statistics

| Metric | Value | Method |
|--------|-------|--------|
| N | 5 | raw JSON |
| Mean |ΔMean| | **0.000480 Phred** | arithmetic |
| Sample SD | **0.000217 Phred** | sample SD formula |
| Median | 0.000600 Phred | sorted middle value |
| Min | 0.000200 Phred | run 4 |
| Max | 0.000700 Phred | run 3 |

**95% Confidence Interval** (two-tailed, df=4, t_crit=2.776):

$$\text{margin} = 2.776 \times \frac{0.000217}{\sqrt{5}} = 0.000269 \text{ Phred}$$

$$\boxed{\text{CI}_{95\%} = [0.000211,\; 0.000749] \text{ Phred}}$$

> Earlier evidence used t_crit=2.571 (one-tailed, incorrect). Corrected to t_crit=2.776.  
> N=5 is small — this CI is **preliminary** and should not be cited as a definitive population estimate.

### 6.4 Threshold Comparison (CORRECTED)

$$\text{Ratio} = \frac{1.0}{0.000480} \approx 2{,}083 \times$$

$$\log_{10}(2{,}083) \approx \mathbf{3.32}$$

> **CORRECTION from earlier drafts:** Ratio is ~2,083× (**approximately 3.3 orders of magnitude**),  
> not "four orders of magnitude" (which would imply 10,000×). The conclusion (PASS) is unchanged.

| Metric | Verified Value | Threshold | Result |
|--------|---------------|-----------|--------|
| Mean |ΔMean| | 0.000480 Phred | < 1.0 Phred | ✅ PASS |
| 95% CI | [0.000211, 0.000749] Phred | — | — |
| Q30 rate change | 0.000000 (all 5 runs) | < 0.01 | ✅ PASS |
| DNA bases modified | None | — | ✅ PASS |
| BWA/GATK/FastQC compatibility | NOT TESTED | — | — |

### 6.5 Per-Run Data

| Run | Original Mean (Phred) | WM Mean (Phred) | |ΔMean| | Q30 change |
|-----|-----------------------|-----------------|--------|-----------|
| 1 | 30.0082 | 30.0088 | 0.0006 | 0.000 |
| 2 | 29.9998 | 30.0004 | 0.0006 | 0.000 |
| 3 | 29.9861 | 29.9868 | 0.0007 | 0.000 |
| 4 | 30.0096 | 30.0094 | 0.0002 | 0.000 |
| 5 | 29.9869 | 29.9872 | 0.0003 | 0.000 |

---

## 7. Experiment D — Encryption Performance

**Source:** `results/phase4_blockchain/download_latency.json`  
**Executed:** 2026-10-14T16:45:04Z | N=3 per size (indicative)

### 7.1 Verified Timings and Overhead

| Size | V1 Enc (ms) | V2 Enc (ms) | Enc Overhead | V1 Dec (ms) | V2 Dec (ms) | Dec Overhead |
|------|------------|------------|-------------|------------|------------|-------------|
| 10 KB | 0.832 | 0.919 | +0.087 ms | 0.115 | 0.221 | +0.106 ms |
| 100 KB | 1.003 | 0.481 | −0.522 ms† | 0.292 | 0.381 | +0.089 ms |
| 1024 KB | 2.503 | 5.774 | **+3.271 ms** | 2.144 | 3.195 | +1.051 ms |

†100 KB overhead is negative due to V1 Run 2 JIT-inflation (2.320 ms vs 0.241/0.448 for other runs). All overhead values verified against JSON fields. All differences < 10 ms.

> N=3 is a very small sample. High SD at 10 KB and 100 KB indicates JIT warm-up effects.  
> These timings are **indicative** — statistical claims should not be made from N=3.

---

## 8. Experiment E — Azure vs Filebase/IPFS (LOCAL MOCK ONLY)

**Source:** `results/baseline/azure_ipfs_comparison_local.json`  
**Executed:** 2026-10-14T17:41:28Z | Mode: `LOCAL_IN_PROCESS_MOCK`

> **⚠️ LOCAL MOCK ONLY.** No real network requests were made to Azure or Filebase.  
> `credentialStatus.AZURE_LIVE=true` means credentials are **present**, not that live  
> network I/O occurred. Sub-millisecond timings confirm in-memory buffer operations.  
> These results **cannot** support claims about real Azure or Filebase performance.

### SHA-256 Integrity: 15/15 PASS

| Size | Integrity PASS | Cross-store PASS | Cleanup PASS |
|------|---------------|-----------------|-------------|
| 10 KB (N=5) | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 |
| 100 KB (N=5) | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 |
| 1 MB (N=5) | ✅ 5/5 | ✅ 5/5 | ✅ 5/5 |

**What was validated:** Upload/download/SHA-256 hash check/cross-store hash equivalence logic is correct in-process.

### NOT MEASURED (Live Credentials Required)

- Real Azure/Filebase network round-trip latency
- IPFS CID propagation and gateway retrieval
- Azure SAS token generation and expiry
- Cross-region replication delay
- Storage billing and quota

---

## 9. Experiment F — Blockchain Pipeline (OFFLINE ONLY)

**Sources:** `results/phase4_blockchain/blockchain_local_latency.json` and `blockchain_complete_test.json`  
**Executed:** 2026-10-14 | liveMode=false | Signing uses disposable random wallets

> **⚠️ OFFLINE ONLY.** No transactions submitted to Sepolia. Gas values are calldata-based  
> estimates, not from transaction receipts. Sepolia eth_call returned CALL_EXCEPTION on all  
> 5 reads (expected — synthetic fileId not registered on-chain).

### 9.1 Local Offline Stage Timings (N=5)

| Stage | Mean (ms) | Median (ms) | SD (ms) |
|-------|-----------|-------------|---------|
| SHA-256 file hash (1 MB) | 1.587 | 1.244 | 0.867 |
| HMAC owner identity hash | 0.302 | 0.104 | 0.427 |
| Nonce generation (16 B) | 0.308 | 0.034 | 0.538 |
| ABI encode `registerFile()` | 3.105 | 2.356 | 2.696 |
| Offline transaction signing | 4.199 | 3.114 | 2.797 |

### 9.2 All-Operations Summary (N=5, offline)

| Operation | ABI Enc Mean (ms) | Tx Sign Mean (ms) | Calldata (B) | Gas Est. (min–max) |
|-----------|-------------------|-------------------|--------------|--------------------|
| `registerFile()` | 1.334 | 4.594 | 356 | 24,452–54,452 |
| `verifyFileHash()` | 0.450 | — | 228 | 23,148–53,148 |
| `requestAccess()` | 0.434 | 2.227 | 196 | 22,528–52,528 |
| `approveAccess()` | 0.960 | 2.088 | 196 | 22,528–52,528 |
| `revokeAccess()` | 0.347 | 1.897 | 196 | 22,528–52,528 |

**Full crypto pipeline (N=5) runs:** [13.239, 5.463, 6.479, 4.461, 7.998] ms  
**Computed: mean=7.528 ms, sample SD=3.450 ms, median=6.479 ms**  
(JSON summary states SD=3.086 — discrepancy; computed sample SD from raw runs is authoritative)

> ⚠️ **Gas figures are ESTIMATES** from calldata byte counts. Actual gas_used includes  
> SSTORE/SLOAD costs and requires a real transaction receipt.

### 9.3 NOT MEASURED

| Item | Status |
|------|--------|
| Mining/confirmation latency | 🚫 NOT MEASURED — no live transactions |
| gas_used from receipt | 🚫 NOT MEASURED |
| On-chain confirmation time | 🚫 NOT MEASURED (nominal Sepolia ≈ 12 s/block) |
| Real Sepolia eth_call latency | 🚫 NOT MEASURED (CALL_EXCEPTION on synthetic fileId) |

---

## 10. Experiment G — SRA Scan (SYNTHETIC LOCAL TEST ONLY)

**Source:** `results/phase8_sra/sra_local_integration.json`  
**Executed:** 2026-10-14T17:23:03Z | N=5

> **⚠️ SYNTHETIC LOCAL TEST ONLY.** No NCBI SRA API was called. Input is a locally  
> generated watermarked buffer from `crypto.randomBytes()`. This proves detection  
> and classification pipeline logic is correct on synthetic data only.

### Detection Results

| Run | Detected | Verified | matchScore | Classification | Total (ms) |
|-----|----------|----------|------------|----------------|-----------|
| 1 | ✅ | ✅ | 1.0000 | UNAUTHORIZED_REDISTRIBUTION | 693.97 |
| 2 | ✅ | ✅ | 1.0000 | UNAUTHORIZED_REDISTRIBUTION | 519.67 |
| 3 | ✅ | ✅ | 1.0000 | UNAUTHORIZED_REDISTRIBUTION | 469.01 |
| 4 | ✅ | ✅ | 1.0000 | UNAUTHORIZED_REDISTRIBUTION | 449.71 |
| 5 | ✅ | ✅ | 1.0000 | UNAUTHORIZED_REDISTRIBUTION | 537.68 |

### Operational Latency (normalize + detect only; embed is test-setup overhead)

| Run | normalize (ms) | detect (ms) | norm+detect (ms) |
|-----|---------------|------------|-----------------|
| 1 | 0.3632 | 5.4967 | 5.8599 |
| 2 | 0.4415 | 6.9733 | 7.4148 |
| 3 | 0.3866 | 3.2227 | 3.6093 |
| 4 | 0.2109 | 3.6234 | 3.8343 |
| 5 | 0.2832 | 2.7596 | 3.0428 |
| **Mean** | **0.337** | **4.415** | **4.752** |
| **Range** | 0.211–0.442 | 2.760–6.973 | **3.043–7.415** |

### NOT MEASURED

- Real NCBI SRA API query latency
- SRA FASTQ retrieval latency from NCBI servers
- Detection of watermarks in real SRA accessions
- Multi-record registry scanning throughput

---

## 11. Security Regression & Integrity Tests

**All 19 "security" tests and 10 "integrity" tests are SUBSETS of the 54 Jest tests.**  
Total distinct tests = **54** (not 54+19+10=83).

### Security Subset — 19/19 PASS (from 54 total)

| Category | Tests | Jest IDs |
|----------|-------|---------|
| Identity V2 HMAC | 7 | ID-01 to ID-07 |
| Encryption V2 MAC | 8 | ENC-01 to ENC-08 |
| Watermark Crypto | 4 | WM-09, WM-16, WM-28, WM-29 |
| **Total (subset)** | **19** | |

### Integrity Subset — 10/10 PASS (from 54 total)

All 10 from `integrity.test.js` (INT-01 to INT-10).

### AUTHORIZATION_FAILURE

- **Declared** as a string constant in `integrity.test.js` (line 39).
- **Not used** in any of the 10 test cases.
- **Not present** in the production `deriveOverallCategory()` priority chain.
- **Status: NOT IMPLEMENTED in production service. NOT TESTED.**

---

## 12. Wallet Security Assessment

### Implemented Controls (Verified)

| Control | Status |
|---------|--------|
| `PRIVATE_KEY` from `.env` (not hardcoded) | ✅ Implemented |
| `.env` in `.gitignore`, not committed | ✅ Confirmed |
| `isBlockchainConfigured()` guard | ✅ Implemented |
| HMAC secret required — fails-closed if absent | ✅ Tested (ID-05) |
| WATERMARK_SECRET required — fails-closed | ✅ Tested (WM-16) |
| JWT secret from `.env` | ✅ Implemented (not unit-tested) |
| bcrypt PIN hash storage | ✅ Implemented (not unit-tested) |

### Design Recommendations ONLY — Not Implemented

| Control | Status |
|---------|--------|
| Key rotation | ❌ NOT IMPLEMENTED |
| Wallet compromise containment | ❌ NOT IMPLEMENTED |
| Key backup and recovery | ❌ NOT IMPLEMENTED |
| Hardware wallet / HSM integration | ❌ NOT IMPLEMENTED |
| Multi-sig transaction threshold | ❌ NOT IMPLEMENTED |

> These must NOT be claimed as implemented in any publication.

---

## 13. Corrections and Evidence Audit Trail

### C-1: "Four Orders of Magnitude" → Corrected to ~3.3

| | |
|--|--|
| **Original claim** | "perturbation is four orders of magnitude below 1.0 Phred threshold" |
| **Verified result** | 1.0 / 0.000480 ≈ 2,083× → log₁₀(2083) ≈ **3.32 (~3.3 orders of magnitude)** |
| **Evidence source** | `fastq_downstream_impact.json` raw deltas; arithmetic |
| **Verification method** | Programmatic: sum/N = 0.000480; log₁₀(1/0.000480) = 3.32 |
| **Corrective action** | Replaced "four" with "approximately 3.3" throughout |
| **Remaining gap** | None |

### C-2: FASTQ Mean Discrepancy (0.000480 vs 0.000440) → Resolved

| | |
|--|--|
| **Original claim** | Two conflicting values in the same report |
| **Verified result** | **0.000480 Phred** — arithmetic from raw runs; confirmed in `fastq_summary.json` |
| **Evidence source** | `fastq_downstream_impact.json` runs[*].deltas.meanAbsDiff; `fastq_summary.json` "mean": 0.00048 |
| **Verification method** | Programmatic recalculation |
| **Corrective action** | All instances of 0.000440 removed; 0.000480 is the sole authoritative value |
| **Remaining gap** | None |

### C-3: FASTQ 95% CI — Wrong t_crit (2.571 → 2.776)

| | |
|--|--|
| **Original claim** | 95% CI: [0.000257, 0.000703] using t_crit=2.571 |
| **Verified result** | Correct two-tailed CI (df=4, t_crit=2.776): **[0.000211, 0.000749] Phred** |
| **Evidence source** | `fastq_summary.json` "ci95" block contains t=2.571 (wrong) |
| **Verification method** | Standard t-table: df=4, two-tailed, 95% → t_crit=2.776 |
| **Corrective action** | CI corrected throughout |
| **Remaining gap** | N=5 CI is preliminary; more runs required |

### C-4: Blockchain Full Pipeline SD (3.086 → 3.450)

| | |
|--|--|
| **Original claim** | Full pipeline SD = 3.086 ms (from JSON summary field) |
| **Verified result** | Computed sample SD from raw runs [13.239, 5.463, 6.479, 4.461, 7.998] = **3.450 ms** |
| **Evidence source** | `blockchain_complete_test.json` raw runs array |
| **Verification method** | Sample SD formula applied to all 5 values |
| **Corrective action** | Report now states 3.450 ms with note that JSON summary is incorrect |
| **Remaining gap** | None |

### C-5: "Production Codebase" → "Repository Implementation"

| | |
|--|--|
| **Original claim** | "All 54 unit tests pass on the production codebase" |
| **Verified result** | Project has not been deployed to production |
| **Evidence source** | Project structure inspection |
| **Corrective action** | Replaced "production codebase" with "repository implementation" |
| **Remaining gap** | None |

### C-6: AUTHORIZATION_FAILURE — Corrected Status

| | |
|--|--|
| **Original claim** | Either omitted or incorrectly described |
| **Verified result** | Declared as constant (line 39, `integrity.test.js`); not used in tests; not in production service |
| **Evidence source** | `integrity.test.js` code inspection; grep of `backend/services/` found no match |
| **Corrective action** | Labelled as: NOT IMPLEMENTED in production service. NOT TESTED. |
| **Remaining gap** | Requires deliberate design decision |

### C-7: Double-Counting (19 security + 10 integrity ≠ additive)

| | |
|--|--|
| **Original claim** | Presented as 54 + 19 + 10 in some contexts |
| **Verified result** | 19 security and 10 integrity are subsets of 54 total distinct tests |
| **Evidence source** | `jest_results_fresh.json` numTotalTests=54 |
| **Corrective action** | Added explicit overlap note everywhere subtotals appear |
| **Remaining gap** | None |

### C-8: Azure "AZURE_LIVE=true" — Mock, Not Live

| | |
|--|--|
| **Original claim** | "AZURE_LIVE: true" implied live testing in some summaries |
| **Verified result** | Mode=LOCAL_IN_PROCESS_MOCK; field means credentials present, not live network used |
| **Evidence source** | `azure_ipfs_comparison_local.json` "mode" field |
| **Corrective action** | Added prominent LOCAL MOCK ONLY warning throughout §8 |
| **Remaining gap** | Real Azure/Filebase benchmark requires live credentials |

### C-9: SRA Results — Synthetic, Not Real

| | |
|--|--|
| **Original claim** | Some phrases implied real NCBI searching |
| **Verified result** | NCBI API not called; input is synthetic `crypto.randomBytes()` |
| **Evidence source** | `sra_local_integration.json` description and dataset.source fields |
| **Corrective action** | Added SYNTHETIC LOCAL TEST ONLY labels to §10 |
| **Remaining gap** | Real SRA testing requires NCBI key, public accession, network |

### C-10: Watermark P4 Mean/SD (0.6293/0.054 → 0.6094/0.0605)

| | |
|--|--|
| **Original claim** | P4 mean=0.6293, SD=0.054 |
| **Verified result** | Computed from raw scores [0.6563, 0.6250, 0.5313, 0.6719, 0.5625]: mean=**0.6094**, SD=**0.0605** |
| **Evidence source** | `watermark_robustness.json` per-run matchScore values |
| **Corrective action** | Updated table values; noted JSON summary is rounded |
| **Remaining gap** | None |

### C-11: Watermark False Positive/Negative Gaps — Made Explicit

| | |
|--|--|
| **Original claim** | No explicit acknowledgement of unmeasured robustness properties |
| **Verified result** | False-positive rate, false-negative on real data, adversarial substitution were not measured |
| **Evidence source** | Experiment scope: WatermarkRecord for detection = same record used for embedding |
| **Corrective action** | Added explicit NOT TESTED table (§5.4) |
| **Remaining gap** | Requires separate false-positive experiment |

---

## 14. Paper-Ready Results (Verified)

### Table 1 — Test Suite Results

| Suite | Tests | Passed | Failed |
|-------|-------|--------|--------|
| identity.test.js | 7 | 7 | 0 |
| encryption.test.js | 8 | 8 | 0 |
| integrity.test.js | 10 | 10 | 0 |
| watermark.test.js | 29 | 29 | 0 |
| **TOTAL** | **54** | **54** | **0** |

### Table 2 — Watermark Robustness

| Perturbation | Rate | Mean Score | Computed SD |
|---|---|---|---|
| P1 — Lossless | **100%** | 1.0000 | 0.0000 |
| P2 — Quality jitter ±1 | **0%** | 0.0000 | 0.0000 |
| P3 — 5% read substitution | **100%** | 1.0000 | 0.0000 |
| P4 — 10% read truncation | **0%** | 0.6094 | 0.0605 |
| P5 — Quality normalization | **0%** | 0.5094 | 0.0548 |

### Table 3 — FASTQ Quality Impact (Corrected)

| Metric | Verified Value | Threshold | Pass/Fail |
|--------|---------------|-----------|-----------|
| Mean |ΔMean| | **0.000480 Phred** | < 1.0 | ✅ |
| Sample SD | 0.000217 Phred | — | — |
| 95% CI (t_crit=2.776, df=4) | **[0.000211, 0.000749]** | — | — |
| Magnitude below threshold | ~3.3 orders (2,083×) | — | — |
| Q30 change | 0.000000 | < 0.01 | ✅ |
| DNA modified | None | — | ✅ |
| BWA/GATK | NOT TESTED | — | — |

### Table 4 — Encryption Overhead

| Size | V2 Enc Overhead | V2 Dec Overhead |
|------|----------------|----------------|
| 10 KB | +0.087 ms | +0.106 ms |
| 100 KB | −0.522 ms (noise) | +0.089 ms |
| 1024 KB | +3.271 ms | +1.051 ms |

### Table 5 — Blockchain Offline Stages (N=5)

| Stage | Mean (ms) | Median (ms) |
|-------|-----------|-------------|
| SHA-256 hash | 1.587 | 1.244 |
| HMAC identity | 0.302 | 0.104 |
| Nonce gen | 0.308 | 0.034 |
| ABI encode | 3.105 | 2.356 |
| Sign | 4.199 | 3.114 |
| Full pipeline | 7.528 | 6.479 |

Gas = ESTIMATED. Mining = NOT MEASURED.

### Table 6 — SRA Local Detection (Synthetic)

| Metric | Value |
|--------|-------|
| Detection rate | 5/5 (100%) |
| normalize+detect mean | 4.752 ms |
| normalize+detect range | 3.043–7.415 ms |
| NCBI API called | NO |

### Table 7 — Security Regression (Subset of 54)

| Category | Tests | Pass |
|----------|-------|------|
| Identity HMAC | 7 | 7 |
| Encryption MAC | 8 | 8 |
| Watermark Crypto | 4 | 4 |
| **Subset total** | **19** | **19** |

### Table 8 — Integrity Classification (Subset of 54)

| Category | Tested | Result |
|----------|--------|--------|
| INTEGRITY_VIOLATION | ✅ | PASS |
| KEY_OR_DECRYPTION_FAILURE | ✅ | PASS |
| PRIMARY_STORAGE_UNAVAILABLE | ✅ | PASS |
| BACKUP_UNAVAILABLE | ✅ | PASS |
| VERIFICATION_UNAVAILABLE | ✅ | PASS |
| PENDING | ✅ | PASS |
| SECURE | ✅ | PASS |
| AUTHORIZATION_FAILURE | ❌ NOT TESTED | NOT IMPLEMENTED |

---

## 15. Results Safe for Conference Paper

| Result | Evidence | Required Caveat |
|--------|----------|----------------|
| 54/54 Jest tests PASS | `jest_results_fresh.json` | "repository implementation"; not deployed to production |
| Mean |ΔMean| = 0.000480 Phred, 95% CI [0.000211, 0.000749] | `fastq_downstream_impact.json` | Synthetic data; file-level mean difference, not per-base; N=5 preliminary |
| Q30 rate change = 0 (all 5 runs) | Same | Synthetic data |
| Watermark P1=100%, P3=100%, P2/P4/P5=0% (N=5) | `watermark_robustness.json` v2_fixed | Synthetic data; false-positive rate NOT TESTED |
| V2 encryption overhead ≤ 3.3 ms at 1 MB | `download_latency.json` | N=3; indicative only |
| Blockchain pre-submission < 10 ms offline | `blockchain_local_latency.json` | OFFLINE; no live transactions |
| Azure/IPFS SHA-256 equivalence 15/15 | `azure_ipfs_comparison_local.json` | LOCAL MOCK; no real network |
| SRA detection 5/5 (100%) | `sra_local_integration.json` | SYNTHETIC; no NCBI API |

---

## 16. Remaining Experimental Gaps

| Gap | Experiment Required |
|-----|-------------------|
| Watermark false-positive rate | `detectWatermarkInCandidate` on N≥30 non-watermarked FASTQ; report detected/total |
| Watermark on real genomic FASTQ | Use public SRA FASTQ with known quality distribution |
| BWA/GATK compatibility | Align before/after watermark; compare variant calls |
| Azure/Filebase live benchmark | Live credentials + run azureIpfsComparison.js in live mode |
| Blockchain live latency + gas_used | Funded Sepolia wallet + BLOCKCHAIN_RPC_URL + contract address |
| NCBI SRA live scan | NCBI API key + public SRA accession containing watermarked file |
| AUTHORIZATION_FAILURE | Implement in service OR explicitly remove from documentation |
| Encryption N increase | Rerun with N≥10 to reduce SD impact of JIT warm-up |
| Blockchain pipeline N increase | Rerun with N≥10, first-run excluded for JIT warm-up |

---

## 17. Evidence File Index

### Raw Files (UNTOUCHED)

| File | Citable? |
|------|---------|
| `results/jest_results_fresh.json` | ✅ |
| `results/phase7_watermark/watermark_robustness.json` (v2_fixed) | ✅ |
| `results/phase7_watermark/fastq_downstream_impact.json` | ✅ |
| `EVIDENCE_2026-10-14/03_FASTQ_IMPACT/fastq_summary.json` | ✅ (authoritative FASTQ summary) |
| `results/baseline/azure_ipfs_comparison_local.json` | ✅ with LOCAL MOCK label |
| `results/phase4_blockchain/blockchain_local_latency.json` | ✅ with OFFLINE label |
| `results/phase4_blockchain/blockchain_complete_test.json` | ✅ with OFFLINE label |
| `results/phase4_blockchain/download_latency.json` | ✅ N=3 indicative |
| `results/phase8_sra/sra_local_integration.json` | ✅ with SYNTHETIC label |
| `results/jest_results.json` | ❌ Superseded — do not cite |
| `EVIDENCE_2026-10-14/02_WATERMARK_ROBUSTNESS/robustness_results.json` | ❌ Flawed harness — do not cite |

### Audit Files (This Report)

| File | Description |
|------|-------------|
| `Test_Report.md` (this file) | Corrected master report |
| `scratch/verify_stats.js` | Programmatic verification script |
