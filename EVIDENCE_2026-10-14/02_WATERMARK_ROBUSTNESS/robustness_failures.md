# Watermark Robustness — Findings and Failures

## Critical Finding: Harness Design Limitation

**Detection rate: 0.0% (0/5) for ALL five perturbations, including P1 (lossless round-trip).**

This is a harness design issue, not a property of the watermark algorithm. Evidence:

1. **P1 (lossless round-trip) also shows 0% detection.** If the watermark algorithm itself
   were broken, this would be expected. However, Jest test WM-06 passes and confirms that
   embed→detect works correctly end-to-end with the real pipeline.

2. **Root cause:** The harness constructs a synthetic WatermarkRecord using:
   `payload = seed % 256` (8-bit value)
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
