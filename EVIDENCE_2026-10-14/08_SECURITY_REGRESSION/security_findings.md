# Security Regression Findings

## Result: All 19 Security-Critical Tests PASS

Executed via: `npx jest tests/ --verbose` on 2026-10-14

## Identity Versioning (R3.1)

| Test  | Assertion                                    | Result |
|-------|----------------------------------------------|--------|
| ID-01 | HMAC-SHA256 determinism                      | PASS   |
| ID-02 | ORCID uniqueness                             | PASS   |
| ID-03 | Secret-key dependency                        | PASS   |
| ID-04 | Valid bytes32 format                         | PASS   |
| ID-05 | Missing secret → fail-safe throw             | PASS   |
| ID-06 | ORCID not in output                          | PASS   |
| ID-07 | V1 ≠ V2 for same ORCID                       | PASS   |

**Security property confirmed:** The V2 HMAC-SHA256 scheme depends on a secret key,
preventing offline dictionary-style mapping from publicly enumerable ORCID identifiers.

## Encryption Security (R3.2)

| Test   | Assertion                                    | Result |
|--------|----------------------------------------------|--------|
| ENC-01 | Round-trip correctness                       | PASS   |
| ENC-02 | Ciphertext tamper → rejection                | PASS   |
| ENC-03 | IV tamper → rejection                        | PASS   |
| ENC-04 | Wrong MAC → rejection                        | PASS   |
| ENC-05 | Constant-time MAC comparison (timingSafeEqual)| PASS  |
| ENC-06 | V1 backward compatibility                    | PASS   |
| ENC-07 | V1 file + V2 decoder (no MAC) → throws       | PASS   |
| ENC-08 | V2 output includes 64-char MAC field         | PASS   |

**Security property confirmed:** Encrypt-then-MAC correctly authenticates both IV and
ciphertext. Any modification to either field is detected before decryption.

## Watermark Cryptographic Integrity

| Test  | Assertion                                    | Result |
|-------|----------------------------------------------|--------|
| WM-09 | Commitment = SHA-256(payload) — verified     | PASS   |
| WM-16 | Missing secret → fail-safe throw             | PASS   |
| WM-28 | Modified payload → different commitment, rejected | PASS |
| WM-29 | Seed, payload, commitment: three distinct values | PASS |

## Credential Handling

No HMAC secrets, encryption keys, ORCID values, private keys, or other sensitive
values appear in test outputs or this report. The identity test console.log at ID-07
prints only the 32-byte hex output identifiers (the hash outputs), not the input
ORCID or secret values.
