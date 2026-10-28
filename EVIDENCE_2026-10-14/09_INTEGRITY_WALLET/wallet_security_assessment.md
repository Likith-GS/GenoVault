# System Wallet Security Assessment

**Date:** 2026-10-14  
**Source:** Code inspection of backend/services/blockchainService.js and backend/server.js

---

## Implemented and Tested Controls

| Control                          | Implementation Status  | Test Coverage |
|----------------------------------|------------------------|---------------|
| PRIVATE_KEY loaded from .env     | Implemented            | Not unit-tested — startup validation |
| isBlockchainConfigured() check   | Implemented            | Checked in experiments/blockchainBenchmark.js |
| Network validation (chainId)     | Implemented (ethers.js handles) | Not explicitly unit-tested |
| Signer from PRIVATE_KEY          | Implemented (ethers.Wallet) | Not unit-tested |
| JWT secret from .env             | Implemented            | Not unit-tested (auth middleware) |

## Implemented but Not Unit-Tested Controls

| Control                          | Location                  |
|----------------------------------|---------------------------|
| PRIVATE_KEY absent → startup warning | blockchainService.js  |
| Contract address validation      | blockchainService.js      |
| bcrypt PIN hash storage in Key Vault | controllers/fileController.js |

## Documented as Design Recommendations (Not Implemented)

| Control                          | Status          |
|----------------------------------|-----------------|
| Key rotation                     | NOT IMPLEMENTED |
| Wallet compromise containment    | NOT IMPLEMENTED |
| Key backup and recovery          | NOT IMPLEMENTED |
| Hardware wallet / HSM            | NOT IMPLEMENTED |
| Multi-sig transaction threshold  | NOT IMPLEMENTED |

**Important:** Key rotation, recovery, and compromise containment are design-level
recommendations only. No code implements them. They must not be claimed as implemented
security controls in the paper.

## .env File Security

- The .env file is listed in .gitignore — confirmed.
- The .env file is NOT committed to the repository.
- PRIVATE_KEY is present in .env (name confirmed; value not read or logged here).
- All secret variable names are documented in the inventory; no values are exposed.

## Priority Rule (Integrity Classification)

The priority rule is implemented in the integrity service and confirmed by tests:

```
INTEGRITY_VIOLATION > KEY_OR_DECRYPTION_FAILURE > PRIMARY_STORAGE_UNAVAILABLE
> BACKUP_UNAVAILABLE > VERIFICATION_UNAVAILABLE > PENDING > SECURE
```

Tests INT-09 and INT-10 confirm that INTEGRITY_VIOLATION takes precedence over
competing categories in combined failure scenarios.
