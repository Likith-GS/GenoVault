# Failed and Skipped Tests

**Execution date:** 2026-10-14  
**Command:** `npx jest tests/ --json --outputFile=../results/jest_results_fresh.json`

## Result

**0 tests failed. 0 tests skipped. 0 tests blocked.**

All 54 tests across all 4 suites passed in 26.213 seconds.

## Verification

The raw output from the Jest runner confirms:

```
Test Suites: 4 passed, 4 total
Tests:       54 passed, 54 total
Snapshots:   0 total
Time:        26.213 s
```

## Experiments not covered by the unit test suite

The following experiment categories have no automated unit tests and were instead
evaluated via standalone harnesses or are BLOCKED:

| Category                         | Coverage              |
|----------------------------------|-----------------------|
| Blockchain gas / confirmation    | BLOCKED (credentials) |
| Azure vs IPFS byte comparison    | BLOCKED (credentials) |
| NCBI SRA scan                    | BLOCKED (no public match) |
| Wallet key rotation / recovery   | Not implemented (design recommendation only) |
