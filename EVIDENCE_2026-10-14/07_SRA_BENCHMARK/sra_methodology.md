# NCBI SRA Discovery Scan Methodology

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

`backend/services/misuseDetectionService.js` — contains the detection logic.
The pipeline stages are implemented; an end-to-end integration test against a
controlled local FASTQ is feasible but was not present in the existing harness suite.

## Honest Result

**Zero verified matches found** — because no watermarked file from GenoVault has
been submitted to a public SRA accession in the test environment.

This is the correct outcome for a system in controlled testing.
