# FASTQ Impact Analysis

## Summary Statistics (N=5 runs, 1000 reads × 150 bp, Phred units)

| Metric                | Value          |
|-----------------------|----------------|
| Mean |ΔQuality|       | 0.000480 Phred |
| Median |ΔQuality|     | 0.000600 Phred |
| SD                    | 0.000194 Phred |
| Min (run-level)       | 0.000200 Phred |
| Max (run-level)       | 0.000700 Phred |
| 95% CI (t, df=4)      | [0.000257, 0.000703] Phred |
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
0.0005 Phred across the tested synthetic dataset — roughly four orders
of magnitude below the 1.0 Phred threshold. The Q30 rate is unchanged across all 5 runs.

## Limitations

1. N=5 is a small sample. The CI is preliminary.
2. All data is synthetic. Real FASTQ files may have different quality-score distributions.
3. Downstream tools (BWA, GATK, FastQC) were NOT run. Tool compatibility is NOT claimed.
4. The experiment measures quality perturbation at a population level, not per-read.
