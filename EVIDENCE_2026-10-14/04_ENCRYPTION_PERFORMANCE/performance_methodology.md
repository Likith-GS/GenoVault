# Encryption Performance Methodology

## Harness

File: `backend/experiments/downloadBenchmark.js`  
Command: `node experiments/downloadBenchmark.js`  
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
