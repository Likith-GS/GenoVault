# Test Execution Environment

| Field               | Value                          |
|---------------------|--------------------------------|
| Execution timestamp | 2026-10-14T16:43:41Z           |
| Node.js             | v24.11.1                       |
| Jest                | 29.7.0                         |
| OS                  | Windows (win32, x64)           |
| CPU cores           | 4                              |
| RAM                 | 7,991 MB                       |
| Test root           | backend/tests/                 |
| Config              | package.json "jest" block      |
| testTimeout         | 30,000 ms                      |
| testEnvironment     | node                           |
| Command             | npx jest tests/ --json --outputFile=../results/jest_results_fresh.json |
| Total duration      | 26.213 s                       |
| Exit code           | 0                              |

## Notes

- Tests use the project's real service implementations (encryptionService.js, watermarkService.js, etc.)
- .env variables are loaded via dotenv for HMAC secrets required by identity and watermark tests
- No external services (MongoDB, Azure, Sepolia) are contacted during the test run
- Watermark tests use synthetic FASTQ-format text buffers; no real genomic data
