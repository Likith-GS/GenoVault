# GenoVault Evidence Index

**Campaign:** EVIDENCE_2026-10-14  
**Root:** D:\\ONE DRIVE\\OneDrive\\MY PROJECT\\MY PROJECT\\Major Project\\EVIDENCE_2026-10-14\\

| File | Description | Status |
|------|-------------|--------|
| [00_PROJECT_AND_EXPERIMENT_INVENTORY.md](00_PROJECT_AND_EXPERIMENT_INVENTORY.md) | Project inventory, versions, env vars | ✅ |
| [01_TEST_RESULTS/test_summary.json](01_TEST_RESULTS/test_summary.json) | Jest test summary (54 tests) | ✅ |
| [01_TEST_RESULTS/test_summary.csv](01_TEST_RESULTS/test_summary.csv) | Suite-level CSV | ✅ |
| [01_TEST_RESULTS/individual_test_results.csv](01_TEST_RESULTS/individual_test_results.csv) | All 54 test outcomes | ✅ |
| [01_TEST_RESULTS/failed_and_skipped_tests.md](01_TEST_RESULTS/failed_and_skipped_tests.md) | Zero failures | ✅ |
| [01_TEST_RESULTS/test_execution_environment.md](01_TEST_RESULTS/test_execution_environment.md) | Node/OS/Jest versions | ✅ |
| [02_WATERMARK_ROBUSTNESS/robustness_results.json](02_WATERMARK_ROBUSTNESS/robustness_results.json) | Harness output — harness flaw noted | ⚠️ |
| [02_WATERMARK_ROBUSTNESS/robustness_results.csv](02_WATERMARK_ROBUSTNESS/robustness_results.csv) | CSV — harness flaw noted | ⚠️ |
| [02_WATERMARK_ROBUSTNESS/robustness_methodology.md](02_WATERMARK_ROBUSTNESS/robustness_methodology.md) | Methodology | ✅ |
| [02_WATERMARK_ROBUSTNESS/robustness_failures.md](02_WATERMARK_ROBUSTNESS/robustness_failures.md) | Harness design issue analysis | ✅ |
| [03_FASTQ_IMPACT/fastq_run_results.csv](03_FASTQ_IMPACT/fastq_run_results.csv) | 5 run-level measurements | ✅ |
| [03_FASTQ_IMPACT/fastq_summary.json](03_FASTQ_IMPACT/fastq_summary.json) | Stats + CI | ✅ |
| [03_FASTQ_IMPACT/fastq_methodology.md](03_FASTQ_IMPACT/fastq_methodology.md) | Methodology | ✅ |
| [03_FASTQ_IMPACT/fastq_analysis.md](03_FASTQ_IMPACT/fastq_analysis.md) | Analysis + limitations | ✅ |
| [04_ENCRYPTION_PERFORMANCE/encryption_run_results.csv](04_ENCRYPTION_PERFORMANCE/encryption_run_results.csv) | Raw timings N=3 | ✅ |
| [04_ENCRYPTION_PERFORMANCE/encryption_summary.json](04_ENCRYPTION_PERFORMANCE/encryption_summary.json) | Stats by size/version | ✅ |
| [04_ENCRYPTION_PERFORMANCE/download_overhead.json](04_ENCRYPTION_PERFORMANCE/download_overhead.json) | V2 vs V1 overhead | ✅ |
| [04_ENCRYPTION_PERFORMANCE/performance_methodology.md](04_ENCRYPTION_PERFORMANCE/performance_methodology.md) | Methodology | ✅ |
| [05_BACKUP_COMPARISON/backup_comparison_results.csv](05_BACKUP_COMPARISON/backup_comparison_results.csv) | BLOCKED | 🚫 |
| [05_BACKUP_COMPARISON/backup_comparison_summary.json](05_BACKUP_COMPARISON/backup_comparison_summary.json) | BLOCKED + prerequisites | 🚫 |
| [05_BACKUP_COMPARISON/backup_methodology.md](05_BACKUP_COMPARISON/backup_methodology.md) | Methodology | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_results.csv](06_BLOCKCHAIN_BENCHMARK/blockchain_results.csv) | BLOCKED | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_summary.json](06_BLOCKCHAIN_BENCHMARK/blockchain_summary.json) | BLOCKED + prerequisites | 🚫 |
| [06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md](06_BLOCKCHAIN_BENCHMARK/blockchain_methodology.md) | Methodology + gas estimates (not measured) | 🚫 |
| [07_SRA_BENCHMARK/sra_run_results.csv](07_SRA_BENCHMARK/sra_run_results.csv) | BLOCKED | 🚫 |
| [07_SRA_BENCHMARK/sra_summary.json](07_SRA_BENCHMARK/sra_summary.json) | BLOCKED + stages | 🚫 |
| [07_SRA_BENCHMARK/sra_methodology.md](07_SRA_BENCHMARK/sra_methodology.md) | Methodology | 🚫 |
| [08_SECURITY_REGRESSION/security_results.csv](08_SECURITY_REGRESSION/security_results.csv) | 19 tests | ✅ |
| [08_SECURITY_REGRESSION/security_summary.json](08_SECURITY_REGRESSION/security_summary.json) | Summary | ✅ |
| [08_SECURITY_REGRESSION/security_findings.md](08_SECURITY_REGRESSION/security_findings.md) | Findings narrative | ✅ |
| [09_INTEGRITY_WALLET/integrity_results.csv](09_INTEGRITY_WALLET/integrity_results.csv) | 10 categories | ✅ |
| [09_INTEGRITY_WALLET/integrity_summary.json](09_INTEGRITY_WALLET/integrity_summary.json) | Summary | ✅ |
| [09_INTEGRITY_WALLET/wallet_security_assessment.md](09_INTEGRITY_WALLET/wallet_security_assessment.md) | Wallet control assessment | ✅ |
| [GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md](GENOVAULT_EXPERIMENTAL_EVIDENCE_REPORT.md) | Master report | ✅ |
| [PAPER_READY_RESULTS.md](PAPER_READY_RESULTS.md) | Publication-ready tables | ✅ |

## Status Legend

- ✅ Complete and citable
- ⚠️ Executed but has a known limitation (harness design flaw — see robustness_failures.md)
- 🚫 Blocked — required credentials or infrastructure not available
