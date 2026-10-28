/**
 * blockchainService.js
 * --------------------
 * GenoVault backend blockchain service - v2
 * Single deployer wallet, onlySystem contract.
 *
 * Researcher identity derivation:
 *   V1 (legacy)  — keccak256(ORCID)              used for all existing on-chain records
 *   V2 (current) — HMAC-SHA256(secret, ORCID)    used for all new access requests
 *
 * V1 is preserved unchanged for backward compatibility with immutable Sepolia records.
 * New requests set identityVersion='v2' on the AccessRequest document.
 */
const { ethers } = require('ethers');
const crypto     = require('crypto');

const CONTRACT_ABI = [
  'function registerFile(string calldata fileHash, string calldata ipfsCID) external returns (uint256 fileId)',
  'function requestAccess(uint256 fileId, bytes32 researcherId) external',
  'function approveAccess(uint256 fileId, bytes32 researcherId, uint256 durationSeconds) external',
  'function rejectAccess(uint256 fileId, bytes32 researcherId) external',
  'function revokeAccess(uint256 fileId, bytes32 researcherId) external',
  'function getFile(uint256 fileId) external view returns (tuple(string fileHash, address owner, uint256 timestamp, string ipfsCID, bool exists))',
  'function getFileByHash(string calldata fileHash) external view returns (uint256 fileId, tuple(string fileHash, address owner, uint256 timestamp, string ipfsCID, bool exists) record)',
  'function checkAccess(uint256 fileId, bytes32 researcherId) external view returns (bool hasAccess, uint256 expiryTime)',
  'function getPermission(uint256 fileId, bytes32 researcherId) external view returns (tuple(bool approved, uint256 grantedAt, uint256 expiryTime))',
  'function getFileRequests(uint256 fileId) external view returns (tuple(bytes32 researcherId, uint256 requestedAt, uint8 status)[])',
  'function getRequest(uint256 fileId, bytes32 researcherId) external view returns (tuple(bytes32 researcherId, uint256 requestedAt, uint8 status))',
  'function getTotalRecords() external view returns (uint256)',
  'function systemWallet() external view returns (address)',
  'event FileRegistered(uint256 indexed fileId, string fileHash, string ipfsCID, uint256 timestamp)',
  'event AccessRequested(uint256 indexed fileId, bytes32 indexed researcherId, uint256 requestedAt)',
  'event AccessApproved(uint256 indexed fileId, bytes32 indexed researcherId, uint256 expiryTime, uint256 grantedAt)',
  'event AccessRejected(uint256 indexed fileId, bytes32 indexed researcherId, uint256 rejectedAt)',
  'event AccessRevoked(uint256 indexed fileId, bytes32 indexed researcherId, uint256 revokedAt)',
];


// Reset cached contract instances so the updated ABI takes effect immediately
let _provider = null, _wallet = null, _contract = null, _readOnlyProv = null, _readOnlyCtx = null;


const isBlockchainConfigured = () =>
  Boolean(process.env.BLOCKCHAIN_RPC_URL) &&
  Boolean(process.env.BLOCKCHAIN_CONTRACT_ADDRESS) &&
  Boolean(process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY);

const getContract = () => {
  if (_contract) return _contract;
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
  const privateKey = process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY;
  const address = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
  if (!rpcUrl || !privateKey || !address) throw new Error('[Blockchain] Missing env vars');
  _provider = new ethers.JsonRpcProvider(rpcUrl);
  _wallet = new ethers.Wallet(privateKey.trim(), _provider);
  _contract = new ethers.Contract(address, CONTRACT_ABI, _wallet);
  console.log('[Blockchain] Connected to contract at ' + address);
  return _contract;
};

const getReadOnlyContract = () => {
  if (_readOnlyCtx) return _readOnlyCtx;
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
  const address = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
  if (!rpcUrl || !address) throw new Error('[Blockchain] Missing RPC URL or contract address');
  _readOnlyProv = new ethers.JsonRpcProvider(rpcUrl);
  _readOnlyCtx = new ethers.Contract(address, CONTRACT_ABI, _readOnlyProv);
  return _readOnlyCtx;
};

/**
 * orcidToBytes32  (V1 — LEGACY)
 * -------------------------------------------------------------------
 * Converts a researcher ORCID to bytes32 via keccak256.
 * Used for ALL existing on-chain records (Sepolia, immutable).
 * Raw ORCID is never written on-chain.
 *
 * ⚠️  Do NOT use for new access requests — use orcidToBytes32Hmac.
 *     This function is preserved solely for backward compatibility.
 *
 * @param {string} orcid  e.g. "0000-0002-1825-0097"
 * @returns {string}      bytes32 hex string (0x-prefixed)
 */
const orcidToBytes32 = (orcid) => {
  if (!orcid || typeof orcid !== 'string') throw new Error('[Blockchain] orcidToBytes32: ORCID must be non-empty string');
  return ethers.keccak256(ethers.toUtf8Bytes(orcid.trim()));
};

/**
 * orcidToBytes32Hmac  (V2 — CURRENT)
 * -------------------------------------------------------------------
 * Converts a researcher ORCID to bytes32 via HMAC-SHA256 keyed with
 * RESEARCHER_ID_HMAC_SECRET. This is a keyed pseudonymous derivation:
 * the mapping from ORCID to bytes32 cannot be reconstructed without
 * the secret, preventing dictionary-style attacks against the on-chain
 * researcher identifiers.
 *
 * Security properties:
 *   - Same ORCID + same secret  → same identifier (deterministic) ✓
 *   - Different ORCID            → different identifier           ✓
 *   - Without the secret         → identifier cannot be derived   ✓
 *   - HMAC-SHA256 output is 32 bytes, which maps directly to bytes32
 *
 * Note: this is keyed pseudonymity, not anonymity. The identifier
 * is stable and linkable across requests by anyone holding the secret.
 *
 * @param {string} orcid  e.g. "0000-0002-1825-0097"
 * @returns {string}      bytes32 hex string (0x-prefixed, 66 chars total)
 */
const orcidToBytes32Hmac = (orcid) => {
  if (!orcid || typeof orcid !== 'string') {
    throw new Error('[Identity] orcidToBytes32Hmac: ORCID must be a non-empty string');
  }
  const secret = process.env.RESEARCHER_ID_HMAC_SECRET;
  if (!secret) {
    throw new Error('[Identity] RESEARCHER_ID_HMAC_SECRET is not configured — cannot derive researcher identifier');
  }
  // HMAC-SHA256 output is exactly 32 bytes → maps directly to bytes32
  const mac = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(orcid.trim())
    .digest();
  return '0x' + mac.toString('hex');
};

/**
 * parseReceipt - extract rich metadata from a transaction receipt.
 */
const parseReceipt = (receipt, blockTimestamp) => ({
  blockchainTxHash: receipt.hash,
  blockchainBlock: receipt.blockNumber,
  gasUsed: receipt.gasUsed.toString(),
  transactionStatus: receipt.status === 1 ? 'success' : 'failed',
  timestamp: blockTimestamp ? new Date(blockTimestamp * 1000) : new Date(),
  etherscanUrl: 'https://sepolia.etherscan.io/tx/' + receipt.hash,
});

const registerFileOnChain = async (sha256HexHash, ipfsCID) => {
  ipfsCID = ipfsCID || '';
  if (!isBlockchainConfigured()) { console.warn('[Blockchain] Not configured - skipping'); return { success: false, disabled: true, error: 'Blockchain not configured' }; }
  try {
    const contract = getContract();
    const tx = await contract.registerFile(sha256HexHash, ipfsCID);
    const receipt = await tx.wait(1);
    const block = await _provider.getBlock(receipt.blockNumber);
    let fileId = null;
    for (const log of receipt.logs) { try { const p = contract.interface.parseLog({ topics: log.topics, data: log.data }); if (p && p.name === 'FileRegistered') fileId = Number(p.args.fileId); } catch {} }
    console.log('[Blockchain] File registered. fileId=' + fileId + ' block#' + receipt.blockNumber);
    return { success: true, fileId, disabled: false, error: null, ...parseReceipt(receipt, block && block.timestamp) };
  } catch (err) {
    if (err.message && (err.message.includes('HashAlreadyRegistered') || err.message.includes('already registered'))) return { success: false, disabled: false, error: 'Hash already registered on-chain' };
    console.error('[Blockchain] registerFileOnChain failed:', err.message);
    return { success: false, disabled: false, error: err.message };
  }
};

const storeFileHashOnChain = (h) => registerFileOnChain(h, '');

// Correct ABI for getFileByHash — matches the deployed contract struct:
// FileRecord { string fileHash; address owner; uint256 timestamp; string ipfsCID; bool exists; }
// Always creates a fresh instance to avoid stale cached contract with wrong ABI.
const VERIFY_ABI = [
  'function getFileByHash(string calldata fileHash) external view returns (uint256 fileId, tuple(string fileHash, address owner, uint256 timestamp, string ipfsCID, bool exists) record)',
];

const verifyFileHashOnChain = async (sha256HexHash) => {
  if (!isBlockchainConfigured()) return { verified: false, disabled: true, error: 'Blockchain not configured' };
  try {
    // Always create fresh provider + contract — bypasses any cached instance with stale ABI
    const rpcUrl  = process.env.BLOCKCHAIN_RPC_URL;
    const address = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(address, VERIFY_ABI, provider);

    const [fileId, record] = await contract.getFileByHash(sha256HexHash);
    if (Number(fileId) === 0) return { verified: false, fileId: null, disabled: false, error: null };
    return {
      verified:   true,
      fileId:     Number(fileId),
      fileHash:   record.fileHash,
      owner:      record.owner,
      timestamp:  new Date(Number(record.timestamp) * 1000).toISOString(),
      ipfsCID:    record.ipfsCID,
      disabled:   false,
      error:      null,
    };
  } catch (err) {
    if (err.message && err.message.includes('Hash not registered')) return { verified: false, fileId: null, disabled: false, error: null };
    console.error('[Blockchain] verifyFileHashOnChain failed:', err.message);
    return { verified: false, disabled: false, error: err.message };
  }
};

const requestAccess = async (fileId, researcherOrcid) => {
  if (!isBlockchainConfigured()) return { success: false, disabled: true };
  try {
    const researcherId = orcidToBytes32(researcherOrcid);
    const contract = getContract();
    const tx = await contract.requestAccess(fileId, researcherId);
    const receipt = await tx.wait(1);
    const block = await _provider.getBlock(receipt.blockNumber);
    console.log('[Blockchain] AccessRequested fileId=' + fileId + ' block#' + receipt.blockNumber);
    return { success: true, error: null, ...parseReceipt(receipt, block && block.timestamp) };
  } catch (err) { console.error('[Blockchain] requestAccess failed:', err.message); return { success: false, error: err.message }; }
};

const approveAccess = async (fileId, researcherOrcid, durationSeconds) => {
  durationSeconds = durationSeconds || 86400;
  if (!isBlockchainConfigured()) return { success: false, disabled: true };
  try {
    const researcherId = orcidToBytes32(researcherOrcid);
    const contract = getContract();
    const tx = await contract.approveAccess(fileId, researcherId, durationSeconds);
    const receipt = await tx.wait(1);
    const block = await _provider.getBlock(receipt.blockNumber);
    const expiry = new Date((Date.now() / 1000 + durationSeconds) * 1000).toISOString();
    console.log('[Blockchain] AccessApproved fileId=' + fileId + ' block#' + receipt.blockNumber);
    return { success: true, expiresAt: expiry, error: null, ...parseReceipt(receipt, block && block.timestamp) };
  } catch (err) { console.error('[Blockchain] approveAccess failed:', err.message); return { success: false, error: err.message }; }
};

const rejectAccess = async (fileId, researcherOrcid) => {
  if (!isBlockchainConfigured()) return { success: false, disabled: true };
  try {
    const researcherId = orcidToBytes32(researcherOrcid);
    const contract = getContract();
    const tx = await contract.rejectAccess(fileId, researcherId);
    const receipt = await tx.wait(1);
    const block = await _provider.getBlock(receipt.blockNumber);
    console.log('[Blockchain] AccessRejected fileId=' + fileId + ' block#' + receipt.blockNumber);
    return { success: true, error: null, ...parseReceipt(receipt, block && block.timestamp) };
  } catch (err) { console.error('[Blockchain] rejectAccess failed:', err.message); return { success: false, error: err.message }; }
};

const revokeAccess = async (fileId, researcherOrcid) => {
  if (!isBlockchainConfigured()) return { success: false, disabled: true };
  try {
    const researcherId = orcidToBytes32(researcherOrcid);
    const contract = getContract();
    const tx = await contract.revokeAccess(fileId, researcherId);
    const receipt = await tx.wait(1);
    const block = await _provider.getBlock(receipt.blockNumber);
    console.log('[Blockchain] AccessRevoked fileId=' + fileId + ' block#' + receipt.blockNumber);
    return { success: true, error: null, ...parseReceipt(receipt, block && block.timestamp) };
  } catch (err) { console.error('[Blockchain] revokeAccess failed:', err.message); return { success: false, error: err.message }; }
};

const checkAccess = async (fileId, researcherOrcid) => {
  if (!isBlockchainConfigured()) return { hasAccess: false, disabled: true };
  try {
    const researcherId = orcidToBytes32(researcherOrcid);
    const contract = getReadOnlyContract();
    const [hasAccess, expiryBig] = await contract.checkAccess(fileId, researcherId);
    return { hasAccess, expiresAt: hasAccess ? new Date(Number(expiryBig) * 1000).toISOString() : null, disabled: false };
  } catch (err) { console.error('[Blockchain] checkAccess failed:', err.message); return { hasAccess: false, error: err.message }; }
};

const getPendingRequests = async (fileId) => {
  if (!isBlockchainConfigured()) return [];
  try {
    const contract = getReadOnlyContract();
    const requests = await contract.getFileRequests(fileId);
    const S = { 0: 'None', 1: 'Pending', 2: 'Approved', 3: 'Rejected' };
    return requests.map((req) => ({ researcherId: req.researcherId, requestedAt: new Date(Number(req.requestedAt) * 1000).toISOString(), status: S[Number(req.status)] || 'Unknown', statusCode: Number(req.status) }));
  } catch (err) { console.error('[Blockchain] getPendingRequests failed:', err.message); return []; }
};

const getAuditTrail = async (fileId) => {
  if (!isBlockchainConfigured()) return [];
  try {
    const contract = getReadOnlyContract();
    const events = [];
    for (const e of await contract.queryFilter(contract.filters.FileRegistered(fileId), 0, 'latest')) events.push({ type: 'FileRegistered', fileId: Number(e.args.fileId), fileHash: e.args.fileHash, ipfsCID: e.args.ipfsCID, timestamp: new Date(Number(e.args.timestamp) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber });
    for (const e of await contract.queryFilter(contract.filters.AccessRequested(fileId), 0, 'latest')) events.push({ type: 'AccessRequested', fileId: Number(e.args.fileId), researcherId: e.args.researcherId, requestedAt: new Date(Number(e.args.requestedAt) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber });
    for (const e of await contract.queryFilter(contract.filters.AccessApproved(fileId), 0, 'latest')) events.push({ type: 'AccessApproved', fileId: Number(e.args.fileId), researcherId: e.args.researcherId, expiryTime: new Date(Number(e.args.expiryTime) * 1000).toISOString(), grantedAt: new Date(Number(e.args.grantedAt) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber });
    for (const e of await contract.queryFilter(contract.filters.AccessRejected(fileId), 0, 'latest')) events.push({ type: 'AccessRejected', fileId: Number(e.args.fileId), researcherId: e.args.researcherId, rejectedAt: new Date(Number(e.args.rejectedAt) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber });
    for (const e of await contract.queryFilter(contract.filters.AccessRevoked(fileId), 0, 'latest')) events.push({ type: 'AccessRevoked', fileId: Number(e.args.fileId), researcherId: e.args.researcherId, revokedAt: new Date(Number(e.args.revokedAt) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber });
    events.sort((a, b) => a.blockNumber - b.blockNumber);
    return events;
  } catch (err) { console.error('[Blockchain] getAuditTrail failed:', err.message); return []; }
};

const getContractEvents = async () => {
  if (!isBlockchainConfigured()) return [];
  try {
    const contract = getReadOnlyContract();
    const events = await contract.queryFilter(contract.filters.FileRegistered(), 0, 'latest');
    return events.map((e) => ({ fileId: Number(e.args.fileId), fileHash: e.args.fileHash, ipfsCID: e.args.ipfsCID, timestamp: new Date(Number(e.args.timestamp) * 1000).toISOString(), txHash: e.transactionHash, blockNumber: e.blockNumber }));
  } catch (err) { console.error('[Blockchain] getContractEvents failed:', err.message); return []; }
};

const getBlockchainStatus = async () => {
  if (!isBlockchainConfigured()) return { configured: false, nodeOnline: false, contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || null, network: 'Sepolia Testnet', chainId: null, blockNumber: null, totalRecords: null };
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
    const contract = getReadOnlyContract();
    const totalRecords = await contract.getTotalRecords();
    return { configured: true, nodeOnline: true, contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS, network: 'Sepolia Testnet', etherscanUrl: 'https://sepolia.etherscan.io/address/' + process.env.BLOCKCHAIN_CONTRACT_ADDRESS, chainId: Number(network.chainId), blockNumber, totalRecords: Number(totalRecords) };
  } catch (err) { console.error('[Blockchain] getBlockchainStatus error:', err.message); return { configured: true, nodeOnline: false, contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || null, network: 'Sepolia Testnet', error: err.message }; }
};

const getRecentBlocks = async (count) => {
  count = count || 10;
  const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - count + 1);
  const blocks = [];
  for (let n = latest; n >= from; n--) { const b = await provider.getBlock(n, true); if (!b) continue; blocks.push({ blockNumber: b.number, hash: b.hash, parentHash: b.parentHash, timestamp: new Date(Number(b.timestamp) * 1000).toISOString(), miner: b.miner, gasUsed: b.gasUsed.toString(), gasLimit: b.gasLimit.toString(), txCount: b.transactions.length, transactions: b.transactions.map((t) => (typeof t === 'string' ? t : t.hash)) }); }
  return blocks;
};

const getTransactionDetails = async (txHash) => {
  const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
  if (!tx || !receipt) return null;
  let decodedEvents = [];
  try { const iface = new ethers.Interface(CONTRACT_ABI); for (const log of receipt.logs) { try { const parsed = iface.parseLog({ topics: log.topics, data: log.data }); if (parsed) { const args = {}; parsed.fragment.inputs.forEach((inp) => { const val = parsed.args[inp.name]; args[inp.name] = typeof val === 'bigint' ? val.toString() : val; }); decodedEvents.push({ name: parsed.name, args }); } } catch {} } } catch {}
  return { hash: tx.hash, from: tx.from, to: tx.to, value: ethers.formatEther(tx.value), gasUsed: receipt.gasUsed.toString(), gasPrice: tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') + ' gwei' : null, blockNumber: receipt.blockNumber, status: receipt.status === 1 ? 'success' : 'failed', contractCreated: receipt.contractAddress || null, decodedEvents, etherscanUrl: 'https://sepolia.etherscan.io/tx/' + txHash };
};

module.exports = {
  isBlockchainConfigured,
  // Identity derivation — V1 (legacy keccak256) and V2 (HMAC-SHA256)
  orcidToBytes32,
  orcidToBytes32Hmac,
  // File registration & verification
  registerFileOnChain,
  storeFileHashOnChain,
  verifyFileHashOnChain,
  // Access control
  requestAccess,
  approveAccess,
  rejectAccess,
  revokeAccess,
  checkAccess,
  getPendingRequests,
  // Audit & explorer
  getAuditTrail,
  getContractEvents,
  getBlockchainStatus,
  getRecentBlocks,
  getTransactionDetails,
};
