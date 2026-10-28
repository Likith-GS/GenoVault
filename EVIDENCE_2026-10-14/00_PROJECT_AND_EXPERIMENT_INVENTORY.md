# GenoVault — Project and Experiment Inventory

**Generated:** 2026-10-14T16:43:00Z (IST +05:30)
**Campaign version:** EVIDENCE_2026-10-14

---

## 1. Repository Identification

| Field                | Value                                        |
|----------------------|----------------------------------------------|
| Repository root      | D:\\ONE DRIVE\\OneDrive\\MY PROJECT\\MY PROJECT\\Major Project |
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
