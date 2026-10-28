# GenoVault — Complete Technical Project Documentation (Part 1 of 2)

## Project Overview

GenoVault is a secure, decentralized genomic data management and sharing platform.
- Data Owners upload encrypted genomic files (.fastq, .bam, .vcf)
- Researchers browse, request, and (if approved) download those files
- Selected security and access-control events (file registration, access request/approve/reject/revoke) are recorded on Ethereum Sepolia for immutable audit; application state and operational records remain in MongoDB
- GitHub: https://github.com/Mokshith08/GenoVault

---

## 1. Complete Project Architecture

### 1.1 Architecture Layers

`
[Browser: React 18 SPA — localhost:8080]
           |
     HTTPS + JWT Bearer Token
           |
[Backend: Node.js 20 + Express 4 — localhost:5000]
   |              |                     |
[MongoDB Atlas]  [Azure Blob Storage]  [Ethereum Sepolia]
                 [Azure Key Vault]     [GenomicDataRegistry.sol]
                 [Filebase / IPFS]
`

### 1.2 Components Table

| Component | Technology | Location |
|---|---|---|
| Frontend SPA | React 18 + TypeScript + Vite | localhost:8080 |
| Backend API | Node.js 20 + Express 4 | localhost:5000 |
| Database | MongoDB Atlas | cloud.mongodb.com |
| File Storage | Azure Blob Storage | *.blob.core.windows.net |
| Key Storage | Azure Key Vault | *.vault.azure.net |
| Decentralized Backup | Filebase (IPFS) | s3.filebase.com |
| Blockchain | Ethereum Sepolia | via Alchemy RPC |
| Smart Contract | Solidity 0.8.24 | GenomicDataRegistry.sol |
| Email | Nodemailer SMTP | configured in .env |

### 1.3 Communication Between Modules

- Frontend <-> Backend: REST/JSON over HTTPS, JWT in Authorization header
- Frontend <-> Azure Blob: Direct HTTP PUT using write-only SAS token (no backend proxy for file bytes)
- Backend <-> MongoDB: Mongoose ODM over TLS (serverSelectionTimeoutMS:5000)
- Backend <-> Azure Blob: @azure/storage-blob SDK (SharedKeyCredential)
- Backend <-> Azure Key Vault: @azure/keyvault-secrets (ClientSecretCredential)
- Backend <-> Filebase: AWS S3-compatible API (@aws-sdk/client-s3)
- Backend <-> Ethereum: ethers.js v6 via Alchemy/Infura JSON-RPC

### 1.4 Request Lifecycle (every API call)

1. helmet() sets 11 security HTTP headers
2. cors() validates Origin header
3. rateLimit() checks IP request count (100/15min global)
4. express.json({limit:'100kb'}) parses body
5. morgan() logs request (development only)
6. Route handler invoked
7. authMiddleware verifies JWT -> attaches req.user = {userId, role}
8. roleMiddleware checks req.user.role
9. Controller logic executes
10. Response sent to client

### 1.5 Data Lifecycle

File: Browser → SAS token request → Direct Azure upload (plaintext) → confirm-upload called → Background Phase 1 → Encryption V2 (AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC) → encrypted Azure overwrite → Key Vault key + MAC storage → SHA-256(ciphertext) → Blockchain registration → encrypted IPFS backup
(Legacy V1 files: AES-256-CBC only, no MAC — still decrypt correctly via encryptionVersion field)

Access Request: Researcher form -> MongoDB AccessRequest created -> blockchain requestAccess() -> Owner reviews -> Approve/Deny -> MongoDB updated -> blockchain approveAccess()/rejectAccess() -> Researcher: PIN verify -> decrypt in memory -> stream bytes

### 1.6 Architecture Flow Summary

1. Registration + MFA Setup: register -> bcrypt hash -> issue setupToken -> setup-mfa -> TOTP secret -> QR code -> verify-mfa -> mfa_enabled=true
2. Login: email+password+TOTP -> JWT -> httpOnly cookie -> role redirect
3. Owner Upload: SAS token -> direct Azure PUT -> confirm-upload -> async: encrypt -> blockchain -> IPFS
4. Researcher Request: browse catalog -> fill form -> request-access -> MongoDB + blockchain
5. Owner Approves: approve-request -> MongoDB + blockchain approveAccess()
6. Researcher Downloads: verify PIN -> download/:fileId -> decrypt in memory -> stream

---

## 2. Complete Technology Stack

### 2.1 Frontend

| Library | Version | Role |
|---|---|---|
| React | 18.3.1 | UI component framework |
| TypeScript | 5.8.3 | Type safety; catches null errors at compile time |
| Vite | 5.4.19 | Dev server (HMR) + production bundler |
| TailwindCSS | 3.4.17 | Utility-first styling |
| Shadcn/UI + Radix UI | latest | Accessible headless components (Dialog, Select, Tabs, etc.) |
| Framer Motion | 12.38.0 | Animations (card entrances, page transitions, chevron rotation) |
| React Router DOM | 6.30.1 | Client-side routing with nested routes |
| React Hook Form | 7.61.1 | Performant form state (no re-render per keystroke) |
| Zod | 3.25.76 | Schema-based runtime validation |
| TanStack Query | 5.83.0 | Server state management, caching |
| Recharts | 2.15.4 | SVG-based charts on overview dashboard |
| Sonner | 1.7.4 | Toast notifications |
| jsPDF + autotable | 4.2.1 / 5.0.8 | Client-side PDF export of audit logs |
| Lucide React | 0.462.0 | Icon set |
| next-themes | 0.3.0 | Dark/light mode |
| @azure/storage-blob | 12.31.0 | Direct file upload from browser to Azure via SAS |

Why React: Next.js (SSR not needed), Vue.js (less familiar), Angular (too verbose) all rejected.
Why Vite: Sub-second HMR vs Webpack. SWC plugin for fast TypeScript.
Why TypeScript: The r.file.originalName null crash would have been caught at compile time with strict null checks.

### 2.2 Backend

| Library | Version | Role |
|---|---|---|
| Node.js | 20 | Runtime with native crypto module for AES |
| Express.js | 4.21.2 | HTTP framework |
| Mongoose | 8.14.1 | MongoDB ODM with schema validation and populate |
| bcryptjs | 2.4.3 | Password hashing (pure JS, no native bindings) |
| jsonwebtoken | 9.0.2 | JWT issue and verify |
| helmet | 8.0.0 | 11 security HTTP headers in one middleware |
| express-rate-limit | 7.5.0 | IP-based rate limiting |
| cors | 2.8.5 | Cross-origin request handling |
| morgan | 1.10.0 | HTTP request logging (dev only) |
| cookie-parser | 1.4.7 | Parse gv_token httpOnly cookie |
| nodemailer | 8.0.7 | OTP email delivery via SMTP |
| otplib + qrcode | 13.4.0 / 1.5.4 | TOTP MFA + QR code generation |
| uuid | 11.1.1 | Unique blob name generation |
| ethers.js | 6.16.0 | Ethereum interactions (JsonRpcProvider + Wallet + Contract) |
| @aws-sdk/client-s3 | 3.1041.0 | Filebase S3-compatible API for IPFS backup |
| @azure/storage-blob | 12.31.0 | SAS generation + blob read/write |
| @azure/keyvault-secrets | 4.11.2 | AES key and PIN hash storage in Key Vault |
| @azure/identity | 4.13.1 | Service Principal auth (ClientSecretCredential) |

### 2.3 Database: MongoDB Atlas

Document model; flexible schema (20+ fields added iteratively without migrations).
Collections: users, genomicfiles, accessrequests, otps.
Does NOT store file bytes (those are in Azure Blob).
Alternatives rejected: PostgreSQL (joins for nested researcher profile), Firebase (vendor lock-in).
Pain point during development: Atlas IP whitelist must be updated when ISP IP changes.

### 2.4 Blockchain Stack

| Tool | Role |
|---|---|
| Solidity 0.8.24 | Smart contract language |
| Hardhat | Compile and deploy to Sepolia |
| ethers.js v6 | Backend contract interaction |
| Ethereum Sepolia Testnet | Chain ID: 11155111 |
| Alchemy / Infura | RPC provider |
| Etherscan Sepolia | Block explorer (https://sepolia.etherscan.io) |

### 2.5 Cloud Services

| Service | SDK | Role |
|---|---|---|
| Azure Blob Storage | @azure/storage-blob | Primary encrypted file storage |
| Azure Key Vault | @azure/keyvault-secrets | AES-256 keys and bcrypt PIN hashes |
| Filebase (IPFS) | @aws-sdk/client-s3 | Decentralized encrypted backup, CID |

---

## 3. Module-Wise Explanation

### 3.1 Authentication Module

Files: authController.js, mfaController.js, otpController.js, User.js, OTP.js, Login.tsx, Register.tsx, AuthContext.tsx

Inputs: {name,email,password,role} for register; {email,password} + TOTP for login
Outputs: JWT token + httpOnly cookie + {id,name,email,role,pinSet,mfa_enabled,profileCompleted,age,gender,country}

Internal Logic:
1. Register: validate -> User.create() (bcrypt pre-save) -> issue setupToken
2. Login: findOne(email) -> comparePassword(bcrypt) -> update lastLogin -> generateToken -> set httpOnly cookie
3. MFA Setup: authenticator.generateSecret() -> save mfa_secret -> otpauth:// URI -> qrcode.toDataURL() -> base64 PNG
4. MFA Verify: authenticator.verify({token,secret}) -> mfa_enabled=true
5. Forgot Password: 6-digit OTP -> OTP.create() -> sendOTPEmail() -> always 200 (prevents email enumeration)
6. Reset Password: validate OTP -> delete OTP -> hash new password -> User.update()

Security: password select:false; same error for wrong email AND wrong password; httpOnly cookie; rate limiter 5/15min on MFA.

### 3.2 File Management Module

Files: fileController.js, azureService.js, encryptionService.js, keyVaultService.js, ipfsService.js, blockchainService.js, GenomicFile.js, Upload.tsx

Upload Flow:
1. GET /api/files/get-upload-url: validate ext -> generate blobName -> 120-min SAS -> return sasUrl
2. Browser uploads directly to Azure with SAS (no backend involvement)
3. POST /api/files/confirm-upload: verifyBlobExists -> getBlobProperties -> GenomicFile.create -> RESPOND 200 immediately
4. Background Phase 1 (Encrypt-then-MAC V2): downloadBlobToBuffer -> generateKey -> generateIV -> encryptBufferV2(plain, keyHex, ivHex) -> {ciphertext, mac} -> uploadEncryptedBuffer -> storeEncryptionKey -> update isEncrypted:true, encryptionIv, encryptionMac, encryptionVersion:'v2'
5. Background Phase 2: SHA-256(ciphertext) -> registerFileOnChain -> tx.wait(1) -> update blockchain fields
6. Background Phase 3: uploadToIPFS(ciphertext) -> getCID -> update ipfsCid/ipfsStatus:done

Allowed types: .fastq, .bam, .vcf
Blob naming: {timestamp}_{12char UUID}.{ext}
Dataset ID: GV-{(Date.now() % 9000) + 1000} = GV-1000 to GV-9999

Key design: Background job runs AFTER HTTP response. User sees "Upload complete!" immediately.

### 3.3 Access Control Module

Files: accessController.js, AccessRequest.js, Requests.tsx, MyRequests.tsx, RequestAccessForm.tsx, AccessedData.tsx

Status lifecycle:
  pending -> approved (owner approves) -> revoked (owner revokes)
  pending -> denied (owner denies)
  pending -> more-info (owner asks) -> pending (researcher resubmits)

Cooldown rules:
- After denial: 24-hour wait before re-request
- Pending/more-info status: cannot re-request
- Active approved (not expired): cannot re-request
- Expired approved: can immediately re-request

Request Fields: projectTitle, purpose (max 2000), accessType (read-only/downloadable), institution, contactEmail, benefits (max 500), risks (max 500), dataSharedWithCollaborators, extensionRequested

Download gate: approved + not expired + accessType=downloadable + correct 6-digit PIN

CRITICAL BUG FIXED: populate() returns null for deleted file/user refs -> r.file.originalName -> TypeError crashed React silently (blank screen). Fixed: backend filter(r => r.file != null) + frontend if(!req.file || !req.owner) return null.

### 3.4 Blockchain Module

Files: GenomicDataRegistry.sol, blockchainService.js, blockchainController.js

Key design: Single system wallet. No MetaMask. No user ETH. Backend JWT+MongoDB is the real auth gate; blockchain is the recording layer. Blockchain interactions are non-blocking (async/setImmediate); errors log a warning but do NOT crash the backend.

Researcher identity: V1 = keccak256(ORCID) [legacy]; V2 = HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, ORCID) [default]. Both produce a bytes32 on-chain identifier. V2 prevents dictionary-style mapping: ORCID identifiers are structured and publicly enumerable, so unsalted hashing does not provide strong protection against offline mapping from a known ORCID list.

### 3.5 Audit Module

Files: auditController.js, Audit.tsx, AuditLogs.tsx

Queries: queryFilter for all 5 event types (FileRegistered, AccessRequested, AccessApproved, AccessRejected, AccessRevoked) sorted by blockNumber. PDF export via jsPDF + autotable.

### 3.6 Dataset Catalog Module

Researcher browses all "Available" genomic files with filter/search. Fields shown: ID, filename, genome build, sequencing type, quality score, size, phenotype tags. Opens RequestAccessForm modal.

### 3.7 Profile and Settings Module

Owner profile: name, email, age, gender, country (anonymized context for researchers).
Researcher profile (MongoDB sub-document): institution, department, designation, researchArea, experience, country, phone, linkedIn, orcid (0000-XXXX-XXXX-XXXX), bio (max 500), purpose (max 500).
Profile completion modal forces researchers to complete profile on first login. profileCompleted flag in MongoDB.

### 3.8 MFA Module

setup-mfa -> authenticator.generateSecret() -> QR code PNG base64.
User scans with Google Authenticator / Authy.
verify-mfa -> authenticator.verify({token, secret}) -> mfa_enabled=true.
On each login: prompt TOTP after password, before JWT issued.

---

## 4. Working of Every Unit

### server.js Startup Sequence
1. connectDB() - MongoDB Atlas connection
2. Crash recovery: reset GenomicFile ipfsStatus:"uploading" to "failed"
3. ensureContainerExists() - auto-create Azure Blob container
4. configureCors() - set Azure CORS rules for browser direct upload (24h cache)
5. Apply: helmet, cors, rate limiters, body parsers, morgan
6. Mount routes: /api/auth, /api/otp, /api/files, /api/access, /api/blockchain, /api/audit
7. GET /api/health - health check endpoint
8. 404 and global error handlers
9. Listen on PORT (default 5000)

### authMiddleware.js
Read JWT from "Authorization: Bearer <token>" header OR gv_token cookie.
jwt.verify(token, JWT_SECRET) -> req.user = {userId, role}.
Return 401 if missing, expired, or invalid.

### User.js Model
- Pre-save hook: bcrypt.hash(password, rounds) when password modified
- Instance method comparePassword: bcrypt.compare(candidate, hash) - constant time
- toJSON transform: removes password, mfa_secret, __v from all API responses
- Unique index on email
- select:false on password and mfa_secret

### GenomicFile.js Model
Key fields: owner(ref User), originalName, storedName, extension, sizeBytes, azureBlobName, azureContainerName, cloudUrl, ipfsCid, ipfsUrl, ipfsStatus(pending/uploading/done/failed), isEncrypted(bool), encryptionIv(select:false), blockchainFileId/TxHash/BlockNum/FileHash/Timestamp, genomeBuild, sequencingType, riskCategory, qualityScore, detectedVariants[], predictedRisks[], phenotype[], datasetId(GV-XXXX), availability
Index: {owner:1, createdAt:-1}

### AccessRequest.js Model
Key fields: file(ref), researcher(ref), owner(ref denorm), projectTitle, purpose, accessType, institution, contactEmail, benefits, risks, dataSharedWithCollaborators, extensionRequested, ownerNote, status, approvedAt, accessExpiresAt
Blockchain receipt fields — DECOUPLED per transition (request/approve/reject/revoke), each storing:
  blockchainXxxTxHash, blockchainXxxBlockNumber, blockchainXxxGasUsed, blockchainXxxTxStatus, blockchainXxxEtherscanUrl
BlockchainStatus per transition (enum: PENDING, SUBMITTED, CONFIRMED, FAILED) — tracks blockchain state independently of MongoDB status. Both state machines remain decoupled: MongoDB status drives UI; BlockchainStatus tracks on-chain confirmation.
identityVersion: 'v1'|'v2' — records which ORCID hashing scheme was used for this request.
Unique compound index: {file:1, researcher:1}
Status enum: pending, approved, denied, rejected, revoked, more-info

### encryptionService.js (pure Node.js native crypto, zero dependencies)
- generateKey(): crypto.randomBytes(32).toString('hex') = 64-char hex = 256-bit AES key
- generateIV(): crypto.randomBytes(16).toString('hex') = 32-char hex = 128-bit IV
- encryptBuffer(plain, keyHex, ivHex): V1 — AES-256-CBC only (PKCS7 padding) — legacy support
- decryptBuffer(enc, keyHex, ivHex): V1 decrypt (remove PKCS7 padding)
- encryptBufferV2(plain, keyHex, ivHex): V2 — AES-256-CBC then HMAC-SHA256 over IV||ciphertext (Encrypt-then-MAC). Returns {ciphertext, mac}.
- decryptBufferV2(enc, keyHex, ivHex, expectedMacHex): verifies HMAC-SHA256 BEFORE decrypting (constant-time timingSafeEqual); throws if MAC invalid. Prevents oracle attacks.
- _deriveMacKey(encKey): HKDF-expand: HMAC-SHA256(encKey, 'GenoVault-MAC-v1') — separate key for MAC from encryption key
- decryptPartialBuffer(chunk, keyHex, ivHex): setAutoPadding(false) -> update only (for file preview)
- streamToBuffer(stream): collect async iterator chunks -> Buffer.concat

### azureService.js
- generateUploadSasToken(blobName, 120): BlobSASPermissions{write:true,create:true}; startsOn=now-2min (clock skew); expiresOn=now+120min
- verifyBlobExists(blobName): blobClient.exists()
- getBlobProperties(blobName): returns {sizeBytes, mimeType}
- configureCors(): setProperties({cors:[{allowedOrigins:'*', maxAgeInSeconds:86400}]}) - prevents OPTIONS preflight per block upload
- uploadEncryptedBuffer(blobName, buf): blockBlobClient.uploadData(buf) - overwrites blob with ciphertext
- downloadBlobToBuffer(blobName): download(0) -> async iterator -> Buffer.concat(chunks)

### keyVaultService.js
- Naming: genovault-key-{fileId}, genovault-pin-{userId}
- Auth: ClientSecretCredential(tenantId, clientId, clientSecret)
- Dev fallback: in-memory Map if AZURE_KEY_VAULT_URI not configured (LOST ON RESTART - warns in console)
- storeEncryptionKey(fileId, keyHex): client.setSecret(name, keyHex, {tags:{fileId,project,purpose}})
- retrieveEncryptionKey(fileId): client.getSecret(name) -> secret.value (64-char hex)
- deleteEncryptionKey(fileId): client.beginDeleteSecret(name) - 90-day soft delete
- storePinHash/retrievePinHash/deletePinHash: same pattern for bcrypt PIN hashes

### ipfsService.js
Small files (<=20MB): PutObjectCommand -> read x-amz-meta-cid header via custom middleware -> fallback HeadObject
Large files (>20MB): CreateMultipartUpload -> slice into 8MB parts -> 4 concurrent per batch via Promise.all -> CompleteMultipartUpload -> poll HeadObject up to 6 times with 1.5s backoff -> on error: AbortMultipartUpload
Buffer reuse: accepts encryptedBuffer from Phase 1, skips Azure re-download

### blockchainService.js
- Lazy singleton: getContract() = JsonRpcProvider + Wallet(privKey) + Contract(address, abi, signer)
- orcidToBytes32(orcid) [V1]: ethers.keccak256(ethers.toUtf8Bytes(orcid.trim())) — legacy only
- orcidToBytes32Hmac(orcid) [V2 — default]: HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, orcid.trim()) — prevents dictionary-style mapping from known ORCID lists (ORCID format is publicly enumerable; unsalted keccak256 does not resist offline mapping)
- parseReceipt(receipt, blockTimestamp): txHash, blockNumber, gasUsed, status, etherscanUrl
- registerFileOnChain: contract.registerFile(hash, cid) -> tx.wait(1) -> parse FileRegistered event -> return fileId
- requestAccess/approveAccess/rejectAccess/revokeAccess: uses orcidToBytes32Hmac by default -> call -> wait -> parse receipt; all calls wrapped in try/catch — blockchain errors do NOT crash the backend
- getAuditTrail(fileId): queryFilter for all 5 event types -> sort by blockNumber -> unified array
- getBlockchainStatus: {configured, nodeOnline, contractAddress, chainId, blockNumber, totalRecords}

### walletSecurityService.js (NEW — R3.3)
- Called at server startup (before routes are mounted)
- Validates BLOCKCHAIN_DEPLOYER_PRIVATE_KEY format (must be 64-char hex, optionally 0x-prefixed)
- Checks wallet balance via provider.getBalance(); warns if < LOW_BALANCE_THRESHOLD_ETH
- If key format is invalid: logs CRITICAL error and process.exit(1) — prevents operation with bad credentials
- All checks are non-blocking beyond startup validation

---

## 5. Blockchain (Very Detailed)

### 5.1 Why Blockchain

Genomic data uniquely identifies individuals. Centralized logs can be altered. Blockchain provides:
1. Immutability: confirmed transactions cannot be changed
2. Transparency: anyone can verify with contract address, no trust in GenoVault servers
3. Tamper Detection: SHA-256 of encrypted file stored on-chain; Azure blob change = hash mismatch
4. Audit Trail: selected events (FileRegistered, AccessRequested, Approved, Rejected, Revoked) time-stamped by block (cannot be backdated); application-level events (download, more-info, rate limits) stored in MongoDB AuditLog
5. Consent Management: access permissions with expiry on-chain; survives DB compromise

### 5.2 Network Details

- Network: Ethereum Sepolia Testnet
- Chain ID: 11155111
- Native currency: SepoliaETH (free test ETH from faucets)
- Block time: ~12 seconds
- Consensus: Proof of Stake (post-Merge, Sep 2022)
- RPC: https://eth-sepolia.g.alchemy.com/v2/{API_KEY}
- Explorer: https://sepolia.etherscan.io

### 5.3 Single System Wallet Architecture

All transactions signed by one deployer wallet (private key in .env as BLOCKCHAIN_DEPLOYER_PRIVATE_KEY).
No MetaMask needed. No gas fees for users. No private key management for users.
Backend JWT+MongoDB = the real authorization gate.
Smart contract trusts ONLY systemWallet (enforced by onlySystem modifier).

### 5.4 Smart Contract: GenomicDataRegistry.sol

Solidity 0.8.24, SPDX: MIT

STATE VARIABLES:
  address public systemWallet
  mapping(uint256 => FileRecord) private _files              // fileId -> record
  mapping(string  => uint256)    private _hashToId           // sha256 -> fileId
  mapping(uint256 => mapping(bytes32 => AccessRequest))      // fileId -> researcherId -> request
  mapping(uint256 => bytes32[]) private _requesters          // fileId -> researcherIds list
  mapping(uint256 => mapping(bytes32 => AccessPermission))   // fileId -> researcherId -> permission
  uint256 private _totalRecords

STRUCTS:
  FileRecord { string fileHash, uint256 timestamp, string ipfsCID, bool exists }
  AccessRequest { bytes32 researcherId, uint256 requestedAt, RequestStatus status }
  AccessPermission { bool approved, uint256 grantedAt, uint256 expiryTime }

ENUM:
  RequestStatus { None, Pending, Approved, Rejected }

EVENTS:
  FileRegistered(uint256 indexed fileId, string fileHash, string ipfsCID, uint256 timestamp)
  AccessRequested(uint256 indexed fileId, bytes32 indexed researcherId, uint256 requestedAt)
  AccessApproved(uint256 indexed fileId, bytes32 indexed researcherId, uint256 expiryTime, uint256 grantedAt)
  AccessRejected(uint256 indexed fileId, bytes32 indexed researcherId, uint256 rejectedAt)
  AccessRevoked(uint256 indexed fileId, bytes32 indexed researcherId, uint256 revokedAt)

CUSTOM ERRORS (gas-efficient vs revert strings):
  FileNotFound(uint256 fileId)
  HashAlreadyRegistered(string fileHash)
  InvalidHash()
  RequestNotPending(uint256 fileId, bytes32 researcherId)
  NoApprovedPermission(uint256 fileId, bytes32 researcherId)

WRITE FUNCTIONS (onlySystem modifier):
  registerFile(fileHash, ipfsCID):
    validate 64-char hash -> check not duplicate -> _totalRecords++ -> store FileRecord
    -> _hashToId[hash]=fileId -> emit FileRegistered -> return fileId

  requestAccess(fileId, researcherId):
    fileExists check -> append to _requesters if new -> status=Pending
    -> emit AccessRequested

  approveAccess(fileId, researcherId, durationSeconds):
    require status==Pending -> expiry=block.timestamp+durationSeconds
    -> status=Approved -> create AccessPermission -> emit AccessApproved

  rejectAccess(fileId, researcherId):
    require Pending -> status=Rejected -> emit AccessRejected

  revokeAccess(fileId, researcherId):
    require approved==true -> approved=false -> status=None -> emit AccessRevoked

READ FUNCTIONS (no gas off-chain):
  checkAccess(fileId, researcherId) -> (bool hasAccess, uint256 expiryTime)
  getFile(fileId) -> FileRecord
  getFileByHash(fileHash) -> (fileId, FileRecord)
  getFileRequests(fileId) -> AccessRequest[]
  getPermission(fileId, researcherId) -> AccessPermission
  getTotalRecords() -> uint256

### 5.5 ORCID to bytes32

  const researcherId = ethers.keccak256(ethers.toUtf8Bytes(orcid.trim()))
  // "0000-0002-1825-0097" -> fixed 32-byte keccak256 hash
  // Deterministic: same ORCID always -> same bytes32
  // Privacy-preserving: raw ORCID never stored on-chain

### 5.6 Transaction Flow

1. Construct call: contract.approveAccess(fileId, researcherId, 86400)
2. ethers.js signs with system wallet private key
3. Broadcast to Sepolia via RPC provider
4. tx.wait(1): wait 1 block confirmation (~12 seconds)
5. Parse receipt: txHash, blockNumber, gasUsed, status ('success'/'failed')
6. Parse events from receipt.logs using contract ABI
7. Store receipt fields in MongoDB AccessRequest document
8. Generate Etherscan URL: https://sepolia.etherscan.io/tx/{txHash}

### 5.7 File Verification Flow

GET /api/blockchain/verify/{fileId}:
1. Retrieve blockchainFileHash from MongoDB
2. Call contract.getFileByHash(sha256hex) on-chain (read, no gas)
3. If found: verified=true + on-chain timestamp + IPFS CID + blockNumber
4. If not found: verified=false
5. If Azure blob tampered: current SHA-256 != registered hash = tampered detected

### 5.8 Gas Estimates (Sepolia=free; mainnet approximate)

  registerFile():  ~60,000-80,000 gas
  requestAccess(): ~50,000 gas
  approveAccess(): ~40,000-60,000 gas
  rejectAccess():  ~40,000 gas
  revokeAccess():  ~40,000 gas
  Custom errors more gas-efficient than revert("string message")

### 5.9 Deployment

  cd blockchain
  npx hardhat compile
  npx hardhat run scripts/deploy.js --network sepolia
  Constructor: takes _systemWallet address
  Contract address -> BLOCKCHAIN_CONTRACT_ADDRESS env var
  Two contracts: GenomicDataRegistry.sol (current v2) and GenomicRegistry.sol (earlier version)

---

## 6. Storage Architecture

### 6.1 Three-Layer Storage Strategy

| Layer | Technology | Content | Purpose |
|---|---|---|---|
| Primary | Azure Blob Storage | Encrypted genomic files | Fast, reliable, enterprise cloud |
| Secondary | IPFS via Filebase | Same encrypted files | Decentralized backup, tamper-evident |
| Metadata | MongoDB Atlas | All file metadata (no bytes) | Queryable, structured, referenced |
| Keys | Azure Key Vault | AES-256 keys, bcrypt PIN hashes | Separated from encrypted data |
| Audit | Ethereum Blockchain | SHA-256 hashes, access events | Immutable historical record |

### 6.2 Azure Blob Storage

Container: genomic-files (private, no public URL access)
Blob naming: {Unix ms timestamp}_{12 random hex chars}.{ext}
CORS: configureCors() on startup sets maxAgeInSeconds:86400 -> browser caches preflight for 24h.
Without CORS config: every block upload triggers OPTIONS preflight -> doubles upload time.

Upload: Backend generates write-only SAS (startsOn=now-2min clock skew, expiresOn=now+120min) -> Browser PUTs blocks directly to Azure
Download: downloadBlobToBuffer -> decryptBuffer in memory -> stream plaintext with Content-Disposition:attachment

### 6.3 Azure Key Vault

Secret naming: genovault-key-{MongoDB fileId}, genovault-pin-{MongoDB userId}
Tags per secret: {fileId/userId, project:"GenoVault", purpose:"aes256-encryption-key"}
Soft delete: 90-day recovery before permanent deletion
Dev fallback: in-memory Map if AZURE_KEY_VAULT_URI not set (LOST ON SERVER RESTART - dev only)
Even if MongoDB is compromised: attacker cannot do offline bcrypt attack without Key Vault access

### 6.4 IPFS via Filebase

Endpoint: https://s3.filebase.com
Gateway: https://ipfs.filebase.io/ipfs/{CID}
CID extraction: x-amz-meta-cid response header via custom AWS SDK middleware; fallback HeadObject
Strategy: <=20MB = single PutObject; >20MB = multipart (8MB parts, 4 concurrent) = ~4x faster
Why encrypted blob: CID uniquely identifies exact bytes; tampering changes CID; CID stored on blockchain

### 6.5 Crash Recovery

On startup: GenomicFile.find({ipfsStatus:"uploading"}) -> reset to "failed" -> users can trigger retry
Prevents permanent "uploading" state after server crash

---

## 7. Security

### 7.1 Authentication Security

  bcrypt rounds: 10 (configurable BCRYPT_ROUNDS)
  Same error for wrong email AND wrong password (prevents enumeration)
  JWT in React state (memory only, NOT localStorage/sessionStorage - XSS protection)
  httpOnly cookie gv_token (inaccessible to JavaScript)
  sameSite:lax cookie (CSRF mitigation)
  JWT expiry: 7 days; cookie expiry: 24 hours

### 7.2 Authorization

  Role check on every protected route (authMiddleware + roleMiddleware)
  Resource ownership: file.owner === req.user.userId enforced in all file endpoints
  Download gate: approved + not expired + accessType=downloadable + PIN verified

### 7.3 Transport Security

  helmet.js: X-Frame-Options:DENY, X-Content-Type-Options:nosniff, Referrer-Policy, CSP, HSTS
  CORS restricted to CLIENT_ORIGIN environment variable (not wildcard in production)
  SAS tokens: write-only, single-blob-scoped, time-limited (120 min), cannot be reused

### 7.4 Encryption

  Scheme: Encrypt-then-MAC (V2) — AES-256-CBC + HMAC-SHA256
    Step 1: AES-256-CBC encrypt plaintext → ciphertext (256-bit key, 128-bit IV, PKCS7 padding)
    Step 2: Compute MAC = HMAC-SHA256(macKey, IV || ciphertext) over the ciphertext
    Step 3: Store {ciphertext, IV, MAC} — MAC stored as encryptionMac in MongoDB
    Decrypt: Verify MAC (constant-time timingSafeEqual) BEFORE decrypting — fail-fast on tamper
    macKey derived from encKey via HMAC-SHA256(encKey, 'GenoVault-MAC-v1') (separate keys)
  V1 (AES-256-CBC only) retained for legacy file backward compatibility
  Per-file unique AES keys (compromise of one key = only one file exposed)
  Keys in Azure Key Vault (separate from encrypted data in Azure Blob)
  IV stored in MongoDB encryptionIv (select:false); MAC stored in encryptionMac
  Decryption only in-memory on backend, never written to disk, never logged
  encryptionVersion field: 'v1' | 'v2' — determines which decrypt path is used

### 7.5 Blockchain Security

  Immutable: Ethereum records cannot be altered after confirmation
  System wallet private key in .env (HSM recommended for production); validated at startup by walletSecurityService.js
  ORCID privacy: V2 default = HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, ORCID) — ORCID identifiers are structured and publicly enumerable; unsalted keccak256 does not protect against dictionary-style offline mapping from a known ORCID list. V1 keccak256 retained for legacy records.
  All events time-stamped by block timestamp (cannot be backdated)
  Blockchain calls are non-blocking: errors are caught and logged; they do NOT crash the backend or block HTTP responses

### 7.6 Rate Limiting

| Limiter | Endpoints | Max | Window |
|---|---|---|---|
| apiLimiter | All /api/* | 100 | 15 min |
| authLimiter | /login, /register | 20 | 15 min |
| mfaLimiter | /verify-mfa | 5 | 15 min |

### 7.7 Input Validation

  File extension: must be in {.fastq, .bam, .vcf} at both SAS generation and confirm-upload
  Body size: express.json({limit:'100kb'}) prevents JSON bomb attacks
  Mongoose schema: maxlength enforced on all text fields
  Email regex: /^\S+@\S+\.\S+$/
  Role enum: validated at registration and enforced by schema
