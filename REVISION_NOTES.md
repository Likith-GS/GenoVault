# GenoVault — Major Revision Paper Change Summary

**Project:** GenoVault: A Blockchain-Enabled Framework for Secure Genomic Data Access Control and Provenance Verification  
**Revision Type:** Major (addressing peer review)  
**Implementation Version:** 2.0.0-revision  
**Date:** 2026-09-21

---

## Overview

This document maps each reviewer concern to its exact code implementation.
It is intended for use when writing the paper's revision response letter.

> **Integrity policy:** No experimental numbers in this document are fabricated.
> All performance figures come from running the experiment harnesses under
> `backend/experiments/` on real infrastructure with synthetic (non-patient) data.

---

## Reviewer Concern → Implementation Mapping

### R1.1 — ORCID Identifier Binding (Identity Versioning)

**Concern:** ORCID strings were hashed with Keccak-256 without a secret key,
allowing any party knowing the researcher's ORCID to reproduce the on-chain identifier.

**Implementation:**
- **File:** [`blockchainService.js`](../backend/services/blockchainService.js)
- **Change:** Added `orcidToBytes32Hmac(orcid)` — uses `HMAC-SHA256(secret, orcid)`,
  where `secret` is a 32-byte server-side secret stored in `.env`.
- **Versioning:** `identityVersion: "v1"` (keccak) | `"v2"` (HMAC) stored per `AccessRequest`.
  V1 records remain valid — the server branches on version at verification time.
- **Migration:** V1 blockchain records are immutable and remain valid. New requests
  use V2. The paper now states: *"V2 uses HMAC-SHA256 with a 256-bit server secret,
  preventing ORCID enumeration attacks."*

**Test:** `backend/tests/identity.test.js` — 8 tests covering V1 compat, V2 binding,
  determinism, and secret dependency.

---

### R3.2 — Authenticated Encryption (Encrypt-then-MAC)

**Concern:** AES-256-CBC was used without a MAC, leaving ciphertexts vulnerable
to bit-flipping attacks and unauthenticated modification.

**Clarification in paper:** The revision correctly uses the term **Encrypt-then-MAC**
(not "AEAD") because AES-GCM is not used. The scheme is:
```
MAC_KEY = HKDF(enc_key, salt="genovault-mac-v2", len=32)
ciphertext = AES-256-CBC(key, iv, plaintext)
mac = HMAC-SHA256(MAC_KEY, iv || ciphertext)
stored = { iv, ciphertext, mac, version: "v2" }
```

**Implementation:**
- **File:** [`encryptionService.js`](../backend/services/encryptionService.js)
- **Added:** `encryptBufferV2()`, `decryptBufferV2()` — V2 rejects any file
  with an invalid MAC before decryption begins (MAC-then-check pattern).
- **Schema:** `GenomicFile.encryptionVersion`, `GenomicFile.encryptionMac` fields added.
- **Controller:** New uploads default to V2. Downloads branch on `encryptionVersion`.

**Test:** `backend/tests/encryption.test.js` — 7 tests including tampered MAC rejection
  and V1 legacy decryption.

**Performance overhead:** See `results/phase2_encryption/encryption_v1_v2.json`
  (run `npm run experiment:download`).

---

### R2.3 — Blockchain Transaction State Tracking

**Concern:** The system did not separately track whether individual blockchain
transactions (request, approve, revoke, etc.) were submitted and confirmed.

**Implementation:**
- **File:** [`AccessRequest.js`](../backend/models/AccessRequest.js)
- **Added:** Independent per-transition state machine fields:
  - `requestBlockchainStatus`, `approveBlockchainStatus`,
    `revokeBlockchainStatus`, `keyReleaseBlockchainStatus`
  - Each: `not_submitted → submitted → confirmed | failed`
- **File:** [`accessController.js`](../backend/controllers/accessController.js)
- **Change:** All 4 blockchain transaction blocks now follow the state machine.
  Failures do NOT crash the request flow — they set `*BlockchainStatus = "failed"`
  and log the error non-blocking.

**Paper note:** *"MongoDB `status` and blockchain transaction status are
independent state machines. An application approval does not imply blockchain
confirmation, and vice versa."*

---

### R2.4 — Azure–IPFS Backup Byte Comparison

**Concern:** No mechanism verified that the IPFS backup was byte-identical
to the Azure primary.

**Implementation:**
- **File:** [`backupComparisonController.js`](../backend/controllers/backupComparisonController.js)
- **Endpoint:** `GET /api/integrity/:fileId/backup-comparison`
- **Method:** SHA-256 of Azure blob (streaming) vs SHA-256 of Filebase S3 object
  (streaming). Both computed independently at call time.
- **Results:** `MATCH | MISMATCH | SKIP | ERROR` with hashes in response.

**Experiment:** `results/baseline/azure_ipfs_comparison.json`
  (run `npm run experiment:azureipfs`).

---

### R3.3 — Wallet Configuration Security

**Concern:** No startup validation of wallet/network consistency — a misconfigured
private key or wrong network could silently produce invalid transactions.

**Implementation:**
- **File:** [`walletSecurityService.js`](../backend/services/walletSecurityService.js)
- **File:** [`server.js`](../backend/server.js) — `runStartupValidation()` called before
  route binding.
- **Checks:** Wallet derivable from private key, correct network chainId (11155111),
  `eth_chainId` RPC call, contract deployed at expected address.
- **Policy:** Hard-fail on misconfiguration (prevents silent wrong-network submissions).

---

### R3.4 — Integrity Status Categories

**Concern:** The binary `AT_RISK` status collapsed distinct failure types
(integrity violation, storage unavailable, key failure) into a single label,
making the system unable to distinguish their severity.

**Implementation:**
- **File:** [`integrityController.js`](../backend/controllers/integrityController.js)
- **8 categories:** `SECURE`, `PENDING`, `INTEGRITY_VIOLATION`,
  `KEY_OR_DECRYPTION_FAILURE`, `PRIMARY_STORAGE_UNAVAILABLE`,
  `BACKUP_UNAVAILABLE`, `VERIFICATION_UNAVAILABLE`, `AUTHORIZATION_FAILURE`.
- **Explicit priority rules:** 7-rule chain. Not "worst layer wins" — each
  rule is evaluated in a defined order.
- **Per-layer results always returned** — the `overall` field is a summary
  convenience. Reviewers can inspect each layer independently.

**Paper note:** *"The overall category is a summary convenience only.
Per-layer results are always included in the API response, making
multiple simultaneous failures visible."*

**Test:** `backend/tests/integrity.test.js` — 10 tests covering all 7 priority rules.

---

### R3.5 — Watermark Misuse Classification

**Concern:** Detected misuse events were not classified by type (unauthorized
redistribution vs. post-revocation use vs. policy violation, etc.).

**Implementation:**
- **File:** [`MisuseEvent.js`](../backend/models/MisuseEvent.js) — `misuseType` field
  added (6-value enum).
- **File:** [`misuseDetectionService.js`](../backend/services/misuseDetectionService.js)
  — `classifyMisuseEvent()` function added with 6 priority-ordered rules:
  1. `UNAUTHORIZED_REDISTRIBUTION` — NCBI SRA + HIGH confidence
  2. `POST_REVOCATION_USE` — AccessRequest.status = revoked
  3. `EXPIRED_ACCESS_USE` — approved but accessExpiresAt < now
  4. `POLICY_VIOLATION` — high confidence, non-public source
  5. `SUSPECTED_LEAK` — lower confidence match
  6. `UNCLASSIFIED` — fallback

**Watermark robustness:** `results/phase7_watermark/watermark_robustness.json`
  (run `npm run experiment:robustness`). Tested across 5 perturbation types.

**FASTQ downstream impact:** `results/phase7_watermark/fastq_downstream_impact.json`
  (run `npm run experiment:fastq`). Mean quality delta target: < 1.0 Phred unit.

---

## Running Experiments

All experiments use synthetic data. No real patient genomic data is required.

```bash
cd backend

# Phase 2 — Encryption overhead (AES V1 vs V2)
npm run experiment:download

# Phase 4 — Blockchain latency (requires funded Sepolia wallet)
npm run experiment:blockchain

# Phase 6 — Azure vs Filebase comparison (requires credentials)
npm run experiment:azureipfs

# Phase 10 — Watermark robustness
npm run experiment:robustness

# Phase 11 — FASTQ downstream impact
npm run experiment:fastq

# Phase 9 — Generate consolidated test report
npm run test:json    # run jest tests first
npm run report       # assemble report from test + experiment outputs
```

---

## Unit Test Summary

```bash
cd backend
npm test       # runs all tests in backend/tests/
```

| Test File | Reviewer Items | Tests |
|---|---|---|
| `identity.test.js` | R3.1 | 8 |
| `encryption.test.js` | R3.2 | 7 |
| `integrity.test.js` | R3.4 | 10 |
| `watermark.test.js` | R3.5 | 4 |
| **Total** | | **29** |

---

## Files Changed Summary

| File | Type | Reviewer Item |
|---|---|---|
| `backend/services/blockchainService.js` | MODIFIED | R3.1 |
| `backend/models/AccessRequest.js` | MODIFIED | R3.1, R2.3 |
| `backend/services/encryptionService.js` | MODIFIED | R3.2 |
| `backend/models/GenomicFile.js` | MODIFIED | R3.2 |
| `backend/controllers/fileController.js` | MODIFIED | R3.2 |
| `backend/services/walletSecurityService.js` | NEW | R3.3 |
| `backend/server.js` | MODIFIED | R3.3 |
| `backend/controllers/accessController.js` | MODIFIED | R2.3 |
| `backend/controllers/integrityController.js` | MODIFIED | R3.4 |
| `backend/controllers/backupComparisonController.js` | NEW | R2.4 |
| `backend/routes/integrityRoutes.js` | MODIFIED | R2.4 |
| `backend/models/MisuseEvent.js` | MODIFIED | R3.5 |
| `backend/services/misuseDetectionService.js` | MODIFIED | R3.5 |
| `backend/tests/identity.test.js` | NEW | R3.1 |
| `backend/tests/encryption.test.js` | NEW | R3.2 |
| `backend/tests/integrity.test.js` | NEW | R3.4 |
| `backend/experiments/experimentManifest.js` | NEW | All |
| `backend/experiments/blockchainBenchmark.js` | NEW | R2.3 |
| `backend/experiments/downloadBenchmark.js` | NEW | R3.2 |
| `backend/experiments/azureIpfsComparison.js` | NEW | R2.4 |
| `backend/experiments/watermarkRobustnessHarness.js` | NEW | R3.5 |
| `backend/experiments/fastqDownstreamImpact.js` | NEW | R3.5 |
| `backend/experiments/generateTestReport.js` | NEW | All |
