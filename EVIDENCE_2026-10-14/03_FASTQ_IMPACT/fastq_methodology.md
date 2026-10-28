# FASTQ Downstream Impact Methodology

## Harness

File: `backend/experiments/fastqDownstreamImpact.js`  
Command: `node experiments/fastqDownstreamImpact.js`  
Executed: 2026-10-14T16:45:33Z  

## Dataset

| Parameter        | Value                          |
|------------------|--------------------------------|
| Data source      | Synthetic — no real patient data |
| Reads per run    | 1,000                          |
| Read length      | 150 bp                         |
| Total bases/run  | 150,000                        |
| Quality range    | [20, 40] Phred (uniform random) |
| Runs             | N = 5                          |

## Embedding

- Algorithm: GENOMIC_LSB_V1
- Method: flip LSB of quality[0] ASCII byte per read to encode 1 payload bit per read
- Maximum theoretical ΔQuality: ±1 Phred unit per modified position

## Metrics Measured

1. Mean absolute quality-score change across all 150,000 bases
2. SD of quality-score change
3. Q30 rate (fraction of bases ≥ Q30) before and after embedding

## Statistical Methods

- Mean, SD, median, min, max computed from N=5 run-level measurements
- 95% CI: Student t-distribution, two-tailed, df=4, t_crit=2.776
- With N=5, the CI is preliminary; wider data collection would be needed for definitive claims

## What Was NOT Tested

- Actual BWA/GATK alignment or variant calling on the synthetic data
- Real FASTQ files from any organism
- Trimming pipelines (trimmomatic, fastp)
- Downstream analysis tool compatibility

These remain NOT TESTED and must not be claimed in the paper.
