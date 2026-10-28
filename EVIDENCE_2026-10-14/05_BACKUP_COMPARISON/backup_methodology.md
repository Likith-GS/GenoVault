# Azure vs Filebase/IPFS Backup Comparison Methodology

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

`backend/experiments/azureIpfsComparison.js` — inspected and ready to run once credentials
and a test file are available.

## Note on IPFS CID

An IPFS CID is a content-addressed identifier derived from the file content.
However, the experiment must independently fetch and hash the objects from both
storage backends — not rely on CID matching alone. The CID proves content identity
in the IPFS network if the file is correctly pinned, but an independent SHA-256
comparison provides verifiable evidence in the paper.
