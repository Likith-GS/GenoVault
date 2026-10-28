₹2# GenoVault — Complete Technical Project Documentation (Part 2 of 2)

---

## 8. Detailed Workflow

### 8.1 Registration + MFA Setup Flow

STEP 1: POST /api/auth/register
  Body: {name, email, password, role}
  - validateEmail(email)
  - User.findOne(email) -> if exists -> 409 Conflict
  - new User({name, email, password, role}) -> pre-save hook bcrypt.hash -> .save()
  - generateToken(userId, role, 'setupToken', '1h')
  - respond: 201 {setupToken, message:'OTP sent to email'}

STEP 2: POST /api/auth/setup-mfa (Authorization: Bearer setupToken)
  - verify setupToken
  - authenticator.generateSecret() -> base32 secret stored as mfa_secret
  - otpauth://totp/GenoVault:{email}?secret={base32}&issuer=GenoVault
  - qrcode.toDataURL(uri) -> base64 PNG
  - respond: 200 {qrCode, secret, message}

STEP 3: POST /api/auth/verify-mfa (body: {token} - 6 digit TOTP)
  - authenticator.verify({token, secret: user.mfa_secret})
  - if valid: user.mfa_enabled=true; user.save()
  - generateToken(userId, role, 'access') -> set cookie -> respond with profile

### 8.2 Login Flow

STEP 1: POST /api/auth/login
  Body: {email, password}
  - User.findOne(email).select('+password')
  - user.comparePassword(password) -> bcrypt.compare constant time
  - Same generic error for wrong email AND wrong password
  - If mfa_enabled=false: issue JWT immediately (legacy users)
  - If mfa_enabled=true: issue tempToken (15min) -> respond: mfaRequired:true

STEP 2 (if MFA): POST /api/auth/login-mfa
  Body: {token: 6-digit TOTP}
  - verify tempToken
  - authenticator.verify({token, secret: mfa_secret})
  - user.lastLogin = new Date()
  - generateToken(userId, role, 'access') -> set httpOnly cookie gv_token
  - respond: 200 {user profile without password fields}


### 8.3 File Upload Flow

PHASE A (Synchronous, user waits):
STEP 1: GET /api/files/get-upload-url?filename=sample.fastq&fileSize=10485760
  - Check extension: .fastq -> OK
  - blobName = Date.now() + '_' + uuid().replace(/-/g,'').substring(0,12) + '.fastq'
  - generateUploadSasToken(blobName, 120) -> sasUrl
  - respond: 200 {sasUrl, blobName, container}

STEP 2: Browser (@azure/storage-blob): BlockBlobClient.uploadData(file, {blockSize:4MB, concurrency:4})
  - Splits file into 4MB blocks, uploads up to 4 in parallel
  - Azure handles load; all bytes go to Azure, NOT through GenoVault backend
  - Status callbacks: onProgress({loadedBytes}) -> update progress bar UI

STEP 3: POST /api/files/confirm-upload
  Body: {blobName, genomeBuild, sequencingType, sampleDescription, phenotype, riskCategory, availabilityDate, qualityScore, detectedVariants, predictedRisks}
  - verifyBlobExists(blobName) -> if not: 404
  - getBlobProperties(blobName) -> {sizeBytes, mimeType}
  - datasetId = 'GV-' + ((Date.now() % 9000) + 1000)
  - GenomicFile.create({owner:req.user.userId, originalName, storedName:blobName, extension, sizeBytes, genomeBuild, ...metadata})
  - respond: 201 {fileId, datasetId} IMMEDIATELY
  - (async - no await) backgroundEncryptAndRegister(fileId, blobName)

PHASE B (Background - runs after HTTP response):
STEP 4 (Encryption):
  - downloadBlobToBuffer(blobName) -> plainBuffer
  - generateKey() -> 64-char hex keyHex
  - generateIV() -> 32-char hex ivHex
  - encryptBuffer(plainBuffer, keyHex, ivHex) -> encryptedBuffer
  - uploadEncryptedBuffer(blobName, encryptedBuffer) -> overwrites Azure blob
  - storeEncryptionKey(fileId, keyHex) -> Azure Key Vault
  - GenomicFile.findByIdAndUpdate(fileId, {encryptionIv:ivHex, isEncrypted:true})

STEP 5 (Blockchain):
  - fileHash = crypto.createHash('sha256').update(encryptedBuffer).digest('hex')
  - blockchainFileId = registerFileOnChain(fileHash, 'pending')
  - tx.wait(1) -> receive txHash, blockNumber, gasUsed
  - GenomicFile.findByIdAndUpdate({blockchainFileId, blockchainTxHash, blockchainBlockNumber, blockchainTimestamp, blockchainFileHash})

STEP 6 (IPFS):
  - uploadToIPFS(encryptedBuffer, blobName) -> {cid, ipfsUrl}
  - GenomicFile.findByIdAndUpdate({ipfsCid, ipfsUrl, ipfsStatus:'done'})


### 8.4 Access Request Flow

STEP 1: GET /api/files/public/catalog (authenticated researcher)
  - GenomicFile.find({availability:'Available'}).populate('owner','name email')
  - respond: array of file objects (without encryptionIv, without keyHex)
  - Frontend DataCatalog.tsx: search box, filters by genome build and sequencing type

STEP 2: Researcher fills RequestAccessForm.tsx modal
  - React Hook Form + Zod schema validation
  - Fields: projectTitle, purpose (max 2000), accessType (read-only/downloadable), institution, contactEmail, benefits (max 500), risks (max 500), dataSharedWithCollaborators (bool), extensionRequested (bool)
  - POST /api/access/request-access
  - Check: researcher profile complete? if not -> 400 'Complete your profile'
  - Check: existing pending/more-info request -> 409
  - Check: active non-expired approved request -> 409
  - Check: recently denied (<24h) -> 429 {cooldownHoursRemaining}
  - AccessRequest.create({...allFields, status:'pending'})
  - blockchainRequestAccess(blockchainFileId, orcid) -> receipt stored
  - respond: 201 {request}

### 8.5 Owner Review Flow

STEP 3: GET /api/access/incoming-requests (owner JWT)
  - AccessRequest.find({owner:req.user.userId}).populate('file','originalName datasetId').populate('researcher','name email')
  - Filter: .filter(r => r.file != null && r.researcher != null) // null guard for deleted docs
  - respond: array sorted by createdAt desc

STEP 4 (Approve): POST /api/access/approve-request/:id
  Body: {durationDays} (default 30)
  - AccessRequest.findOne({_id:id, owner:req.user.userId})
  - status='approved', approvedAt=now, accessExpiresAt=now+durationDays
  - Blockchain: contract.approveAccess(fileId, researcherId, durationSeconds) -> receipt
    (researcherId is the versioned bytes32 identifier: V2 HMAC-SHA256 for new requests, V1 keccak256 for legacy records)
  - respond: 200 {request with receipt}

STEP 4 (Deny): POST /api/access/deny-request/:id
  Body: {ownerNote}
  - status='denied', deniedAt=now
  - Blockchain: contract.rejectAccess(fileId, researcherId) -> receipt
    (researcherId: same versioned bytes32 used at request time, per identityVersion field)
  - respond: 200

STEP 4 (Ask for more info): POST /api/access/request-more-info/:id
  Body: {ownerNote} (max 1000 chars) -> status='more-info' -> respond: 200
  Note: This is an application-only workflow; it does NOT submit a blockchain transaction.

STEP 4 (Revoke): POST /api/access/revoke-access/:id
  - status='revoked', revokedAt=now
  - Blockchain: contract.revokeAccess(fileId, researcherId) -> receipt
    (researcherId: versioned bytes32 — V2 HMAC-SHA256 default, V1 keccak256 for legacy)
  - respond: 200

### 8.6 Download (Researcher)

STEP 5: Researcher clicks Download in AccessedData.tsx
  -> DownloadPinModal opens (6-digit PIN dialog)
  -> POST /api/access/verify-pin Body: {pin}
    - retrievePinHash(userId) from Key Vault
    - bcrypt.compare(pin, pinHash) -> match?
    - respond: 200 {valid:true} or 403 {valid:false}
  -> GET /api/files/download/:fileId
    - GenomicFile.findOne({_id:fileId}).select('+encryptionIv +encryptionMac +encryptionVersion')
    - Find approved, non-expired, downloadable AccessRequest for this researcher+file
    - Retrieve AES key from Key Vault: retrieveEncryptionKey(fileId)
    - Download encrypted blob: downloadBlobToBuffer(blobName) -> encryptedBuffer
    - If encryptionVersion === 'v2': decryptBufferV2(encryptedBuffer, keyHex, ivHex, macHex) -> plainBuffer (verifies MAC first)
    - If encryptionVersion === 'v1': decryptBuffer(encryptedBuffer, keyHex, ivHex) -> plainBuffer (legacy)
    - res.setHeader('Content-Disposition', 'attachment; filename=' + originalName)
    - res.send(plainBuffer) -> browser receives plaintext genomic file

### 8.7 Audit Log Flow

GET /api/blockchain/audit/:fileId:
  - blockchainService.getAuditTrail(blockchainFileId)
  - queryFilter for 5 event types: FileRegistered, AccessRequested, AccessApproved, AccessRejected, AccessRevoked
  - sorted by blockNumber ascending
  - Return: [{eventName, args:{fileId,researcherId,timestamp,...}, blockNumber, txHash, etherscanUrl}]
  - Frontend AuditLogs.tsx: timeline display + Export PDF (jsPDF autotable)


---

## 9. All Features

### 9.1 Authentication and Authorization Features
  - Email+password registration with role selection (Owner/Researcher)
  - bcrypt password hashing (rounds configurable, default 10)
  - TOTP MFA setup via Google Authenticator QR code
  - Login with email+password+TOTP (enforced for MFA-enabled accounts)
  - Forgot password via OTP email (6-digit, 10-minute expiry)
  - Role-based access: Owner sees upload/requests dashboard; Researcher sees catalog/my requests
  - Profile completion gate for researchers (cannot request access without complete profile)
  - JWT in httpOnly cookie (not localStorage, XSS-safe)
  - 6-digit PIN for download authorization (hash stored in Key Vault)
  - Rate limiting on auth (20/15min) and MFA (5/15min)

### 9.2 File Management Features
  - Upload .fastq, .bam, .vcf genomic files
  - Chunked parallel upload directly to Azure (4MB blocks, up to 4 concurrent)
  - Upload progress bar in UI
  - Server-side encryption after upload: V2 Encrypt-then-MAC (AES-256-CBC + HMAC-SHA256) for new files; V1 AES-256-CBC for existing legacy files (both paths supported via encryptionVersion field)
  - Unique per-file AES keys stored in Azure Key Vault
  - SHA-256 file hash stored on Ethereum blockchain for tamper detection
  - IPFS backup of encrypted file for decentralized resilience
  - Dataset catalog with metadata: genome build, sequencing type, phenotype tags, quality score, risk category
  - Auto-generated dataset ID (GV-XXXX format)
  - File availability management (Available/Restricted)
  - Researcher download with PIN gate + expiry enforcement

### 9.3 Access Management Features
  - Researcher submits detailed access request form (institution, purpose, benefits, risks, ORCID)
  - Every request and approval/rejection anchored on Ethereum blockchain
  - Owner inbox with pending/reviewed tabs
  - Owner approves with configurable duration (durationDays)
  - Owner denies with note (stored in ownerNote)
  - Owner asks for more information (status: more-info, researcher sees note)
  - Owner revokes active access
  - Re-request cooldown: 24 hours after denial
  - Access expiry: accessExpiresAt enforced on download
  - Blockchain consent record cannot be altered even by GenoVault admins

### 9.4 Blockchain and Audit Features
  - On-chain file registration with SHA-256 hash and IPFS CID
  - On-chain access request, approval, rejection, and revocation events
  - Immutable audit trail queryable by file ID
  - Etherscan links for each transaction (public verifiability)
  - PDF export of audit log (jsPDF + autotable)
  - File verification endpoint: compare current hash with on-chain hash
  - Blockchain status dashboard: node online, chain ID, total records

### 9.5 Profile Features
  - Owner: name, email, institution, country, age, gender
  - Researcher: institution, department, designation, research area, experience, country, phone, LinkedIn, ORCID, bio, purpose
  - Profile completion required before first access request
  - Setting up download PIN (6-digit, bcrypt-hashed, Key Vault stored)
  - Change password (requires current password)
  - MFA status indicator + re-setup option

### 9.6 UI and UX Features
  - Dark/light mode toggle (next-themes)
  - Animated card entrances (Framer Motion)
  - Expandable request cards (chevron rotation animation)
  - Toast notifications (Sonner) for all async operations
  - Recharts dashboard: uploads over time, access requests by status, file types breakdown
  - Responsive layout (Tailwind CSS breakpoints)
  - Loading skeleton states
  - Empty state illustrations
  - Form validation feedback (React Hook Form + Zod error messages)
  - Filter and search in DataCatalog


---

## 10. Database Design

### 10.1 Collection: users

  Field                 | Type     | Notes
  ----                  | ----     | ----
  _id                   | ObjectId | Primary key
  name                  | String   | required, trim
  email                 | String   | required, unique, lowercase, index
  password              | String   | required, select:false, bcrypt pre-save
  role                  | String   | enum:[owner,researcher]
  mfa_secret            | String   | select:false, base32
  mfa_enabled           | Boolean  | default:false
  lastLogin             | Date     | updated on each login
  profileCompleted      | Boolean  | default:false
  age                   | Number   | optional
  gender                | String   | optional
  country               | String   | optional
  researcherProfile     | Object   | sub-document
  createdAt             | Date     | timestamps:true
  updatedAt             | Date     | timestamps:true

  researcherProfile sub-document:
    institution, department, designation, researchArea (String[]), experience (Number),
    country, phone, linkedIn, orcid (validated regex 0000-XXXX-XXXX-XXXX), bio (max 500), purpose (max 500), completedAt (Date)

### 10.2 Collection: genomicfiles

  Field                   | Notes
  ----                    | ----
  _id (ObjectId)          | Primary key
  owner (ObjectId)        | ref:User, index
  originalName (String)   | original filename from browser
  storedName (String)     | Azure blob name (UUID-based)
  extension (String)      | .fastq/.bam/.vcf
  sizeBytes (Number)      | from getBlobProperties
  azureBlobName (String)  | same as storedName
  azureContainerName      | genomic-files
  cloudUrl (String)       | Azure blob URL (requires SAS to access)
  isEncrypted (Boolean)   | true after background Phase 1
  encryptionIv (String)   | 32-char hex, select:false (IV, not key)
  ipfsCid (String)        | Filebase IPFS content ID
  ipfsUrl (String)        | https://ipfs.filebase.io/ipfs/{cid}
  ipfsStatus (String)     | enum:[pending,uploading,done,failed]
  blockchainFileId (Number)   | uint256 from smart contract
  blockchainTxHash (String)   | Ethereum tx hash
  blockchainBlockNumber (Number) | Ethereum block
  blockchainTimestamp (Date)  | block timestamp
  blockchainFileHash (String) | SHA-256 of encrypted bytes
  availability (String)   | enum:[Available,Restricted]
  genomeBuild (String)    | e.g. GRCh38, hg19
  sequencingType (String) | e.g. WGS, WES, RNA-seq
  sampleDescription       | free text
  riskCategory (String)   | enum:[Low,Medium,High,Critical]
  qualityScore (Number)   | 0-100
  detectedVariants (String[])  | e.g. [BRCA1,TP53]
  predictedRisks (String[])    | e.g. [Breast Cancer]
  phenotype (String[])    | e.g. [Hypertension]
  datasetId (String)      | GV-XXXX format
  availabilityDate (Date) | when file will be available
  createdAt / updatedAt   | timestamps

  Indexes: {owner:1, createdAt:-1}

### 10.3 Collection: accessrequests

  Key fields: file (ref), researcher (ref), owner (ref denorm), projectTitle, purpose (max:2000), accessType (read-only/downloadable), institution, contactEmail, benefits (max:500), risks (max:500), dataSharedWithCollaborators (bool), extensionRequested (bool), ownerNote, status (enum:pending,approved,denied,rejected,revoked,more-info), approvedAt, accessExpiresAt, deniedAt, revokedAt

  Blockchain receipt fields (x4 events: request/approve/reject/revoke):
    blockchainXxxTxHash, blockchainXxxBlockNumber, blockchainXxxGasUsed, blockchainXxxTxStatus, blockchainXxxEtherscanUrl

  Unique compound index: {file:1, researcher:1} — one request per researcher per file at a time

### 10.4 Collection: otps

  Field       | Notes
  ----        | ----
  _id         | ObjectId
  email       | required, index
  otp         | 6-digit string, bcrypt-hashed
  expiresAt   | +10 minutes from creation
  createdAt   | TTL index 600 seconds (auto-delete)


---

## 11. Complete API Reference

### 11.1 Authentication Routes (/api/auth)

  POST   /register        None        {name,email,password,role}    201 {setupToken}
  POST   /setup-mfa       setupToken  -                             200 {qrCode,secret}
  POST   /verify-mfa      setupToken  {token}                       200 {user,cookie}
  POST   /login           None        {email,password}              200 {mfaRequired or user}
  POST   /login-mfa       tempToken   {token}                       200 {user,cookie}
  POST   /logout          Bearer      -                             200
  GET    /me              Bearer      -                             200 {user}
  POST   /forgot-password None        {email}                       200 (always)
  POST   /verify-otp      None        {email,otp}                   200 {resetToken}
  POST   /reset-password  resetToken  {newPassword}                 200
  PUT    /change-password Bearer      {currentPassword,newPassword} 200
  GET    /mfa-status      Bearer      -                             200 {mfa_enabled}

### 11.2 File Routes (/api/files)

  GET    /get-upload-url          Bearer owner       Generate write-only SAS token
  POST   /confirm-upload          Bearer owner       Register file after Azure upload
  GET    /my-files                Bearer owner       List owner files
  GET    /download/:fileId        Bearer researcher  Download decrypted file
  GET    /public/catalog          Bearer researcher  Browse available files
  GET    /:fileId                 Bearer any         Get single file metadata
  DELETE /:fileId                 Bearer owner       Delete file
  PATCH  /:fileId/availability    Bearer owner       Toggle availability
  GET    /encryption-status/:id   Bearer owner       Check background job status
  POST   /set-pin                 Bearer any         Set/update download PIN
  POST   /verify-pin              Bearer any         Verify download PIN

### 11.3 Access Routes (/api/access)

  POST   /request-access         Bearer researcher  Submit access request
  GET    /my-requests            Bearer researcher  List own requests
  GET    /incoming-requests      Bearer owner       List incoming requests
  POST   /approve-request/:id    Bearer owner       Approve a request
  POST   /deny-request/:id       Bearer owner       Deny a request
  POST   /request-more-info/:id  Bearer owner       Ask researcher for more info
  POST   /revoke-access/:id      Bearer owner       Revoke approved access
  GET    /accessed-data          Bearer researcher  List approved accessible files

### 11.4 Blockchain Routes (/api/blockchain)

  GET /status           Bearer  Check blockchain node connectivity
  GET /verify/:fileId   Bearer  Verify file on-chain vs current hash
  GET /audit/:fileId    Bearer  Full event audit trail for a file
  GET /file/:chainId    Bearer  Read file record from contract

### 11.5 OTP Routes (/api/otp)

  POST /request   Request email OTP
  POST /verify    Verify OTP for password reset

---

## 12. UI / Frontend Structure

### 12.1 Routing (React Router DOM v6)

  /                    -> LandingPage.tsx
  /login               -> Login.tsx
  /register            -> Register.tsx
  /setup-mfa           -> MFASetup.tsx
  /forgot-password     -> ForgotPassword.tsx
  /dashboard/*         -> DashboardLayout.tsx (owner JWT guard)
    /dashboard/overview      -> Overview.tsx (Recharts)
    /dashboard/upload        -> Upload.tsx
    /dashboard/files         -> MyFiles.tsx
    /dashboard/requests      -> Requests.tsx (incoming access requests)
    /dashboard/access-control -> AccessControl.tsx
    /dashboard/audit         -> Audit.tsx
  /researcher/*        -> ResearcherLayout.tsx (researcher JWT guard)
    /researcher/overview     -> ResearcherOverview.tsx
    /researcher/catalog      -> DataCatalog.tsx
    /researcher/requests     -> MyRequests.tsx
    /researcher/accessed     -> AccessedData.tsx
    /researcher/audit        -> AuditLogs.tsx
    /researcher/profile      -> ResearcherProfile.tsx
  /profile             -> Profile.tsx (shared)
  /settings            -> Settings.tsx (shared)

### 12.2 AuthContext.tsx

  Context value: {user, login(userData), logout(), updateUser(data), loading, isAuthenticated}
  On mount: GET /api/auth/me (validates cookie/token) -> set user state
  login(): set user state in React state (NOT localStorage)
  logout(): DELETE cookie -> clear state -> navigate to /login
  useAuth() hook exported for all components

### 12.3 Key Components

  RequestAccessForm.tsx: Modal dialog with React Hook Form + Zod. Fields validated on submit. Disabled fields after submission. Shows cooldown timer if denied recently.

  DownloadPinModal.tsx: 6-digit PIN input. Calls /verify-pin first, then /download/:fileId on success.

  RequestCard (inside Requests.tsx): Expandable Framer Motion card. Status badge (color-coded). Owner action buttons: Approve (+ duration picker), Deny (+ note), Ask More Info.

  DataCatalog.tsx: Grid of GenomicFile cards. Search input (filters originalName, genomeBuild, phenotype). Dropdown filter: genome build, sequencing type. Risk badge: Low=green, Medium=yellow, High=orange, Critical=red.

  AuditLogs.tsx: Timeline of blockchain events. Each event: icon, event name, researcher ID (bytes32 truncated), block number, Etherscan link. Export PDF button at top.


---

## 13. System Requirements

### 13.1 Software Requirements

  Backend: Node.js 20+, npm 9+
  Database: MongoDB Atlas M0 (free tier sufficient for dev)
  Blockchain: Ethereum Sepolia testnet (free via Alchemy/Infura)
  Cloud: Azure subscription (Blob Storage + Key Vault)
  IPFS: Filebase account (S3-compatible, free tier 5GB)
  OS: Windows/macOS/Linux (dev tested on Windows)

### 13.2 Environment Variables (Backend .env)

  PORT=5000
  MONGODB_URI=mongodb+srv://...
  JWT_SECRET=...
  BCRYPT_ROUNDS=10
  CLIENT_ORIGIN=http://localhost:8080
  AZURE_STORAGE_ACCOUNT_NAME=...
  AZURE_STORAGE_ACCOUNT_KEY=...
  AZURE_STORAGE_CONTAINER_NAME=genomic-files
  AZURE_KEY_VAULT_URI=https://....vault.azure.net/
  AZURE_TENANT_ID=...
  AZURE_CLIENT_ID=...
  AZURE_CLIENT_SECRET=...
  FILEBASE_ACCESS_KEY_ID=...
  FILEBASE_SECRET_ACCESS_KEY=...
  FILEBASE_BUCKET_NAME=...
  BLOCKCHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
  BLOCKCHAIN_DEPLOYER_PRIVATE_KEY=0x...
  BLOCKCHAIN_CONTRACT_ADDRESS=0x...
  EMAIL_HOST=smtp.gmail.com
  EMAIL_PORT=587
  EMAIL_USER=...
  EMAIL_PASS=...
  # Major Revision — R3.1 ORCID V2 identity
  RESEARCHER_ID_HMAC_SECRET=<64-char hex — HMAC key for V2 ORCID bytes32 derivation>
  # Major Revision — R3.5 Watermark provenance
  WATERMARK_SECRET=<64-char hex — HMAC key for watermark seed generation>
  WATERMARK_SECRET_VERSION=watermark-key-v1

### 13.3 Frontend .env

  VITE_API_URL=http://localhost:5000
  VITE_AZURE_STORAGE_ACCOUNT_NAME=...
  VITE_AZURE_CONTAINER_NAME=genomic-files

---

## 14. Challenges Faced and Solutions

### 14.1 Blank Screen Bug (Dashboard Requests / Researcher Requests)
  Problem: React crashed silently on /dashboard/requests and /researcher/requests.
  Root cause: .populate() returns null for AccessRequest documents where referenced file was deleted. Code then accessed r.file.originalName -> TypeError: Cannot read properties of null.
  Symptom: API returned 200 with 2595 bytes of data. Frontend received data but React crashed before render.
  Fix:
    Backend (accessController.js): .filter(r => r.file != null && r.researcher != null) after populate
    Frontend (Requests.tsx, MyRequests.tsx, AccessedData.tsx): if (!req.file || !req.owner) return null
  Lesson: Always null-guard populated Mongoose references. populate() silently returns null for deleted docs.

### 14.2 Azure CORS Blocking Direct Uploads
  Problem: Browser direct upload to Azure failed with CORS error after server restart.
  Root cause: Azure Blob Storage requires CORS rules to be explicitly configured via setProperties.
  Solution: azureService.configureCors() called in server.js startup. maxAgeInSeconds:86400 caches preflight 24h.

### 14.3 IPFS CID Not Returned for Large Files
  Problem: x-amz-meta-cid header absent for large files uploaded with PutObjectCommand.
  Root cause: Filebase processes large files asynchronously; CID not ready immediately.
  Solution: Multi-strategy CID extraction: x-amz-meta-cid header -> HeadObject polling (6 attempts, 1.5s backoff) -> fallback ipfsStatus:'failed'

### 14.4 Blockchain Sync Between DB and Chain
  Problem: MongoDB updated but blockchain tx failed -> inconsistent state.
  Solution: MongoDB updated first (primary source of truth). Blockchain receipt stored after tx.wait(1). If tx fails, ownerNote set to 'Blockchain sync pending'.

### 14.5 Atlas IP Whitelist
  Problem: Backend cannot connect to MongoDB after ISP IP change.
  Solution: Whitelist 0.0.0.0/0 for development. Production: specific server IP.

### 14.6 AES Key Size Mismatch
  Problem: createCipheriv threw 'Invalid key length' on some machines.
  Root cause: generateKey() returned 32-char hex (16 bytes) instead of 64-char hex (32 bytes).
  Solution: crypto.randomBytes(32) = 32 bytes = 64 hex chars = correct AES-256 key.

### 14.7 ethers v5 to v6 Migration
  Problem: Multiple errors after ethers.js upgrade.
  Root cause: v6 renamed BigNumber, changed provider construction, changed utils namespace.
  Solution: Updated to JsonRpcProvider (not providers.JsonRpcProvider), ethers.keccak256 + ethers.toUtf8Bytes (not utils.*), receipt.gasUsed.toString() for BigInt serialization.

---

## 15. Project Timeline

  Phase 1 (Month 1): Planning - ideation, stack selection, schema design, smart contract design
  Phase 2 (Month 2): Backend Foundation - Express, MongoDB, JWT, Azure Blob, file upload
  Phase 3 (Month 3): Blockchain Integration - Hardhat, Solidity contract, Sepolia deploy, ethers.js
  Phase 4 (Month 3-4): Security Layer - AES-256-CBC, Key Vault, background encryption, MFA, PIN gate
  Phase 5 (Month 4): IPFS Integration - Filebase S3 API, CID extraction, multipart upload, crash recovery
  Phase 6 (Month 4-5): Frontend - React+TypeScript+Vite, all pages, charts, dark mode, animations
  Phase 7 (Month 5-6): Bug Fixing - blank screen fix, CORS, IPFS retry, ethers migration, form validation
  Phase 8 (Month 6): Documentation - this document, API reference, deployment guide


---

## 16. File Structure

  Major Project/
  +-- backend/
  |   +-- server.js                    (Entry point, middleware, routes)
  |   +-- .env                         (All secrets - git-ignored)
  |   +-- controllers/
  |   |   +-- authController.js        (Register, login, MFA, password)
  |   |   +-- fileController.js        (Upload, download, confirm, catalog)
  |   |   +-- accessController.js      (Request, approve, deny, revoke)
  |   |   +-- blockchainController.js  (Status, verify, audit)
  |   |   +-- auditController.js       (Audit log aggregation)
  |   |   +-- mfaController.js         (MFA setup, verify-mfa)
  |   +-- models/
  |   |   +-- User.js                  (User schema + bcrypt pre-save)
  |   |   +-- GenomicFile.js           (File schema)
  |   |   +-- AccessRequest.js         (Access request schema)
  |   |   +-- OTP.js                   (OTP schema with TTL index)
  |   +-- middleware/
  |   |   +-- authMiddleware.js        (JWT verify -> req.user)
  |   |   +-- roleMiddleware.js        (Role enforce)
  |   +-- routes/
  |   |   +-- authRoutes.js, fileRoutes.js, accessRoutes.js, blockchainRoutes.js, auditRoutes.js, otpRoutes.js
  |   +-- services/
  |       +-- azureService.js          (Blob Storage + SAS)
  |       +-- encryptionService.js     (AES-256-CBC - pure Node native crypto)
  |       +-- keyVaultService.js       (Azure Key Vault secrets)
  |       +-- ipfsService.js           (Filebase S3 IPFS)
  |       +-- blockchainService.js     (ethers.js v6 contract calls)
  |       +-- emailService.js          (Nodemailer OTP email)
  |       +-- dbService.js             (MongoDB connect)
  +-- frontend/
  |   +-- index.html
  |   +-- vite.config.ts               (Proxy /api -> localhost:5000)
  |   +-- tsconfig.json, tailwind.config.ts, package.json
  |   +-- src/
  |       +-- main.tsx, App.tsx        (Router + AuthProvider)
  |       +-- index.css                (Global Tailwind + custom CSS)
  |       +-- contexts/AuthContext.tsx
  |       +-- pages/
  |       |   +-- Landing.tsx, Login.tsx, Register.tsx, MFASetup.tsx, ForgotPassword.tsx, Profile.tsx, Settings.tsx
  |       |   +-- dashboard/           (DashboardLayout, Overview, Upload, MyFiles, Requests, AccessControl, Audit)
  |       |   +-- researcher/          (ResearcherLayout, ResearcherOverview, DataCatalog, MyRequests, AccessedData, AuditLogs, ResearcherProfile)
  |       +-- components/             (RequestAccessForm, DownloadPinModal, shared UI)
  |       +-- services/api.ts          (Axios base + auth interceptors)
  |       +-- hooks/useAuth.ts
  |       +-- types/index.ts           (TypeScript interfaces)
  +-- blockchain/
      +-- hardhat.config.js
      +-- contracts/
      |   +-- GenomicDataRegistry.sol  (Production v2 contract)
      |   +-- GenomicRegistry.sol      (Earlier v1 contract)
      +-- scripts/deploy.js
      +-- artifacts/                   (Compiled ABI and bytecode)

---

## 17. Glossary

  AES-256-CBC     Advanced Encryption Standard, 256-bit key, Cipher Block Chaining mode
  Encrypt-then-MAC AES-256-CBC encryption followed by HMAC-SHA256 over IV+ciphertext (V2 scheme)
  HMAC-SHA256     Hash-based Message Authentication Code; used for MAC (V2) and ORCID identity (V2)
  IPFS            InterPlanetary File System - content-addressed decentralized storage
  CID             Content Identifier - IPFS hash of file bytes; changes if bytes change
  SAS             Shared Access Signature - time-limited, permission-scoped Azure URL
  TOTP            Time-based One-Time Password (RFC 6238) - 6-digit, 30-second window
  ORCID           Open Researcher and Contributor ID - globally unique researcher ID
  JWT             JSON Web Token - signed token for stateless authentication
  bcrypt          Adaptive password hashing function with cost factor
  Sepolia         Ethereum public testnet (Chain ID: 11155111)
  Etherscan       Ethereum block explorer for transaction lookup
  Filebase        S3-compatible IPFS pinning service
  Key Vault       Azure managed secrets service for keys/certs/secrets
  populate        Mongoose method to resolve ObjectId references to full documents
  blockchainFileId uint256 auto-incremented ID from smart contract
  bytes32         32-byte fixed array in Solidity; used for ORCID identity (V1: keccak256, V2: HMAC-SHA256)
  GasUsed         Amount of Ethereum computational work units used in a transaction
  MFA             Multi-Factor Authentication
  httpOnly        Cookie flag preventing JavaScript access (XSS protection)
  select:false    Mongoose field option; excluded from query results by default
  TTL index       MongoDB Time-To-Live index; auto-deletes documents after duration
  identityVersion 'v1'|'v2' field on AccessRequest; records which ORCID hashing scheme was used
  encryptionVersion 'v1'|'v2' field on GenomicFile; selects V1 CBC or V2 Encrypt-then-MAC decrypt path
  BlockchainStatus Per-transition enum (PENDING/SUBMITTED/CONFIRMED/FAILED) on AccessRequest, decoupled from MongoDB status
  timingSafeEqual Node.js crypto constant-time buffer comparison; prevents MAC timing oracle attacks
  walletSecurityService Startup validator for BLOCKCHAIN_DEPLOYER_PRIVATE_KEY format and balance

---

## 18. Known Limitations and Future Improvements

### Current Limitations

  1. Single System Wallet: High throughput -> nonce collision risk. Fix: transaction queue with nonce management.
  2. In-Memory Decryption: Large files decrypted fully into RAM before streaming. Fix: AES-CTR stream cipher.
  3. Background Jobs Not Persistent: Server crash during encryption -> job lost. Fix: Bull/BullMQ with Redis.
  4. No Email OTP on Register: Email OTP code present but not called in register flow (only in forgot-password).
  5. Single Container: All files in one Azure container. Fix: per-owner containers or blob prefix sharding.
  6. Key Vault Dev Fallback: In-memory Map is NOT persistent (lost on restart). Logs a console warning.
  7. No Refresh Token: Users must re-login after 24h JWT/cookie expiry.

### Future Improvements

  1. Federated IPFS: Run GenoVault's own IPFS node to remove Filebase dependency.
  2. zkSNARKs: Zero-knowledge proofs for researcher identity without revealing ORCID.
  3. Multi-Chain: Deploy to Polygon PoS for lower gas costs in production.
  4. FHIR Integration: HL7 FHIR API for genomic data interoperability with hospital systems.
  5. Compute-to-Data: Run algorithms on encrypted data in Trusted Execution Environments without download.
  6. Mobile App: React Native researcher app for catalog and access management.
  7. Access Delegation: Allow approved researchers to share access with collaborators.
  8. Admin Dashboard: Super-admin panel for platform monitoring, user management, flagged content.

---

## 19. Unit 6 — Research Integrity & Data Verification

### 19.1 Overview

Unit 6 adds a 5-layer cryptographic integrity verification system and a persistent off-chain audit log to GenoVault. It runs on top of the existing architecture without modifying any existing controllers, models, or upload/download pipelines.

The unit answers two questions that blockchain alone cannot answer:
- Has the encrypted file in Azure been tampered with since it was originally registered on-chain?
- Has every download event been durably logged for the owner to inspect?

### 19.2 New Files Added

  backend/controllers/integrityController.js  (5-layer integrity logic + owner dashboard stats)
  backend/routes/integrityRoutes.js           (Express router — mounted at /api/integrity)
  backend/models/AuditLog.js                  (Mongoose schema for persistent audit events)
  backend/services/auditLogService.js         (Non-blocking logEvent() helper)
  frontend/src/pages/dashboard/Verification.tsx  (Per-file 5-layer verification UI — owner)
  frontend/src/pages/dashboard/Audit.tsx         (Combined Audit Trail + Integrity Dashboard)

### 19.3 The 5-Layer Integrity Check

Each file can be checked across five independent security layers.
All five checks are exposed via GET /api/integrity/:fileId and also displayed in Verification.tsx.

  Layer          | What is checked                                             | PASS condition
  ----           | ----                                                        | ----
  1. SHA-256     | Re-stream blob from Azure; compute hash; compare with stored blockchainFileHash | Hashes match exactly
  2. Blockchain  | Call contract.getFileByHash() live on Sepolia               | Hash found in on-chain registry
  3. AES         | isEncrypted=true + encryptionIv present + Key Vault has 64-char hex key | All three present
  4. Azure       | verifyBlobExists(azureBlobName)                             | Blob exists in container
  5. IPFS        | ipfsStatus === "done" && ipfsCid non-null                   | IPFS backup complete

Overall status (8-category model — derived by explicit priority rules, NOT by taking the "worst" layer):
  SECURE                     — all non-SKIP layers PASS
  INTEGRITY_VIOLATION        — SHA-256 of current blob ≠ blockchain-anchored hash (highest priority)
  KEY_OR_DECRYPTION_FAILURE  — AES key missing from Key Vault or encryptionIv absent
  PRIMARY_STORAGE_UNAVAILABLE— Azure blob cannot be retrieved
  BACKUP_UNAVAILABLE         — IPFS status "failed" or CID missing
  VERIFICATION_UNAVAILABLE   — Blockchain node unreachable or hash not found on-chain
  PENDING                    — IPFS backup still uploading — NOT a failure; all other layers PASS
  AT_RISK                    — legacy/catch-all for any unclassified FAIL

  Priority rule chain (applied top-to-bottom; first matching rule wins):
    1. Any INTEGRITY_VIOLATION           → overall = INTEGRITY_VIOLATION
    2. Any KEY_OR_DECRYPTION_FAILURE     → overall = KEY_OR_DECRYPTION_FAILURE
    3. Any PRIMARY_STORAGE_UNAVAILABLE   → overall = PRIMARY_STORAGE_UNAVAILABLE
    4. IPFS FAIL (not pending)           → overall = BACKUP_UNAVAILABLE
    5. Blockchain unreachable            → overall = VERIFICATION_UNAVAILABLE
    6. IPFS PENDING, others PASS         → overall = PENDING
    7. All PASS/SKIP                     → overall = SECURE

  The per-layer results are always returned in full so the UI shows exactly which layers passed/failed.
  The overall field is a summary convenience; multiple concurrent failures are visible at layer level.

Important: Layer 1 (SHA-256) uses streaming via getReadableBlobStream() — it never loads the full file into RAM. For large genomic files this is essential.

### 19.4 SHA-256 Streaming Hash Verification — Technical Detail

The SHA-256 stored in blockchainFileHash was originally computed from the AES-256-CBC encrypted bytes of the file, before IPFS upload.

During integrity check:
  1. getReadableBlobStream(azureBlobName) — returns a fresh Azure readable stream
  2. crypto.createHash('sha256') — streaming hash object
  3. stream.on('data', chunk => hashCalc.update(chunk)) — feeds data chunk by chunk
  4. stream.on('end', resolve) — finalises the hash
  5. hashCalc.digest('hex') — produces liveHash
  6. liveHash === file.blockchainFileHash — comparison

This is the same byte stream that was registered on-chain. If any byte in the Azure encrypted object changed (corruption, tampering, accidental overwrite), the live SHA-256 will not match the blockchain-anchored hash and the layer returns FAIL.

Important distinction — two complementary security properties:
  Blockchain-anchored SHA-256: detects changes to the stored encrypted object relative to the registered
    digest. An attacker who modifies the Azure blob produces a different SHA-256, which this check detects.
  AES-256-CBC currently lacks ciphertext authentication at the encryption construction level. Although the
    blockchain-anchored SHA-256 detects changes to the stored encrypted object relative to the registered
    digest, it is not a replacement for authenticated encryption or an encrypt-then-MAC construction.
    Authenticated encryption (via HMAC) provides a cryptographically tight binding between ciphertext, IV,
    and metadata at the encryption layer, independently of the storage layer.
  These are distinct and complementary security properties. V2 (Encrypt-then-MAC) provides both.

### 19.5 Download-Time Integrity Gate

The fileController.js download endpoint (GET /api/files/download/:fileId) performs a streaming SHA-256 check as Pass 1 before decryption:

  Pass 1: getReadableBlobStream() → streaming SHA-256 → compare with blockchainFileHash
    If FAIL → 409 Conflict {"message": "File integrity check failed — hash mismatch"}
    If PASS → continue

  Pass 2: getReadableBlobStream() → AES-256-CBC decipher stream → HTTP response → browser

Both passes use a fresh, independently consumed stream. No full-file buffer is loaded. The pipeline is:
  Azure encrypted blob → Node.js readable stream → AES-256-CBC decipher → HTTP chunked response → browser

Audit events are written (fire-and-forget) at each stage:
  DOWNLOAD_INITIATED  — researcher triggers download
  INTEGRITY_VERIFIED  — SHA-256 matched; download proceeds
  INTEGRITY_FAILED    — SHA-256 mismatch; download blocked; details include storedHash + liveHash
  DOWNLOAD_COMPLETED  — file fully streamed to browser
  DOWNLOAD_FAILED     — pipeline error after decryption started

### 19.6 Persistent Audit Log (AuditLog Collection)

#### 19.6.1 Collection: auditlogs

  Field          | Type          | Notes
  ----           | ----          | ----
  _id            | ObjectId      | Primary key
  fileId         | ObjectId ref  | GenomicFile ref; index; null for system events
  datasetId      | String        | GV-XXXX; denormalised for human-readable queries
  userId         | ObjectId ref  | User (actor); index
  userRole       | String        | enum: owner, researcher, system
  operation      | String        | enum (see below); required; index
  status         | String        | enum: success, failure; required
  txHash         | String        | Blockchain tx hash if applicable; null otherwise
  blockNumber    | Number        | Ethereum block number if applicable; null otherwise
  ipAddress      | String        | Request IP address; null if not captured
  details        | Mixed         | Free-form context object (reason, storedHash, liveHash, etc.)
  timestamp      | Date          | default: Date.now; index
  createdAt      | Date          | timestamps:true
  updatedAt      | Date          | timestamps:true

  Operation enum values:
    UPLOAD              — file confirmed after background encryption (future use)
    ACCESS_REQUEST      — researcher submitted an access request
    ACCESS_APPROVED     — owner approved a request
    ACCESS_REJECTED     — owner denied/rejected a request
    ACCESS_REVOKED      — owner revoked active access
    DOWNLOAD_INITIATED  — researcher triggered download endpoint
    DOWNLOAD_COMPLETED  — file fully delivered
    DOWNLOAD_FAILED     — error during decryption/streaming
    INTEGRITY_VERIFIED  — SHA-256 check passed at download time
    INTEGRITY_FAILED    — SHA-256 mismatch; download was blocked

  Compound indexes:
    { fileId: 1, timestamp: -1 }    — per-file event history
    { userId: 1, timestamp: -1 }    — per-user activity
    { operation: 1, timestamp: -1 } — filter by event type

#### 19.6.2 auditLogService.js — Non-Blocking Write Pattern

The logEvent() function follows a strict non-blocking pattern:
  - Never throws (catches all DB errors internally)
  - Never awaited in the hot path — callers use .catch(console.warn) or fire-and-forget
  - Adds zero latency to download or verify pipelines

Usage pattern in controllers:
  logEvent("INTEGRITY_VERIFIED", userId, "researcher", fileDoc, {
    status:    "success",
    details:   { storedHash: "abc...", liveHash: "abc..." },
    ipAddress: req.ip,
  }).catch(console.warn); // fire-and-forget

### 19.7 Integrity API Reference (/api/integrity)

  Route                           | Auth          | Description
  ----                            | ----          | ----
  GET /api/integrity/owner-stats  | Bearer owner  | Aggregated stats for owner dashboard
  GET /api/integrity/:fileId      | Bearer owner  | 5-layer check for one file (owner only)

NOTE: owner-stats route is registered BEFORE /:fileId in Express to prevent Express
from treating the literal string "owner-stats" as a fileId path parameter.

#### GET /api/integrity/owner-stats — Response Shape

  {
    "success": true,
    "stats": {
      "totalDatasets":        Number,   // confirmed files owned
      "blockchainRegistered": Number,   // files with blockchainTxHash != null
      "totalRequests":        Number,
      "pendingCount":         Number,
      "approvedCount":        Number,
      "rejectedCount":        Number,   // denied + rejected combined
      "revokedCount":         Number,
      "integrityVerified":    Number,   // AuditLog INTEGRITY_VERIFIED count (owner's files)
      "integrityFailed":      Number,   // AuditLog INTEGRITY_FAILED count
      "totalIntegrityChecks": Number
    },
    "recentActivity": [                 // last 10 AuditLog events (owner's files)
      {
        "id":        String,
        "operation": String,
        "status":    "success" | "failure",
        "fileName":  String,
        "datasetId": String | null,
        "actor":     String,
        "details":   Object,
        "timestamp": ISOString
      }
    ]
  }

#### GET /api/integrity/:fileId — Response Shape

  {
    "success":   true,
    "fileId":    String,
    "fileName":  String,
    "datasetId": String | null,
    "checks": {
      "sha256":     { "status": "PASS"|"FAIL"|"SKIP", "storedHash": "...", "liveHash": "..." },
      "blockchain": { "status": "PASS"|"FAIL"|"SKIP", "txHash": "...", "etherscanUrl": "...", "network": "Ethereum Sepolia", "chainId": 11155111 },
      "aes":        { "status": "PASS"|"FAIL", "algorithm": "AES-256-CBC", "hasIv": true, "keyOk": true },
      "azure":      { "status": "PASS"|"FAIL", "blobName": "..." },
      "ipfs":       { "status": "PASS"|"FAIL"|"PENDING", "cid": "...", "ipfsUrl": "..." }
    },
    "overall":   "SECURE" | "INTEGRITY_VIOLATION" | "KEY_OR_DECRYPTION_FAILURE" | "PRIMARY_STORAGE_UNAVAILABLE" | "BACKUP_UNAVAILABLE" | "VERIFICATION_UNAVAILABLE" | "PENDING" | "AT_RISK",
    "checkedAt": ISOString
  }

### 19.8 Live Vault Status API (/api/health — Upgraded)

The existing /api/health endpoint was upgraded from a static "API is running" response to a live multi-service health check. No authentication is required.

  GET /api/health — Response Shape

  {
    "success":   true,
    "overall":   "secure" | "degraded" | "error",
    "checks": {
      "azure":   { "status": "ok"|"degraded"|"error", "label": "Azure Blob Storage", "detail": "Container reachable" },
      "ipfs":    { "status": "ok"|"error",             "label": "Filebase IPFS",      "detail": "Bucket: genomic-files" },
      "jwt":     { "status": "ok"|"error",             "label": "JWT Auth",           "detail": "Secret configured" },
      "mfa":     { "status": "ok"|"error",             "label": "TOTP MFA",           "detail": "Encryption key set" },
      "mongodb": { "status": "ok"|"error",             "label": "MongoDB Atlas",      "detail": "Connected" }
    },
    "timestamp": ISOString
  }

  overall values:
    secure  — all five checks report ok
    degraded — at least one check reports degraded (partial)
    error   — at least one check reports error

  Individual checks performed:
    azure   — BlobServiceClient.fromConnectionString() + containerClient.exists()
    ipfs    — validates FILEBASE_ACCESS_KEY_ID + FILEBASE_SECRET_ACCESS_KEY + FILEBASE_BUCKET_NAME env vars
    jwt     — validates JWT_SECRET or JWT_ACCESS_SECRET present and length >= 16
    mfa     — validates TOTP_ENCRYPTION_KEY or MFA_SECRET env var is set
    mongodb — reads mongoose.connection.readyState === 1

### 19.9 Rate Limiter Updates (server.js)

The express-rate-limit configuration was updated to prevent 429 errors on the Audit and Integrity dashboard pages, which make multiple read calls per page load.

  Limiter          | Window   | Max requests  | Applied to
  ----             | ----     | ----          | ----
  apiLimiter       | 15 min   | 300           | /api/* (raised from 100)
  dashboardLimiter | 15 min   | 600           | /api/audit, /api/integrity, /api/files, /api/access
  authLimiter      | 15 min   | 20            | /api/auth/login, /api/auth/register
  mfaLimiter       | 15 min   | 5             | /api/auth/verify-mfa

Dashboard routes are registered with dashboardLimiter BEFORE the global apiLimiter
in server.js so Express uses the more permissive limit for those paths.

### 19.10 Audit Trail + Integrity Dashboard (Audit.tsx)

The previously separate IntegrityDashboard was merged into Audit.tsx to reduce navigation complexity. Audit.tsx now serves as a single combined view with two sections:

Section 1 — Stat Cards (top row)
  Fetched from: GET /api/integrity/owner-stats
  Cards displayed: Total Datasets, Blockchain Registered, Integrity Verified, Integrity Failed,
                   Pending Requests, Approved Access, Rejected Requests, Total Audit Events

Section 2 — Audit Event History (table)
  Fetched from: GET /api/audit (existing auditController which aggregates blockchain events)
  Features: search by filename/actor/event type, filter by event type dropdown,
            sort by timestamp, Export PDF (jsPDF + autotable), Etherscan link per event,
            color-coded status badges, paginated display

### 19.11 Verification.tsx (Per-File 5-Layer UI)

Accessed at: /dashboard/verification
Role: Owner only

Workflow:
  1. Owner selects a file from a dropdown (populated from GET /api/files/my-files)
  2. Owner clicks "Run Verification"
  3. Frontend calls GET /api/integrity/:fileId
  4. Result displayed as 5 layer cards, each showing: PASS / FAIL / SKIP / PENDING badge,
     relevant metadata (hash values, tx hash, Etherscan link, CID, blob name),
     reason string on FAIL
  5. Overall result banner: SECURE (green) or AT RISK (red)

Layer card details displayed:
  SHA-256:     storedHash, liveHash, PASS/FAIL
  Blockchain:  txHash, blockNumber, Etherscan link, network (Ethereum Sepolia), chainId, registeredAt
  AES:         algorithm (AES-256-CBC), hasIv, keyOk status
  Azure:       blobName, existence status
  IPFS:        CID, ipfsUrl, ipfsStatus

### 19.12 Live Vault Status Widget (Overview.tsx)

The static "All systems secure" badge in the owner Overview dashboard was replaced with a live widget that calls GET /api/health on mount (no auth, no polling).

Behaviour:
  - Loading: spinner icon + skeleton pulse badge
  - Loaded: coloured overall badge (green/amber/red) + per-service status dots
  - Each dot: CheckCircle2 (green), AlertCircle (amber), or XCircle (red)
  - Hovering a dot shows the detail text (e.g. "Container reachable" or error message)
  - Fetched once on mount; no background polling

### 19.13 Updated Workflow: Download with Integrity Gate

The researcher download flow (Section 8.6) is updated as follows:

  STEP 5 (UPDATED): GET /api/files/download/:fileId
    - Verify JWT + researcher has approved non-expired downloadable access request
    - GenomicFile.findOne({_id:fileId}).select('+encryptionIv')
    - Retrieve AES key from Key Vault: retrieveEncryptionKey(fileId)
    - [NEW] logEvent(DOWNLOAD_INITIATED, ...) — fire-and-forget
    - [NEW] Pass 1 — SHA-256 integrity check:
        getReadableBlobStream(blobName) → streaming SHA-256
        compare liveHash with file.blockchainFileHash
        If FAIL → logEvent(INTEGRITY_FAILED, ...) → return 409 {"message":"integrity check failed"}
        If PASS → logEvent(INTEGRITY_VERIFIED, ...)
    - Pass 2 — Decryption + stream to browser:
        getReadableBlobStream(blobName) → new fresh stream
        AES-256-CBC decipher with keyHex + ivHex
        res.setHeader('Content-Disposition', 'attachment; filename=' + originalName)
        pipe decipher → res
    - [NEW] logEvent(DOWNLOAD_COMPLETED, ...) on finish / logEvent(DOWNLOAD_FAILED, ...) on error

### 19.14 Updated Workflow: Integrity Verification (Owner)

  STEP 1: Owner navigates to /dashboard/verification
  STEP 2: Selects file from dropdown — GET /api/files/my-files → populate dropdown
  STEP 3: Clicks "Run Verification"
  STEP 4: GET /api/integrity/:fileId (owner JWT)
    - checkSha256(file)    — streaming Azure read
    - checkBlockchain(file) — live Sepolia contract call
    - checkAes(file)        — Key Vault probe
    - checkAzure(file)      — verifyBlobExists
    - checkIpfs(file)       — field check (sync)
    - overall = AT_RISK if any FAIL; SECURE otherwise
    - respond: 200 {checks, overall, checkedAt}
  STEP 5: Frontend renders layer cards with PASS/FAIL/SKIP badges

### 19.15 Updated API Reference — New Routes

#### 11.6 Integrity Routes (/api/integrity) [NEW]

  GET  /owner-stats   Bearer owner  Aggregated stats for owner integrity dashboard
  GET  /:fileId       Bearer owner  5-layer file integrity check (owner of file only)

#### 11.7 Health Route (/api/health) [UPGRADED]

  GET  /api/health    None          Live multi-service health check (Azure, IPFS, JWT, MFA, MongoDB)

#### 11.8 Audit Route (/api/audit) [EXISTING]

  GET  /api/audit     Bearer owner  Aggregated audit events (blockchain + AuditLog collection)

### 19.16 Updated Database Design — New Collection

#### 10.5 Collection: auditlogs [NEW]

  See Section 19.6.1 for full field reference.

  Purpose: Persistent off-chain record of all download and integrity events.
  Blockchain records (file registration, access request/approve/reject/revoke) remain on-chain.
  AuditLog records the events blockchain cannot capture: download and integrity outcomes.

### 19.17 Updated File Structure

  backend/
    controllers/
      integrityController.js   [NEW]  5-layer integrity logic + owner stats aggregation
    models/
      AuditLog.js              [NEW]  Mongoose schema for persistent audit events
    routes/
      integrityRoutes.js       [NEW]  Express router mounted at /api/integrity
    services/
      auditLogService.js       [NEW]  Non-blocking logEvent() write helper

  frontend/src/pages/dashboard/
    Verification.tsx           [NEW]  Per-file 5-layer integrity verification UI
    Audit.tsx                  [UPDATED]  Now includes stat cards + integrity stats merged in
    Overview.tsx               [UPDATED]  Vault Status widget now live (calls /api/health)

  backend/server.js            [UPDATED]  Rate limits raised; /api/health upgraded to live checks

### 19.18 New Challenges and Solutions

#### 19.18.1 Blank Dashboard (SWC/Vite TypeScript Runtime Error)
  Problem: Dashboard at /dashboard went completely blank after adding Vault Status widget.
  Root cause: TypeScript type and interface declarations were placed inside the React component
    function body. SWC (Vite's transpiler) emits code that crashes at runtime when type
    declarations appear inside a function scope.
  Error: "Cannot convert undefined or null to object at Object.values(vaultStatus.checks)"
    — vaultStatus.checks was undefined because vaultStatus was set before checks was populated.
  Fix 1: Moved all type/interface declarations to module level (outside the component function).
  Fix 2: Added null guard: {vaultStatus && vaultStatus.checks && (...)} and Object.values(vaultStatus.checks ?? {}).
  Lesson: Never declare TypeScript types inside React component function bodies when using Vite+SWC.
    Always place interface/type at module level.

#### 19.18.2 429 Rate Limit on Dashboard Pages
  Problem: Audit and Integrity dashboard pages were receiving 429 Too Many Requests responses.
  Root cause: Global rate limiter was set to 100 requests per 15 minutes. Dashboard pages
    make multiple parallel API calls (audit, integrity stats, file list, access list) each time
    they render, exhausting the limit quickly during development.
  Fix: Raised global limit from 100 to 300. Added a dedicated dashboardLimiter (600/15min)
    applied specifically to /api/audit, /api/integrity, /api/files, /api/access.
    Auth and MFA limiters remain strict (20 and 5 respectively).

#### 19.18.3 Streaming vs Buffer for Large Genomic Files
  Problem: Initial integrity check design used downloadBlobToBuffer() which loads the entire
    encrypted file into RAM. Genomic files (.fastq, .bam) can be gigabytes in size.
  Root cause: Design oversight — buffer approach does not scale to large files.
  Fix: Both Pass 1 (SHA-256 integrity) and Pass 2 (AES decryption + stream) use
    getReadableBlobStream() which returns a fresh Azure readable stream each time.
    No full-file buffer is ever created in the download pipeline.
  Rule enforced: downloadBlobToBuffer() must NOT be used for download-time integrity checks.

### 19.19 Updated Features List

#### 9.4 Blockchain and Audit Features (Updated)

  [Existing features unchanged, add:]
  - Persistent off-chain AuditLog (MongoDB) for download + integrity events
  - Download-time streaming SHA-256 integrity gate (blocks tampered files with 409)
  - 5-layer per-file integrity check (SHA-256, Blockchain, AES, Azure, IPFS)
  - Owner integrity dashboard with aggregated stats (verified, failed, total checks)
  - Combined Audit Trail + Integrity Dashboard in single UI view
  - PDF export of complete audit history (jsPDF + autotable)

#### 9.7 System Health Features [NEW]

  - Live Vault Status widget on owner Overview dashboard
  - Real-time health check for all five system services: Azure Blob, Filebase IPFS, JWT, TOTP MFA, MongoDB
  - Per-service status indicators: OK (green), degraded (amber), error (red)
  - Health API does not require authentication

### 19.20 Updated Glossary

  AuditLog        MongoDB collection of off-chain download and integrity events (Unit 6)
  logEvent()      Non-blocking fire-and-forget audit write helper (auditLogService.js)
  INTEGRITY_VERIFIED  AuditLog operation: SHA-256 matched blockchainFileHash at download time
  INTEGRITY_FAILED    AuditLog operation: SHA-256 mismatch detected; download was blocked
  AT_RISK         Legacy/catch-all integrity status when an unclassified layer returns FAIL
  SECURE          Overall integrity status when no layer returned FAIL (SKIP is neutral)
  INTEGRITY_VIOLATION     Highest-priority failure: SHA-256 hash mismatch (data tampered)
  KEY_OR_DECRYPTION_FAILURE AES key missing from Key Vault or IV absent; file unreadable
  PRIMARY_STORAGE_UNAVAILABLE Azure blob missing (not a hash mismatch)
  BACKUP_UNAVAILABLE      IPFS backup explicitly FAILED (not just PENDING)
  VERIFICATION_UNAVAILABLE Blockchain check failed (node offline or hash not found on-chain)
  Pass 1 / Pass 2  Two-pass download: Pass 1 = streaming SHA-256; Pass 2 = streaming AES decrypt
  dashboardLimiter  Permissive rate limiter (600/15min) for read-heavy dashboard endpoints
  SWC             Speedy Web Compiler — Vite's Rust-based TypeScript transpiler (replaces Babel)
  getReadableBlobStream  azureService function returning a fresh Azure readable stream (no buffer)

---

*Document updated: September 2026 — Major Revision (R3.1 Identity V2, R3.2 Encrypt-then-MAC, R3.3 Wallet Security, R3.4 8-Category Integrity, R3.5 Misuse Classification) applied*
*Project: GenoVault*
*Repository: https://github.com/Mokshith08/GenoVault*
*Stack: React 18 + TypeScript + Node.js 20 + MongoDB Atlas + Azure + Ethereum Sepolia + IPFS*
*Total documentation: GenoVault_Documentation_Part1.md + GenoVault_Documentation_Part2.md*
