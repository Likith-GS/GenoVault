# Watermark Robustness Methodology

## Harness

File: `backend/experiments/watermarkRobustnessHarness.js`  
Command: `node experiments/watermarkRobustnessHarness.js`  
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
