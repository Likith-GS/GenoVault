# GenoVault — Complete Blockchain Documentation

---

## 1. WHY DID WE USE BLOCKCHAIN?

### 1.1 The Core Problem Blockchain Solves

Genomic data is the most sensitive personal data that exists. A person's DNA:
- Uniquely identifies them (like a fingerprint, but PERMANENT and UNCHANGEABLE)
- Reveals hereditary disease risks (cancer, Alzheimer's, rare conditions)
- Affects not just the individual but their entire family
- Cannot be changed if compromised — unlike a password or credit card number

If GenoVault used ONLY a traditional database (MongoDB) for access control:
- A rogue admin could silently alter who has access to what data
- Access logs could be deleted or modified to cover tracks
- A data owner could falsely claim 'I never approved that researcher'
- A researcher could falsely claim 'I never received access'
- There is NO independent way to verify the truth

Blockchain solves this with ONE property: IMMUTABILITY.
Once a transaction is confirmed on Ethereum, it CANNOT be changed,
deleted, or tampered with — not by GenoVault, not by the data owner, not by anyone.

### 1.2 Specific Reasons We Chose Blockchain

REASON 1: Consent Management That Cannot Be Faked
  Selected access events (request, approve, reject, revoke) are recorded on-chain with:
  - File ID (which dataset), Researcher identity (bytes32 — V2 HMAC-SHA256 of ORCID, or V1 keccak256 for legacy),
  - Timestamp (block timestamp — cannot be backdated), Duration (when access expires)
  This is cryptographic proof of consent for the recorded events.

REASON 2: Tamper Detection for Genomic Files
  When a file is uploaded, we compute SHA-256(encrypted_file_bytes).
  This 64-character hash is stored PERMANENTLY on the blockchain.
  If anyone modifies the Azure Blob file, the current hash will NOT match
  the on-chain hash. GenoVault's verify endpoint detects this.

REASON 3: Immutable Audit Trail
  Five event types (FileRegistered, AccessRequested, AccessApproved, AccessRejected, AccessRevoked)
  are emitted as Ethereum EVENTs and recorded permanently.
  This audit trail cannot be edited even by GenoVault developers.
  Application-level events (download outcomes, request-more-info, rate-limit records) are stored
  in MongoDB. The blockchain records the security-critical consent events; MongoDB records
  the full operational audit trail.
  Critical for GDPR compliance, ethics board audits, and research integrity.

REASON 4: Transparency and Public Verifiability
  Anyone with the contract address can go to https://sepolia.etherscan.io
  and independently verify the entire history without trusting GenoVault.
  NO traditional database can provide this.

REASON 5: Decentralization and Resilience
  Even if GenoVault's MongoDB is wiped, blockchain records persist on
  thousands of Ethereum nodes worldwide.

REASON 6: Academic Research Compliance
  Research institutions require provable, auditable consent records.
  Blockchain provides a globally recognized, timestamped record.

### 1.3 Alternatives Rejected

  MongoDB audit logs      REJECTED: Admin can DELETE or UPDATE entries. Not tamper-proof.
  Append-only database    REJECTED: Still controlled by GenoVault. Not publicly verifiable.
  IPFS-only              REJECTED: Stores data but does NOT timestamp consent events.
  Traditional PKI         REJECTED: Certificate authorities can be compromised.

  CONCLUSION: Only blockchain provides IMMUTABILITY + TRANSPARENCY + DECENTRALIZATION.


---

## 2. WHY DEPLOY TO SEPOLIA (NOT RUN LOCALLY)?

### 2.1 What 'Running Locally' Means

With Hardhat, you can run: npx hardhat node
This spins up a local Ethereum node on your machine (http://localhost:8545).
It has 20 pre-funded accounts with 10,000 test ETH each.
Everything works — but it exists ONLY on your computer.

### 2.2 Why Local Blockchain Is Insufficient

PROBLEM 1: NO PERSISTENCE
  The local Hardhat node RESETS every time you restart it.
  All transactions, blocks, contract state, audit trail — GONE.
  For a genomic data management system that needs permanent records, this is unacceptable.

PROBLEM 2: NOT DECENTRALIZED
  A local node runs on a single machine you control.
  This defeats the entire purpose of blockchain.
  If your laptop dies or is formatted, all records are lost.
  There is NO immutability guarantee — you can reset the node any time.

PROBLEM 3: NOT PUBLICLY VERIFIABLE
  No one can access your local http://localhost:8545.
  Researchers, ethics boards, or auditors cannot independently verify records.
  Etherscan does NOT index local Hardhat nodes.
  The audit trail is only accessible through your machine.

PROBLEM 4: NO REAL-WORLD TRUST
  Blockchain's value proposition is that it is maintained by thousands of
  independent validators who do not know or trust each other.
  A single local node has ZERO of that. It is just a database pretending to be blockchain.

PROBLEM 5: CANNOT TEST REAL NETWORK CONDITIONS
  Deploying to Sepolia tests:
  - Gas estimation accuracy
  - Real transaction confirmation latency (~12 seconds on Sepolia)
  - RPC provider reliability (Alchemy)
  - Wallet nonce management under real conditions
  - ABI encoding/decoding edge cases with real EVM

### 2.3 Why Sepolia Specifically

  Ethereum Mainnet     REJECTED: Costs real ETH (real money). registerFile() = .10- per call.
  Goerli Testnet       REJECTED: Deprecated by Ethereum Foundation in 2023. No longer maintained.
  Polygon Mainnet      REJECTED: Requires real MATIC tokens. Cross-chain complexity.
  Hardhat local fork   REJECTED: Same persistence and accessibility problems as local node.

  SEPOLIA TESTNET (CHOSEN) — Reasons:
  - Official Ethereum Foundation supported testnet (not being deprecated)
  - Chain ID: 11155111
  - Free SepoliaETH from https://sepoliafaucet.com
  - Full EVM compatibility (identical to Ethereum mainnet)
  - Indexed by https://sepolia.etherscan.io — public verifiability
  - Proof of Stake consensus (same as mainnet post-Merge)
  - Block time: ~12 seconds (realistic testing conditions)
  - Transaction history PERSISTS permanently (not reset)
  - Contract deployments are permanent (survive server restarts)
  - Alchemy RPC URL works directly: https://eth-sepolia.g.alchemy.com/v2/{KEY}

  CONCLUSION: Sepolia gives ALL benefits of real blockchain (immutability,
  public verifiability, decentralization, persistence) with ZERO cost (free test ETH).


---

## 3. WHAT IS GAS FEE AND WHY IS IT USED?

### 3.1 What is Gas?

Gas is the unit that measures the computational effort required to execute
an operation on the Ethereum network.

Every operation in the EVM (Ethereum Virtual Machine) has a fixed gas cost:
  Addition (ADD):               3 gas
  Reading storage (SLOAD):      100-2100 gas
  Writing storage (SSTORE):     20,000-22,100 gas
  Creating a new contract:      32,000 gas
  Emitting an event:            375 + 8 * data_bytes gas
  Deploying GenomicDataRegistry.sol: ~800,000-1,200,000 gas

Gas Fee Formula:
  Total Fee = Gas Used x Gas Price (in Gwei)
  1 Gwei = 0.000000001 ETH (one billionth of ETH)

  Example:
  60,000 gas x 20 Gwei = 1,200,000 Gwei = 0.0012 ETH
  At ETH price of ,500 -> .00 per transaction (mainnet)
  On Sepolia -> FREE (SepoliaETH has no real monetary value)

### 3.2 Why Does Gas Exist? (3 Core Reasons)

REASON 1: PREVENTS SPAM AND DENIAL-OF-SERVICE ATTACKS
  Without gas, anyone could submit an infinite loop:
    while(true) { /* do nothing */ }
  This would halt every Ethereum node on the planet permanently.
  Gas makes every computation cost money. When gas runs out,
  the transaction REVERTS (state rolled back), protecting the network.

REASON 2: COMPENSATES VALIDATORS
  Ethereum validators stake 32 ETH to participate in Proof of Stake consensus.
  They process transactions and earn gas fees as reward.
  Without compensation, no one would run validators.
  Gas fees are the economic incentive keeping the network alive and decentralized.

REASON 3: ALLOCATES SCARCE BLOCK SPACE
  Each Ethereum block has a gas limit (~30,000,000 gas on mainnet).
  When demand is high, users bid HIGHER gas prices to get included faster.
  This is a fair market mechanism for limited block space.
  Low-priority transactions pay lower gas and wait longer.

ADDITIONAL: MAKES COMPUTATION FINITE AND PREDICTABLE
  Gas gives every EVM operation a well-defined cost model.
  Developers can estimate cost before sending. No surprises.
  Infinite loops are impossible — they just run out of gas and revert.

### 3.3 Gas in GenoVault — Our Specific Transactions

  Transaction              | Estimated Gas  | On-Chain Action
  ---                      | ---            | ---
  registerFile()           | 60,000-80,000  | Store SHA-256 hash + IPFS CID
  requestAccess()          | 45,000-55,000  | Record researcher's access request
  approveAccess()          | 50,000-65,000  | Record approval + expiry timestamp
  rejectAccess()           | 35,000-45,000  | Record rejection event
  revokeAccess()           | 35,000-45,000  | Record revocation event
  Contract deployment      | 800k-1,200,000 | Deploy GenomicDataRegistry.sol

  ON SEPOLIA: All costs paid in free SepoliaETH. Zero real-world cost.
  ON MAINNET: Same operations = - per transaction (ETH price + network congestion).

### 3.4 Gas Optimization: Custom Errors vs Revert Strings

In our smart contract we use CUSTOM ERRORS for gas efficiency:

  // EXPENSIVE approach (wastes gas storing string in calldata):
  revert('File does not exist');

  // GAS-EFFICIENT approach (our implementation):
  error FileNotFound(uint256 fileId);
  if (!record.exists) revert FileNotFound(fileId);

Custom errors store only a 4-byte function selector + parameters (no string storage).
This reduces gas cost per failed transaction, making GenoVault cheaper to operate.

### 3.5 How GenoVault Pays Gas — Single System Wallet

  BLOCKCHAIN_DEPLOYER_PRIVATE_KEY in backend .env
  -> This is one Ethereum wallet with SepoliaETH balance
  -> ALL blockchain transactions signed by this wallet
  -> Users (owners, researchers) NEVER need their own ETH or MetaMask
  -> Gas is invisible to users — background infrastructure cost

  In production (mainnet):
  -> GenoVault top-ups the system wallet with real ETH periodically
  -> Estimated: ~.50- per file upload + ~-3 per access event
  -> Absorbed as platform operating cost (like server hosting fees)


---

## 4. BLOCKCHAIN NETWORK DETAILS

### 4.1 Ethereum Sepolia — Full Network Profile

  Property              | Value
  ---                   | ---
  Network Name          | Ethereum Sepolia Testnet
  Chain ID              | 11155111
  Native Currency       | SepoliaETH (ETH symbol, free test tokens)
  Consensus Mechanism   | Proof of Stake (PoS)
  Block Time            | ~12 seconds average
  Block Gas Limit       | ~30,000,000 gas
  RPC URL (Alchemy)     | https://eth-sepolia.g.alchemy.com/v2/{API_KEY}
  Block Explorer        | https://sepolia.etherscan.io
  Faucet                | https://sepoliafaucet.com
  Launch                | Late 2021 (primary testnet after Goerli deprecation)
  Maintained by         | Ethereum Foundation
  EVM Compatibility     | 100% identical to Ethereum mainnet

### 4.2 Proof of Stake Consensus (How Transactions Become Permanent)

After 'The Merge' (September 2022), Ethereum moved from Proof of Work to Proof of Stake.
Sepolia follows the same PoS consensus as mainnet.

HOW PoS WORKS:
  1. Validators deposit 32 ETH as collateral (stake)
  2. Validators randomly selected to PROPOSE new blocks
  3. Other validators ATTEST (vote) that the proposed block is valid
  4. After sufficient attestations, block is FINALIZED
  5. Validators earn rewards for honest participation
  6. Validators LOSE stake (slashed) for malicious behavior
  7. Economic punishment makes attack extremely costly

WHAT THIS MEANS FOR GENOALVAULT:
  - 1 confirmation (~12 sec) is sufficient for our use case
  - tx.wait(1) in our code waits for 1 block before reading receipt
  - Full finality achieved in ~2 epochs (~12.8 minutes) if needed
  - Once finalized: even ALL validators combined cannot alter a past transaction
  - Immutability is guaranteed by economic incentives, not just cryptography

### 4.3 How Our Backend Connects to the Network

  In blockchainService.js (lazy singleton pattern):

  Step 1: Create provider (connection to Sepolia via Alchemy):
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);

  Step 2: Load wallet (signs all transactions):
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY, provider);
    // Key validated at startup by walletSecurityService.js before routes are mounted

  Step 3: Create contract instance:
    const contract = new ethers.Contract(
      process.env.BLOCKCHAIN_CONTRACT_ADDRESS,  // deployed address on Sepolia
      GenomicDataRegistryABI,                    // from artifacts/ folder
      wallet                                     // signer for write calls
    );

  LAZY SINGLETON: Contract instance created ONCE on first API call, then cached.
  Avoids reconnecting to RPC on every request. If connection fails, retries on next call.

  NON-BLOCKING: All blockchain write calls (registerFile, requestAccess, etc.) are
  wrapped in try/catch. Errors are logged but do NOT crash the backend or block HTTP
  responses. MongoDB is the primary source of truth; blockchain is the recording layer.

### 4.4 Alchemy as Our RPC Provider

WHAT IS ALCHEMY?
  Alchemy is a blockchain infrastructure company running enterprise-grade Ethereum nodes.
  Instead of running our own Sepolia node (500+ GB disk, days of syncing, 24/7 uptime),
  we use Alchemy's managed node via an HTTPS URL.

WHY ALCHEMY INSTEAD OF OWN NODE?
  - Full Sepolia node: ~500 GB disk space, days to sync, 24/7 maintenance
  - Alchemy free tier: 300 million compute units/month, 99.9% uptime SLA, zero ops
  - Alchemy provides enhanced APIs for event querying (used in getAuditTrail)
  - Free tier is more than sufficient for a student/demo project

ALCHEMY USAGE IN GENOALVAULT:
  - eth_sendRawTransaction: broadcast our signed transactions to Sepolia
  - eth_call: read-only calls (checkAccess, getFile, getTotalRecords) — no gas
  - eth_getLogs: event filtering (getAuditTrail — query all 5 event types)
  - eth_getTransactionReceipt: tx.wait(1) polling for confirmation
  - eth_blockNumber: current block (blockchain status endpoint)


---

## 5. ROLES BLOCKCHAIN PLAYS IN GENOALVAULT

### Role 1: File Integrity Guardian

  When a genomic file is uploaded and encrypted in the background:
    fileHash = SHA-256(encryptedFileBytes)   // 64-character hex string
    contract.registerFile(fileHash, ipfsCID)  // stored on-chain PERMANENTLY

  Later, anyone can verify:
    GET /api/blockchain/verify/:fileId
    -> Re-download Azure blob, compute SHA-256
    -> Compare with on-chain registered hash
    -> If different: TAMPERED — Azure blob modified after registration
    -> If equal: INTACT — file is exactly as it was when registered

  This makes storage auditable even if Azure is compromised internally.

### Role 2: Consent Ledger (Cryptographic Proof of Access Decisions)

  Selected access decisions are recorded as immutable on-chain events:
  - Request:  requestAccess(fileId, researcherId) -> AccessRequested event
  - Approve:  approveAccess(fileId, researcherId, seconds) -> AccessApproved event
  - Deny:     rejectAccess(fileId, researcherId) -> AccessRejected event
  - Revoke:   revokeAccess(fileId, researcherId) -> AccessRevoked event
  (researcherId = bytes32: V2 HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, ORCID) for new requests;
   V1 keccak256(ORCID) for legacy records. identityVersion on AccessRequest records which was used.)
  Note: request-more-info is an application-only workflow stored in MongoDB; it does NOT
  produce a blockchain event.

  This is a CRYPTOGRAPHIC CONSENT LEDGER:
  - Cannot be altered by GenoVault admins
  - Cannot be altered by the data owner
  - Cannot be altered by the researcher
  - Time-stamped by block.timestamp (Ethereum consensus — cannot be backdated)
  - Publicly verifiable on https://sepolia.etherscan.io

### Role 3: Audit Trail Provider

  GET /api/blockchain/audit/:fileId
  -> query all 5 event types from block 0 to latest
  -> sort chronologically by blockNumber
  -> return: [{eventName, args, blockNumber, txHash, timestamp, etherscanUrl}]

  Frontend AuditLogs.tsx:
  - Timeline view with icon per event type
  - Each event: name, block number, researcher ID, Etherscan link
  - 'Export PDF' button: jsPDF + autotable generates downloadable audit report
  - Report can be submitted to ethics boards, IRBs, research compliance offices

### Role 4: Decentralized Backup Reference

  When a file is backed up to IPFS, the CID is stored on-chain:
    contract.registerFile(fileHash, 'Qm...' or 'bafybei...')

  Even if GenoVault's MongoDB is wiped:
    Blockchain record -> IPFS CID -> Encrypted File -> Key Vault Key -> Decrypted
  This creates a fully decentralized recovery path.

### Role 5: Privacy-Preserving Researcher Identity

  ORCID never stored raw on-chain. Two supported schemes:

  V1 (legacy — keccak256):
    researcherKeccak = keccak256(toUtf8Bytes('0000-0002-1825-0097'))
    // Produces: 0x3a8f1d... (fixed 32-byte hash)
    LIMITATION: ORCID identifiers follow a structured, publicly enumerable format.
    Because keccak256 is a public function with no secret key, anyone with a copy
    of the ORCID registry can compute the hash for every known ORCID offline and
    map results to on-chain bytes32 researcherIds (dictionary-style mapping).
    This means the on-chain pseudonym does not resist offline ORCID identification.
    Addresses reviewer item R3.1.

  V2 (default — HMAC-SHA256, reviewer item R3.1):
    researcherHmac = HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, orcid.trim())
    // key = server-side secret (256-bit, never on-chain)
    // output: 32-byte hex, 0x-prefixed, used as bytes32
    ADVANTAGE: Without RESEARCHER_ID_HMAC_SECRET, the mapping from ORCID to
    on-chain bytes32 cannot be reconstructed — even with the full ORCID registry.
    This is a keyed pseudonymous derivation, not anonymity.
    GDPR-COMPLIANT: Raw ORCID (PII) never touches the public blockchain.
    DETERMINISTIC: Same ORCID + same secret -> same bytes32 every time.
    LINKABLE INTERNALLY: GenoVault DB links ORCID -> MongoDB userId (private).

  identityVersion field on AccessRequest tracks which scheme was used per request.

---

## 6. SMART CONTRACT: GenomicDataRegistry.sol

### 6.1 Contract Overview

  Language:  Solidity 0.8.24
  License:   MIT (SPDX-License-Identifier: MIT)
  Compiler:  Hardhat with solc 0.8.24
  Network:   Ethereum Sepolia Testnet
  Address:   BLOCKCHAIN_CONTRACT_ADDRESS environment variable
  File:      blockchain/contracts/GenomicDataRegistry.sol

  Two contract files exist in the project:
  1. GenomicDataRegistry.sol — Production v2 (ACTIVE, currently deployed to Sepolia)
  2. GenomicRegistry.sol    — Earlier v1 (superseded, not in use)

### 6.2 State Variables — What the Contract Stores On-Chain

  address public systemWallet
  // The ONLY address allowed to call write functions.
  // Set in constructor = deployer wallet address.
  // Enforced by onlySystem modifier on every write function.

  uint256 private _totalRecords
  // Auto-incrementing file ID counter. Starts at 0, increments per registerFile().
  // Returned as blockchainFileId which is stored in MongoDB GenomicFile document.

  mapping(uint256 => FileRecord) private _files
  // fileId -> FileRecord { fileHash, timestamp, ipfsCID, exists }

  mapping(string => uint256) private _hashToId
  // SHA-256 hash -> fileId. For duplicate detection and hash-based lookup.

  mapping(uint256 => mapping(bytes32 => AccessRequest)) private _accessRequests
  // fileId -> researcherId (bytes32) -> AccessRequest { researcherId, requestedAt, status }

  mapping(uint256 => bytes32[]) private _requesters
  // fileId -> list of all researcherId bytes32 values who ever requested.
  // Needed because Solidity mappings are NOT iterable — need a separate array.

  mapping(uint256 => mapping(bytes32 => AccessPermission)) private _permissions
  // fileId -> researcherId (bytes32) -> AccessPermission { approved, grantedAt, expiryTime }

### 6.3 Structs

  struct FileRecord {
    string fileHash;      // SHA-256 hex of encrypted file bytes
    uint256 timestamp;    // block.timestamp when registered
    string ipfsCID;       // IPFS content identifier
    bool exists;          // false until registerFile() called
  }

  struct AccessRequest {
    bytes32 researcherId; // bytes32 identifier: V2 = HMAC-SHA256(secret, ORCID); V1 legacy = keccak256(ORCID)
    uint256 requestedAt;  // block.timestamp when researcher submitted request
    RequestStatus status; // None, Pending, Approved, Rejected
  }

  struct AccessPermission {
    bool approved;        // true if currently approved (false after revokeAccess)
    uint256 grantedAt;    // block.timestamp when approved
    uint256 expiryTime;   // grantedAt + durationSeconds (when access expires)
  }

### 6.4 Enum

  enum RequestStatus {
    None,      // 0: no request OR after revocation (can re-request)
    Pending,   // 1: request submitted, awaiting owner decision
    Approved,  // 2: owner approved
    Rejected   // 3: owner denied
  }

### 6.5 Custom Errors

  error FileNotFound(uint256 fileId);
  error HashAlreadyRegistered(string fileHash);
  error InvalidHash();
  error RequestNotPending(uint256 fileId, bytes32 researcherId);
  error NoApprovedPermission(uint256 fileId, bytes32 researcherId);

  Gas advantage: 4-byte selector only (vs full string in revert messages).

### 6.6 Modifier

  modifier onlySystem() {
    require(msg.sender == systemWallet, 'Not authorized');
    _;
  }

  Applied to ALL write functions. If any account other than systemWallet calls
  registerFile, requestAccess, approveAccess, rejectAccess, or revokeAccess
  -> transaction reverts with 'Not authorized'.
  This prevents fake event injection by external actors.


### 6.7 Events — The Permanent Audit Trail Records

  event FileRegistered(
    uint256 indexed fileId,     // indexed = queryable by Alchemy/Etherscan
    string fileHash,
    string ipfsCID,
    uint256 timestamp
  );

  event AccessRequested(
    uint256 indexed fileId,
    bytes32 indexed researcherId,
    uint256 requestedAt
  );

  event AccessApproved(
    uint256 indexed fileId,
    bytes32 indexed researcherId,
    uint256 expiryTime,
    uint256 grantedAt
  );

  event AccessRejected(
    uint256 indexed fileId,
    bytes32 indexed researcherId,
    uint256 rejectedAt
  );

  event AccessRevoked(
    uint256 indexed fileId,
    bytes32 indexed researcherId,
    uint256 revokedAt
  );

WHY 'indexed' KEYWORD?
  Indexed parameters create a 'topic' in the Ethereum transaction log.
  Alchemy/ethers.js can filter events by indexed parameters EFFICIENTLY:
    contract.queryFilter(contract.filters.AccessApproved(fileId, null))
  Without indexed, you fetch ALL events ever emitted -> very slow for large history.
  We can filter by specific fileId or researcherId directly on-chain.

### 6.8 Constructor

  constructor(address _systemWallet) {
    systemWallet = _systemWallet;
    _totalRecords = 0;
  }

  During deployment (scripts/deploy.js):
    deployer wallet address -> becomes systemWallet in contract storage
    _totalRecords initialized to 0 (first file registered gets ID 1)

### 6.9 Write Functions (All Protected by onlySystem)

registerFile(string fileHash, string ipfsCID) returns (uint256 fileId)
  1. Validate: fileHash.length must equal 64 (SHA-256 = 32 bytes = 64 hex chars)
     If not: revert InvalidHash()
  2. Check: _hashToId[fileHash] must be 0 (not already registered)
     If duplicate: revert HashAlreadyRegistered(fileHash)
  3. _totalRecords++ -> new fileId
  4. Store: _files[fileId] = FileRecord{fileHash, block.timestamp, ipfsCID, exists:true}
  5. Store: _hashToId[fileHash] = fileId (for hash-based lookup)
  6. Emit: FileRegistered(fileId, fileHash, ipfsCID, block.timestamp)
  7. Return: fileId (uint256) — stored in MongoDB as blockchainFileId

requestAccess(uint256 fileId, bytes32 researcherId)
  1. Check: _files[fileId].exists == true (revert FileNotFound if not)
  2. If first-time requester: append researcherId to _requesters[fileId] array
  3. Set: _accessRequests[fileId][researcherId] = {researcherId, block.timestamp, Pending}
  4. Emit: AccessRequested(fileId, researcherId, block.timestamp)

approveAccess(uint256 fileId, bytes32 researcherId, uint256 durationSeconds)
  1. Check: file exists (FileNotFound)
  2. Check: current status == Pending (revert RequestNotPending if already Approved/Rejected)
  3. expiryTime = block.timestamp + durationSeconds (e.g. 30 days = 2,592,000 seconds)
  4. Update: _accessRequests status = Approved
  5. Store: _permissions[fileId][researcherId] = {approved:true, block.timestamp, expiryTime}
  6. Emit: AccessApproved(fileId, researcherId, expiryTime, block.timestamp)

rejectAccess(uint256 fileId, bytes32 researcherId)
  1. Check: file exists + status == Pending
  2. Update: status = Rejected
  3. Emit: AccessRejected(fileId, researcherId, block.timestamp)

revokeAccess(uint256 fileId, bytes32 researcherId)
  1. Check: file exists
  2. Check: _permissions[fileId][researcherId].approved == true
     If not: revert NoApprovedPermission(fileId, researcherId)
  3. Update: approved = false, status = None (allows researcher to re-request later)
  4. Emit: AccessRevoked(fileId, researcherId, block.timestamp)

### 6.10 Read Functions (No Gas — Called Directly Off-Chain)

checkAccess(uint256 fileId, bytes32 researcherId) -> (bool hasAccess, uint256 expiryTime)
  Returns: approved==true AND block.timestamp < expiryTime
  Used to verify real-time access validity without trusting MongoDB.

getFile(uint256 fileId) -> FileRecord
  Returns full FileRecord struct. Used in file verification.

getFileByHash(string fileHash) -> (uint256 fileId, FileRecord record)
  Lookup by SHA-256 hash. Core of the tamper-detection verify endpoint.

getFileRequests(uint256 fileId) -> AccessRequest[]
  Iterates _requesters[fileId] array (O(n) where n = researcher count).
  Returns all AccessRequest structs for audit/admin purposes.

getPermission(uint256 fileId, bytes32 researcherId) -> AccessPermission
  Returns AccessPermission struct for a specific researcher+file pair.

getTotalRecords() -> uint256
  Returns _totalRecords. Used in blockchain status dashboard endpoint.


---

## 7. AUDIT TRAILS — DETAILED EXPLANATION

### 7.1 What Is an Audit Trail?

An audit trail is a chronological, tamper-evident record of all actions taken on data.
In genomic research, an audit trail answers:
  - When exactly was this file registered?
  - Who requested access to this file and when?
  - Who was approved, denied, or revoked — and when?
  - Which researcher had downloadable access at what time?
  - Is there any discrepancy between what the database says and what was actually approved?

### 7.2 Why Blockchain Audit Trails Are Superior to Database Logs

TRADITIONAL DB AUDIT LOG (MongoDB/SQL):
  - Written by the same system that manages the data
  - Admin can DELETE: DELETE FROM audit_log WHERE file_id = 'X'
  - Admin can INSERT fake entries with any timestamp
  - Server clock can be set to any time (backdated records possible)
  - Database wiped/restored from backup without audit log
  - No external verifiability — requires trusting GenoVault

BLOCKCHAIN AUDIT TRAIL (GenoVault approach):
  - Events stored permanently across thousands of Ethereum nodes
  - NOBODY can delete: storage is on Sepolia blockchain forever
  - NOBODY can insert fake events: only systemWallet can emit (onlySystem modifier)
  - Timestamps set by block.timestamp (determined by Ethereum validator consensus)
  - Globally accessible: anyone with contract address can query
  - Etherscan link for every tx: publicly verifiable without trusting GenoVault at all

### 7.3 The 5 Audit Events in GenoVault

  EVENT 1: FileRegistered
    When:       Background job completes encryption + hash computation
    On-chain:   fileHash (SHA-256), ipfsCID, timestamp
    Meaning:    'This exact encrypted file was registered at this exact time'
    Etherscan:  Available at /tx/{txHash}

  EVENT 2: AccessRequested
    When:       Researcher submits access request form
    On-chain:   fileId, researcherId (bytes32: V2 HMAC-SHA256 or V1 keccak256), requestedAt timestamp
    Meaning:    'This researcher formally requested access to this file at this time'
    Etherscan:  Available at /tx/{txHash}

  EVENT 3: AccessApproved
    When:       Owner clicks Approve in the dashboard
    On-chain:   fileId, researcherId, expiryTime, grantedAt
    Meaning:    'Owner gave this researcher access until this specific timestamp'
    Etherscan:  Available at /tx/{txHash}

  EVENT 4: AccessRejected
    When:       Owner clicks Deny in the dashboard
    On-chain:   fileId, researcherId, rejectedAt
    Meaning:    'Owner formally denied this researcher access at this time'
    Etherscan:  Available at /tx/{txHash}

  EVENT 5: AccessRevoked
    When:       Owner clicks Revoke on an approved request
    On-chain:   fileId, researcherId, revokedAt
    Meaning:    'Owner withdrew previously granted access at this time'
    Etherscan:  Available at /tx/{txHash}

### 7.4 How getAuditTrail Works (blockchainService.js Implementation)

  async function getAuditTrail(blockchainFileId) {
    const contract = await getContract();

    // Query ALL 5 event types concurrently for this fileId
    const [registered, requested, approved, rejected, revoked] = await Promise.all([
      contract.queryFilter(contract.filters.FileRegistered(blockchainFileId)),
      contract.queryFilter(contract.filters.AccessRequested(blockchainFileId)),
      contract.queryFilter(contract.filters.AccessApproved(blockchainFileId)),
      contract.queryFilter(contract.filters.AccessRejected(blockchainFileId)),
      contract.queryFilter(contract.filters.AccessRevoked(blockchainFileId)),
    ]);

    // Combine and sort chronologically
    const all = [...registered, ...requested, ...approved, ...rejected, ...revoked];
    all.sort((a, b) => a.blockNumber - b.blockNumber);

    // Return clean objects with Etherscan link
    return all.map(event => ({
      eventName: event.fragment.name,
      args: Object.fromEntries(
        Object.entries(event.args).map(([k,v]) => [k, typeof v === 'bigint' ? v.toString() : v])
      ),
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      etherscanUrl: 'https://sepolia.etherscan.io/tx/' + event.transactionHash
    }));
  }

### 7.5 Audit Trail Frontend (AuditLogs.tsx)

  Display: Timeline view
    FileRegistered    -> green  file    icon
    AccessRequested   -> blue   clock   icon
    AccessApproved    -> green  check   icon
    AccessRejected    -> red    X       icon
    AccessRevoked     -> orange shield  icon

  Each event card shows:
    Event name, Block number, Researcher ID (bytes32 truncated to 0x1234...5678),
    Etherscan link (clickable -> opens sepolia.etherscan.io/tx/{txHash})

  PDF Export:
    Button: 'Export Audit Report'
    Library: jsPDF + jspdf-autotable
    PDF contains: File ID, Dataset name, full event table
    Columns: Event | Block | Tx Hash | Researcher ID | Timestamp
    Use case: Submit to ethics board, IRB, or compliance office


---

## 8. TECHNOLOGY STACK: HARDHAT (COMPLETE)

### 8.1 What is Hardhat?

Hardhat is the most popular Ethereum smart contract development framework.
It is a Node.js-based toolchain that provides:
  - Solidity contract COMPILATION (using solc compiler)
  - Local Ethereum TEST NODE (npx hardhat node)
  - Contract DEPLOYMENT scripts (npx hardhat run scripts/deploy.js --network sepolia)
  - Automated CONTRACT TESTING (Mocha + Chai + ethers.js)
  - Transaction DEBUGGING with stack traces and console.log in Solidity
  - Plugin ecosystem (hardhat-toolbox includes: ethers, chai-matchers, typechain, coverage)

Official: https://hardhat.org
Maintained by: Nomic Foundation
License: MIT

### 8.2 Hardhat Directory Structure in GenoVault

  blockchain/
  +-- hardhat.config.js            Main configuration file
  +-- package.json                 Hardhat + plugin dependencies
  +-- contracts/
  |   +-- GenomicDataRegistry.sol  Production v2 contract (DEPLOYED)
  |   +-- GenomicRegistry.sol      Earlier v1 contract (SUPERSEDED)
  +-- scripts/
  |   +-- deploy.js               Deployment script (run on Sepolia)
  +-- artifacts/                   AUTO-GENERATED after 'npx hardhat compile'
  |   +-- contracts/
  |       +-- GenomicDataRegistry.sol/
  |           +-- GenomicDataRegistry.json  <- ABI + bytecode
  +-- cache/                       Compiler cache (speeds up re-compilation)
  +-- test/                        (optional) Mocha test files

### 8.3 hardhat.config.js — Full Configuration

  require('@nomicfoundation/hardhat-toolbox');
  require('dotenv').config();

  module.exports = {
    solidity: {
      version: '0.8.24',
      settings: {
        optimizer: {
          enabled: true,
          runs: 200  // optimize for 200 deployments (deploy-time vs call-time tradeoff)
        }
      }
    },
    networks: {
      hardhat: {
        // default local network (npx hardhat node)
        chainId: 31337
      },
      sepolia: {
        url: process.env.BLOCKCHAIN_RPC_URL,              // Alchemy Sepolia URL
        accounts: [process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY],  // system wallet
        chainId: 11155111
      }
    },
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY  // for contract verification on Etherscan
    }
  };

### 8.4 Compilation Process — How Solidity Becomes EVM Bytecode

  Command: cd blockchain && npx hardhat compile

  STEP 1: Hardhat reads all .sol files in contracts/
  STEP 2: Invokes solc (Solidity compiler) version 0.8.24
  STEP 3: Compilation produces two things per contract:
    a. ABI (Application Binary Interface):
       JSON array describing every function, event, error, and their parameters.
       This is the 'public interface' — tells ethers.js how to encode/decode calls.
    b. Bytecode:
       Compiled EVM binary (hex string). This is what gets deployed to the blockchain.
       The EVM executes this bytecode when a contract function is called.
  STEP 4: Output saved to artifacts/contracts/GenomicDataRegistry.sol/GenomicDataRegistry.json
  STEP 5: TypeScript types generated in typechain-types/ (via @typechain/hardhat plugin)

  The GenomicDataRegistry.json file structure:
  {
    'contractName': 'GenomicDataRegistry',
    'abi': [...],       // Array of function/event/error definitions
    'bytecode': '0x...',         // Deployment bytecode
    'deployedBytecode': '0x...', // Runtime bytecode
    'sourceName': 'contracts/GenomicDataRegistry.sol',
    'ast': {...}         // Abstract Syntax Tree
  }

  blockchainService.js imports ONLY the ABI:
    const { abi: GenomicDataRegistryABI } = require(
      '../blockchain/artifacts/contracts/GenomicDataRegistry.sol/GenomicDataRegistry.json'
    );

### 8.5 Deployment Script — scripts/deploy.js

  const { ethers } = require('hardhat');

  async function main() {
    // Get the deployer wallet (from hardhat.config.js accounts array)
    const [deployer] = await ethers.getSigners();
    console.log('Deploying with account:', deployer.address);

    // Check balance (need SepoliaETH for gas)
    const balance = await deployer.provider.getBalance(deployer.address);
    console.log('Account balance:', ethers.formatEther(balance), 'ETH');

    // Get the contract factory (ABI + bytecode loader)
    const GenomicDataRegistry = await ethers.getContractFactory('GenomicDataRegistry');

    // Deploy: pass deployer.address as constructor argument (becomes systemWallet)
    const contract = await GenomicDataRegistry.deploy(deployer.address);

    // Wait for deployment transaction to be mined
    await contract.waitForDeployment();

    // Get the deployed contract address
    const contractAddress = await contract.getAddress();

    console.log('GenomicDataRegistry deployed to:', contractAddress);
    console.log('Add to backend .env: BLOCKCHAIN_CONTRACT_ADDRESS=' + contractAddress);
    console.log('systemWallet address:', deployer.address);
    console.log('Add to backend .env: BLOCKCHAIN_DEPLOYER_PRIVATE_KEY={your private key}');
  }

  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

  Run command: npx hardhat run scripts/deploy.js --network sepolia
  This:
  1. Connects to Sepolia via BLOCKCHAIN_RPC_URL
  2. Loads the system wallet private key
  3. Signs and broadcasts the deployment transaction
  4. Waits for the deployment transaction to be mined (~12 seconds)
  5. Returns the deployed contract address
  6. Address is permanent — contract lives on Sepolia forever

### 8.6 Hardhat Local Node (Development Testing Only)

  Command: npx hardhat node
  -> Starts local node at http://127.0.0.1:8545
  -> 20 pre-funded accounts, each with 10,000 test ETH
  -> Fast block mining (instant, no 12-second wait)
  -> Verbose console output of all transactions

  Deploy to local:
  npx hardhat run scripts/deploy.js --network localhost

  IMPORTANT: This was used ONLY during initial smart contract development.
  GenoVault's production .env points to Sepolia, NOT localhost.
  Local Hardhat node state is LOST on restart.

### 8.7 What is ABI and How ethers.js Uses It

  ABI = Application Binary Interface
  It is a JSON array. Each entry describes one function, event, or error.

  Example ABI entry for registerFile():
  {
    'type': 'function',
    'name': 'registerFile',
    'inputs': [
      {'name': 'fileHash', 'type': 'string'},
      {'name': 'ipfsCID', 'type': 'string'}
    ],
    'outputs': [{'name': '', 'type': 'uint256'}],
    'stateMutability': 'nonpayable'   // writes state (costs gas)
  }

  Example ABI entry for FileRegistered event:
  {
    'type': 'event',
    'name': 'FileRegistered',
    'inputs': [
      {'name': 'fileId', 'type': 'uint256', 'indexed': true},
      {'name': 'fileHash', 'type': 'string', 'indexed': false},
      {'name': 'ipfsCID', 'type': 'string', 'indexed': false},
      {'name': 'timestamp', 'type': 'uint256', 'indexed': false}
    ],
    'anonymous': false
  }

  HOW ethers.js USES THE ABI:
  1. ENCODING: contract.registerFile('abc123...', 'QmXyz...')
     ethers.js looks up 'registerFile' in ABI, ABI-encodes the call data into hex
  2. SENDING: ethers.js sends encoded hex + gas estimate to Alchemy -> Sepolia
  3. DECODING: tx.wait(1) -> receipt.logs -> contract.interface.parseLog(log)
     ethers.js decodes raw hex log back into {fileId, fileHash, ipfsCID, timestamp}
  4. EVENTS: contract.queryFilter(contract.filters.FileRegistered(fileId))
     ethers.js builds eth_getLogs filter from ABI event signature


---

## 9. ETHERS.JS v6 — THE BLOCKCHAIN LIBRARY

### 9.1 What Is ethers.js?

ethers.js is the most widely used JavaScript/TypeScript library for Ethereum interaction.
Used in: GenoVault backend (blockchainService.js).
Version: 6.x (major rewrite from v5 with breaking changes we had to handle).

Core capabilities:
  - Connecting to Ethereum networks via JSON-RPC (JsonRpcProvider)
  - Wallet management: load private key, derive address, sign transactions
  - Contract interaction: encode calls, decode results, parse events
  - Utilities: keccak256, toUtf8Bytes, formatEther, parseEther, zeroPadValue
  - Transaction management: send, wait for confirmation, parse receipts
  - Event querying: filter historical logs by indexed parameters

### 9.2 ethers v5 -> v6 Breaking Changes (Issues We Encountered)

  Feature           | ethers v5 (OLD)                      | ethers v6 (OUR VERSION)
  ---               | ---                                  | ---
  Provider          | new ethers.providers.JsonRpcProvider | new ethers.JsonRpcProvider
  keccak256         | ethers.utils.keccak256(...)          | ethers.keccak256(...)
  toUtf8Bytes       | ethers.utils.toUtf8Bytes(...)        | ethers.toUtf8Bytes(...)
  BigNumber         | BigNumber.from(x) object             | native BigInt (x = 42n)
  Gas used          | receipt.gasUsed (BigNumber object)   | receipt.gasUsed (BigInt) -> .toString()
  Event args        | event.args.fileId (BigNumber)        | event.args.fileId (BigInt) -> .toString()
  formatEther       | ethers.utils.formatEther(x)          | ethers.formatEther(x)
  Contract factory  | ethers.ContractFactory               | same (no change here)

### 9.3 Key ethers.js Usage in blockchainService.js

CONNECTION SETUP (lazy singleton):
  let contractInstance = null;

  async function getContract() {
    if (contractInstance) return contractInstance;
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY, provider);
    contractInstance = new ethers.Contract(
      process.env.BLOCKCHAIN_CONTRACT_ADDRESS,
      GenomicDataRegistryABI,
      wallet
    );
    return contractInstance;
  }

ORCID TO bytes32:
  // V1 — legacy keccak256
  function orcidToBytes32(orcid) {
    return ethers.keccak256(ethers.toUtf8Bytes(orcid.trim()));
    // '0000-0002-1825-0097' -> '0x3a8f1d...' (32 bytes)
  }

  // V2 — default (reviewer item R3.1)
  // ORCID identifiers are structured and publicly enumerable — unsalted keccak256
  // does not resist dictionary-style offline mapping from the ORCID registry.
  // Keying with HMAC-SHA256(secret, orcid) prevents this: without the secret,
  // the mapping cannot be reconstructed even with a complete ORCID list.
  function orcidToBytes32Hmac(orcid) {
    const mac = crypto.createHmac('sha256', Buffer.from(process.env.RESEARCHER_ID_HMAC_SECRET, 'hex'));
    mac.update(orcid.trim());
    return '0x' + mac.digest('hex');
    // Same ORCID + same secret -> same bytes32 every time (keyed pseudonymous derivation)
  }

SENDING A TRANSACTION:
  const tx = await contract.registerFile(fileHash, ipfsCID);
  const receipt = await tx.wait(1);      // wait 1 block confirmation
  const txHash = receipt.hash;           // '0x...' (64-char hex)
  const blockNumber = receipt.blockNumber; // e.g. 7234567
  const gasUsed = receipt.gasUsed.toString(); // BigInt -> String (JSON-safe)
  const success = receipt.status === 1;  // 1=success, 0=reverted

PARSING EVENTS FROM RECEIPT:
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === 'FileRegistered') {
        const fileId = parsed.args.fileId.toString(); // BigInt -> String
        const fileHash = parsed.args.fileHash;
      }
    } catch (e) {
      // log belongs to a different contract, skip
    }
  }

QUERYING HISTORICAL EVENTS:
  const events = await contract.queryFilter(
    contract.filters.AccessApproved(fileId, null), // fileId indexed, researcherId any
    0,        // fromBlock (0 = genesis)
    'latest'  // toBlock
  );
  // Returns: EventLog[] with .args, .blockNumber, .transactionHash, .fragment.name

READ-ONLY CALL (no gas, no transaction):
  const [hasAccess, expiryTime] = await contract.checkAccess(fileId, researcherId);
  // researcherId = same versioned bytes32 used at request time
  // Uses eth_call via Alchemy — free, instant

---

## 10. COMPLETE END-TO-END BLOCKCHAIN FLOW

### 10.1 File Registration Flow

  [Owner clicks 'Confirm Upload' in browser]
    -> POST /api/files/confirm-upload
    -> GenomicFile.create() in MongoDB
    -> HTTP 201 returned to frontend IMMEDIATELY

  [Background job starts (no await)]
    -> azureService.downloadBlobToBuffer(blobName) -> plainBuffer
    -> encryptionService.encryptBuffer(plainBuffer, key, iv) -> encryptedBuffer
    -> azureService.uploadEncryptedBuffer(blobName, encryptedBuffer) // overwrite
    -> fileHash = crypto.createHash('sha256').update(encryptedBuffer).digest('hex')
    -> tx = contract.registerFile(fileHash, 'pending')
    -> receipt = await tx.wait(1)   // ~12 seconds on Sepolia
    -> parsed = contract.interface.parseLog(receipt.logs[0])
    -> blockchainFileId = parsed.args.fileId.toString()
    -> MongoDB update: {blockchainFileId, blockchainTxHash, blockchainBlockNumber,
                        blockchainTimestamp, blockchainFileHash}

  [IPFS Phase — same background job continues]
    -> ipfsService.uploadToIPFS(encryptedBuffer) -> {cid, ipfsUrl}
    -> MongoDB update: {ipfsCid, ipfsUrl, ipfsStatus:'done'}

### 10.2 Access Request -> Approval -> Download Flow

  STEP 1: Researcher submits request
    -> AccessRequest.create({status:'pending', identityVersion:'v2'}) in MongoDB
    -> researcherBytes32 = orcidToBytes32Hmac(orcid)   // V2 HMAC-SHA256 by default
    -> contract.requestAccess(blockchainFileId, researcherBytes32)
    -> tx.wait(1) -> store receipt in MongoDB
    -> AccessRequested event on Sepolia (PERMANENT)

  STEP 2: Owner approves
    -> MongoDB: status='approved', accessExpiresAt = now + durationDays
    -> durationSeconds = durationDays * 24 * 60 * 60 (e.g. 30 days = 2,592,000 sec)
    -> contract.approveAccess(blockchainFileId, researcherBytes32, durationSeconds)
       // researcherBytes32 = same versioned bytes32 computed in Step 1 (V2 HMAC or V1 keccak, per identityVersion)
    -> tx.wait(1) -> store receipt in MongoDB
    -> AccessApproved event on Sepolia (PERMANENT, includes expiryTime)

  STEP 3: Researcher downloads
    -> GET /api/files/download/:fileId
    -> Check MongoDB: status=='approved' AND accessExpiresAt > now
    -> (Optional: also verify via contract.checkAccess() for double-check)
    -> retrieveEncryptionKey(fileId) from Azure Key Vault
    -> downloadBlobToBuffer(blobName) from Azure -> encryptedBuffer
    -> decryptBuffer(encryptedBuffer, keyHex, ivHex) -> plainBuffer
    -> res.send(plainBuffer) with Content-Disposition: attachment

### 10.3 Verification Flow

  [GET /api/blockchain/verify/:fileId]
    -> Fetch blockchainFileHash from MongoDB
    -> contract.getFileByHash(fileHash) -> {fileId, record} on-chain (read, no gas)
    -> If record.exists: verified=true, on-chain timestamp, IPFS CID
    -> Download current Azure blob -> compute SHA-256
    -> Compare current hash vs stored blockchainFileHash
    -> MATCH: INTACT — file not tampered since registration
    -> MISMATCH: TAMPERED — Azure blob modified after blockchain registration

---

## 11. BLOCKCHAIN SECURITY

### 11.1 Private Key Security
  BLOCKCHAIN_DEPLOYER_PRIVATE_KEY in backend .env
  .env is in .gitignore (never committed to GitHub)
  In production: use Azure Key Vault or AWS Secrets Manager for key storage
  If compromised: attacker can manipulate consent records but CANNOT access encrypted files
  (files protected by AES keys in separate Azure Key Vault, different auth)

### 11.2 Reentrancy Protection
  No external calls after state changes in any function
  All state changes happen BEFORE events are emitted
  No ETH transfers in our contract (reentrancy attacks target ETH transfers)
  Pattern: Check-Effects-Interactions (our contract follows this)

### 11.3 Integer Overflow Protection
  Solidity 0.8.x has BUILT-IN overflow protection
  uint256 arithmetic automatically reverts on overflow/underflow
  No need for SafeMath library (required in Solidity <0.8)

### 11.4 Access Control
  onlySystem modifier on ALL 5 write functions
  Contract address is public but write functions are locked to systemWallet
  Read functions (checkAccess, getFile, etc.) are open to anyone (intentional transparency)

### 11.5 Duplicate File Registration Prevention
  mapping(string => uint256) private _hashToId
  if (_hashToId[fileHash] != 0) revert HashAlreadyRegistered(fileHash)
  Prevents same encrypted file from being registered twice
  Detects accidental duplicate uploads

---

## 12. BLOCKCHAIN STATUS DASHBOARD

  GET /api/blockchain/status returns:
  {
    configured: true,             // env vars BLOCKCHAIN_RPC_URL and CONTRACT_ADDRESS present
    nodeOnline: true,             // provider.getNetwork() succeeded
    contractAddress: '0x...',    // deployed contract on Sepolia
    chainId: 11155111,            // confirms Sepolia (not mainnet accidentally)
    blockNumber: 7234567,         // current Sepolia block number
    totalRecords: 42,             // contract.getTotalRecords() — files registered
    deployerAddress: '0x...'     // systemWallet address
  }

  Frontend usage:
  - Shows 'Blockchain Connected' / 'Blockchain Offline' badge
  - If nodeOnline=false: blockchain features degrade gracefully
  - MongoDB still works as fallback (access control enforced by DB + JWT)
  - System does NOT go completely offline if blockchain RPC is unavailable

---

## 13. SUMMARY TABLE — EVERYTHING AT A GLANCE

  Aspect                  | Detail
  ---                     | ---
  Blockchain              | Ethereum Sepolia Testnet
  Chain ID                | 11155111
  Consensus               | Proof of Stake (same as Ethereum mainnet)
  Why Sepolia not local   | Persistent, public, verifiable, EVM-identical, Etherscan support, free
  Smart Contract Language | Solidity 0.8.24
  Contract Name           | GenomicDataRegistry
  Dev Framework           | Hardhat (compile, deploy, test)
  Backend Library         | ethers.js v6
  RPC Provider            | Alchemy (https://eth-sepolia.g.alchemy.com/v2/{KEY})
  Block Explorer          | https://sepolia.etherscan.io
  Gas Payment             | Single system wallet (SepoliaETH = free faucet)
  Gas Purpose             | Prevent spam, compensate validators, allocate block space
  registerFile() gas      | ~60,000-80,000 gas
  approveAccess() gas     | ~50,000-65,000 gas
  Researcher Identity     | V2 default: HMAC-SHA256(RESEARCHER_ID_HMAC_SECRET, ORCID) -> bytes32; V1 legacy: keccak256(ORCID)
  File Integrity          | SHA-256(encrypted_bytes) stored on-chain, verifiable any time
  Audit Events            | 5: FileRegistered, AccessRequested, AccessApproved, AccessRejected, AccessRevoked
  Event Indexing          | fileId and researcherId indexed (fast Alchemy filter queries)
  Audit Trail Query       | queryFilter for all 5 events, sorted by blockNumber (chronological)
  PDF Export              | jsPDF + jspdf-autotable (AuditLogs.tsx)
  ABI Location            | blockchain/artifacts/contracts/GenomicDataRegistry.sol/GenomicDataRegistry.json
  Deployment Command      | npx hardhat run scripts/deploy.js --network sepolia
  Why Blockchain at all   | Immutability + Transparency + Decentralization = cannot be tampered, deleted or faked

---

*Document: GenoVault Blockchain Complete Reference*
*Updated: September 2026 — Major Revision: R3.1 V2 ORCID identity (HMAC-SHA256), R3.3 wallet security service, non-blocking blockchain calls*
*Project: GenoVault — Secure Genomic Data Management Platform*
*Repository: https://github.com/Mokshith08/GenoVault*

