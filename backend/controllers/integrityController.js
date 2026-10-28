/**
 * integrityController.js
 * ──────────────────────────────────────────────────────────────────
 * Unit 6, Module 5 — Full 5-layer integrity status per file.
 *
 * Endpoints:
 *   GET /api/integrity/owner-stats       – aggregated owner dashboard stats
 *   GET /api/integrity/:fileId           – per-file 5-layer integrity check
 *
 * The 5 layers checked per file:
 *   1. SHA-256    – re-stream Azure blob, compare with blockchainFileHash
 *   2. Blockchain – call contract.getFileByHash() for live on-chain confirmation
 *   3. AES        – isEncrypted + encryptionIv present + Key Vault has key
 *   4. Azure      – blob exists (verifyBlobExists)
 *   5. IPFS       – ipfsStatus === "done" && ipfsCid non-null
 *
 * Each layer returns: { status, category, layer, reason?, timestamp }
 *   status   — "PASS" | "FAIL" | "SKIP" | "PENDING"
 *   category — one of 8 distinct categories (R3.4, see CATEGORIES below)
 *   layer    — which layer produced this result
 *
 * Overall category is derived by EXPLICIT RULES (not "worst" layer):
 *   1. Any INTEGRITY_VIOLATION       → overall = INTEGRITY_VIOLATION
 *   2. Any KEY_OR_DECRYPTION_FAILURE → overall = KEY_OR_DECRYPTION_FAILURE
 *   3. Any PRIMARY_STORAGE_UNAVAILABLE → overall = PRIMARY_STORAGE_UNAVAILABLE
 *   4. Any BACKUP_UNAVAILABLE (IPFS failed) → overall = BACKUP_UNAVAILABLE
 *   5. Any VERIFICATION_UNAVAILABLE  → overall = VERIFICATION_UNAVAILABLE
 *   6. IPFS PENDING + all others PASS → overall = PENDING (not a failure)
 *   7. All PASS/SKIP                 → overall = SECURE
 *
 * IMPORTANT: Per-layer results are always returned in full. The overall category
 * is a summary convenience for dashboards. Multiple simultaneous failures are
 * visible in the per-layer detail.
 *
 * All SHA-256 checks use streaming (getReadableBlobStream) — zero full-file buffer.
 */

const crypto       = require("crypto");
const GenomicFile  = require("../models/GenomicFile");
const AccessRequest = require("../models/AccessRequest");
const AuditLog     = require("../models/AuditLog");
const { getReadableBlobStream, verifyBlobExists } = require("../services/azureService");
const { retrieveEncryptionKey }                   = require("../services/keyVaultService");
const {
  isBlockchainConfigured,
  verifyFileHashOnChain,
} = require("../services/blockchainService");


// ─────────────────────────────────────────────────────────────────────────────
// Integrity Category Constants (R3.4)
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORIES = {
  SECURE:                   "SECURE",
  PENDING:                  "PENDING",
  INTEGRITY_VIOLATION:      "INTEGRITY_VIOLATION",
  VERIFICATION_UNAVAILABLE: "VERIFICATION_UNAVAILABLE",
  PRIMARY_STORAGE_UNAVAILABLE: "PRIMARY_STORAGE_UNAVAILABLE",
  BACKUP_UNAVAILABLE:       "BACKUP_UNAVAILABLE",
  KEY_OR_DECRYPTION_FAILURE:"KEY_OR_DECRYPTION_FAILURE",
  AUTHORIZATION_FAILURE:    "AUTHORIZATION_FAILURE",
};

/**
 * deriveOverallCategory (R3.4)
 * ───────────────────────────
 * Derives the overall category from layer results using EXPLICIT priority
 * rules. NOT derived by taking the "worst" category (which would recreate
 * the AT_RISK collapse problem).
 *
 * Per-layer results are always returned in full alongside the overall.
 * The overall is a summary convenience only.
 *
 * @param {object[]} layers  Array of layer result objects
 * @returns {string}         One of the CATEGORIES constants
 */
const deriveOverallCategory = (layers) => {
  const cats = layers.map(l => l.category).filter(Boolean);

  // Rule 1: Any integrity violation → highest severity
  if (cats.includes(CATEGORIES.INTEGRITY_VIOLATION))       return CATEGORIES.INTEGRITY_VIOLATION;
  // Rule 2: Key or decryption failure
  if (cats.includes(CATEGORIES.KEY_OR_DECRYPTION_FAILURE)) return CATEGORIES.KEY_OR_DECRYPTION_FAILURE;
  // Rule 3: Primary storage unavailable
  if (cats.includes(CATEGORIES.PRIMARY_STORAGE_UNAVAILABLE)) return CATEGORIES.PRIMARY_STORAGE_UNAVAILABLE;
  // Rule 4: Backup (IPFS) failed (not pending — that is rule 6)
  if (cats.includes(CATEGORIES.BACKUP_UNAVAILABLE))        return CATEGORIES.BACKUP_UNAVAILABLE;
  // Rule 5: Blockchain unreachable
  if (cats.includes(CATEGORIES.VERIFICATION_UNAVAILABLE))  return CATEGORIES.VERIFICATION_UNAVAILABLE;
  // Rule 6: IPFS still pending but everything else PASS/SKIP → PENDING (not a failure)
  if (cats.includes(CATEGORIES.PENDING))                   return CATEGORIES.PENDING;
  // Rule 7: All PASS or SKIP
  return CATEGORIES.SECURE;
};

// ─────────────────────────────────────────────────────────────────────────────
// Layer helpers — each returns { status, category, layer, reason?, timestamp }
// ─────────────────────────────────────────────────────────────────────────────

const checkSha256 = async (file) => {
  const ts = new Date().toISOString();

  // SHA-256 integrity check:
  //   1. Stream the current Azure blob → compute live SHA-256
  //   2. Compare against blockchainFileHash (registered on-chain at upload time)
  // PASS  → blob unchanged since blockchain registration
  // FAIL  → INTEGRITY_VIOLATION (file tampered or corrupted)
  // SKIP  → blockchainFileHash not yet stored (background job still pending)
  if (!file.blockchainFileHash) {
    return {
      status:   "SKIP",
      category: null,
      layer:    "SHA256",
      note:     "SHA-256 hash not yet stored — encryption background job may still be processing. Use retry-encryption if stuck.",
      timestamp: ts,
    };
  }

  try {
    const stream   = await getReadableBlobStream(file.azureBlobName);
    const hashCalc = crypto.createHash("sha256");

    await new Promise((resolve, reject) => {
      stream.on("data",  (chunk) => hashCalc.update(chunk));
      stream.on("end",   resolve);
      stream.on("error", reject);
    });

    const liveHash   = hashCalc.digest("hex");
    const storedHash = file.blockchainFileHash;
    const match      = liveHash === storedHash;

    return {
      status:     match ? "PASS" : "FAIL",
      category:   match ? CATEGORIES.SECURE : CATEGORIES.INTEGRITY_VIOLATION,
      layer:      "SHA256",
      storedHash,   // SHA-256 registered on blockchain at upload time
      liveHash,     // SHA-256 of current Azure blob (live streaming read)
      timestamp:  ts,
      ...(match ? {} : { reason: "SHA-256 mismatch — current blob differs from blockchain-anchored hash" }),
    };
  } catch (err) {
    return {
      status:    "FAIL",
      category:  CATEGORIES.PRIMARY_STORAGE_UNAVAILABLE,
      layer:     "SHA256",
      reason:    "Azure blob could not be streamed for SHA-256 verification",
      error:     err.message,
      timestamp: ts,
    };
  }
};



/* ─────────────────────────────────────────────────────────────────────────────
   Helper — on-chain registration check
   Uses verifyFileHashOnChain() which is already exported from blockchainService.
─────────────────────────────────────────────────────────────────────────────*/
const checkBlockchain = async (file) => {
  const ts = new Date().toISOString();
  if (!isBlockchainConfigured() || !file.blockchainFileHash) {
    return { status: "SKIP", category: null, layer: "BLOCKCHAIN", note: "Blockchain not configured or no hash stored", timestamp: ts };
  }
  try {
    const result = await verifyFileHashOnChain(file.blockchainFileHash);

    if (result.disabled) {
      return { status: "SKIP", category: null, layer: "BLOCKCHAIN", note: "Blockchain not configured", timestamp: ts };
    }

    return {
      status:          result.verified ? "PASS" : "FAIL",
      category:        result.verified ? CATEGORIES.SECURE : CATEGORIES.INTEGRITY_VIOLATION,
      layer:           "BLOCKCHAIN",
      onChainFileId:   result.fileId        ?? file.blockchainFileId ?? null,
      txHash:          file.blockchainTxHash    ?? null,
      blockNumber:     file.blockchainBlockNum  ?? null,
      registeredAt:    file.blockchainTimestamp ?? null,
      contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS ?? null,
      network:         "Ethereum Sepolia",
      chainId:         11155111,
      etherscanUrl:    file.blockchainTxHash
        ? `https://sepolia.etherscan.io/tx/${file.blockchainTxHash}`
        : null,
      timestamp:       ts,
      ...(result.verified ? {} : { reason: result.error || "File hash not found in on-chain registry" }),
    };
  } catch (err) {
    return {
      status:    "FAIL",
      category:  CATEGORIES.VERIFICATION_UNAVAILABLE,
      layer:     "BLOCKCHAIN",
      reason:    "Blockchain RPC unreachable or timed out",
      error:     err.message,
      timestamp: ts,
    };
  }
};


/* ─────────────────────────────────────────────────────────────────────────────
   Helper — AES encryption status
   PASS = isEncrypted true + IV present + Key Vault has the key
─────────────────────────────────────────────────────────────────────────────*/
const checkAes = async (file) => {
  const ts = new Date().toISOString();
  if (!file.isEncrypted) {
    return { status: "FAIL", category: CATEGORIES.KEY_OR_DECRYPTION_FAILURE, layer: "AES", reason: "File is not marked as encrypted", timestamp: ts };
  }

  const hasIv = Boolean(file.encryptionIv);

  let keyOk = false;
  try {
    const key = await retrieveEncryptionKey(String(file._id));
    keyOk = Boolean(key && key.length === 64);
  } catch {
    keyOk = false;
  }

  if (!hasIv) {
    return { status: "FAIL", category: CATEGORIES.KEY_OR_DECRYPTION_FAILURE, layer: "AES", reason: "AES IV missing from database", keyOk, timestamp: ts };
  }
  if (!keyOk) {
    return { status: "FAIL", category: CATEGORIES.KEY_OR_DECRYPTION_FAILURE, layer: "AES", reason: "AES key not found in Key Vault", hasIv, timestamp: ts };
  }
  return {
    status:            "PASS",
    category:          CATEGORIES.SECURE,
    layer:             "AES",
    algorithm:         "AES-256-CBC",
    encryptionVersion: file.encryptionVersion ?? "v1",
    hasIv,
    keyOk,
    timestamp:         ts,
  };
};

/* ─────────────────────────────────────────────────────────────────────────────
   Helper — Azure blob existence
─────────────────────────────────────────────────────────────────────────────*/
const checkAzure = async (file) => {
  const ts = new Date().toISOString();
  try {
    const exists = await verifyBlobExists(file.azureBlobName);
    return {
      status:    exists ? "PASS" : "FAIL",
      category:  exists ? CATEGORIES.SECURE : CATEGORIES.PRIMARY_STORAGE_UNAVAILABLE,
      layer:     "AZURE",
      blobName:  file.azureBlobName,
      timestamp: ts,
      ...(exists ? {} : { reason: "Blob not found in Azure Blob Storage" }),
    };
  } catch (err) {
    return {
      status:    "FAIL",
      category:  CATEGORIES.PRIMARY_STORAGE_UNAVAILABLE,
      layer:     "AZURE",
      reason:    "Azure service unreachable",
      error:     err.message,
      timestamp: ts,
    };
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   Helper — IPFS backup status
─────────────────────────────────────────────────────────────────────────────*/
const checkIpfs = (file) => {
  const ts     = new Date().toISOString();
  const done   = file.ipfsStatus === "done" && Boolean(file.ipfsCid);
  const failed = file.ipfsStatus === "failed";

  if (done) {
    return {
      status:     "PASS",
      category:   CATEGORIES.SECURE,
      layer:      "IPFS",
      cid:        file.ipfsCid,
      ipfsStatus: file.ipfsStatus,
      ipfsUrl:    file.ipfsUrl ?? null,
      timestamp:  ts,
    };
  }
  if (failed) {
    return {
      status:     "FAIL",
      category:   CATEGORIES.BACKUP_UNAVAILABLE,
      layer:      "IPFS",
      cid:        file.ipfsCid ?? null,
      ipfsStatus: file.ipfsStatus,
      reason:     "IPFS backup failed — backup unavailable",
      timestamp:  ts,
    };
  }
  // Pending / uploading — NOT a failure
  return {
    status:     "PENDING",
    category:   CATEGORIES.PENDING,
    layer:      "IPFS",
    cid:        file.ipfsCid ?? null,
    ipfsStatus: file.ipfsStatus,
    note:       "IPFS backup not yet completed — not a failure",
    timestamp:  ts,
  };
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/integrity/:fileId
   Protected – owner role only (file owner)
─────────────────────────────────────────────────────────────────────────────*/
const getFileIntegrity = async (req, res) => {
  try {
    const { fileId } = req.params;
    const ownerId    = req.user.userId;

    // Fetch with encryptionIv (needed for AES check) and uploadSha256Hash (needed for SHA check)
    const file = await GenomicFile.findById(fileId).select("+encryptionIv +uploadSha256Hash");
    if (!file || file.uploadStatus !== "confirmed") {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    if (String(file.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // ?skipSha=true → skip blob streaming (fast auto-check on page load).
    // Omit the param for the full Re-verify with live SHA-256 comparison.
    const skipSha = req.query.skipSha === "true";

    // SHA-256: streams the full blob — skip for fast auto-checks
    const sha256Result = skipSha
      ? {
          status:    "SKIP",
          category:  null,
          layer:     "SHA256",
          note:      "Click Re-verify for live SHA-256 comparison against stored hash",
          timestamp: new Date().toISOString(),
        }
      : await checkSha256(file);

    const [blockchainResult, aesResult, azureResult] = await Promise.all([
      checkBlockchain(file),
      checkAes(file),
      checkAzure(file),
    ]);
    const ipfsResult = checkIpfs(file);

    // Overall: derived by explicit priority rules (R3.4)
    const allLayers = [sha256Result, blockchainResult, aesResult, azureResult, ipfsResult];
    const overallCategory = deriveOverallCategory(allLayers);


    return res.status(200).json({
      success:   true,
      fileId:    String(file._id),
      fileName:  file.originalName,
      datasetId: file.datasetId ?? null,
      // Per-layer results — authoritative source of information
      checks: {
        sha256:     sha256Result,
        blockchain: blockchainResult,
        aes:        aesResult,
        azure:      azureResult,
        ipfs:       ipfsResult,
      },
      // Overall — summary convenience only; see per-layer checks for full detail
      overall:          overallCategory,
      overallIsFailure: ![
        CATEGORIES.SECURE,
        CATEGORIES.PENDING,
      ].includes(overallCategory),
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[integrityController] getFileIntegrity:", err);
    return res.status(500).json({ success: false, message: "Integrity check failed" });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/integrity/owner-stats
   Protected – owner role only
   Aggregated stats for the owner integrity dashboard.
─────────────────────────────────────────────────────────────────────────────*/
const getOwnerStats = async (req, res) => {
  try {
    const ownerId = req.user.userId;

    // 1. Total datasets owned
    const totalDatasets = await GenomicFile.countDocuments({
      owner:        ownerId,
      uploadStatus: "confirmed",
    });

    // 2. Files with blockchain registration (blockchain txs)
    const blockchainRegistered = await GenomicFile.countDocuments({
      owner:             ownerId,
      uploadStatus:      "confirmed",
      blockchainTxHash:  { $ne: null },
    });

    // 3. Access requests by status
    const [pendingCount, approvedCount, rejectedCount, revokedCount] = await Promise.all([
      AccessRequest.countDocuments({ owner: ownerId, status: "pending"  }),
      AccessRequest.countDocuments({ owner: ownerId, status: "approved" }),
      AccessRequest.countDocuments({ owner: ownerId, status: { $in: ["denied", "rejected"] } }),
      AccessRequest.countDocuments({ owner: ownerId, status: "revoked"  }),
    ]);

    const totalRequests = pendingCount + approvedCount + rejectedCount + revokedCount;

    // 4. Integrity check counts from AuditLog
    // AuditLog stores userId of the researcher who downloaded, so we cross-reference
    // via files owned by this owner.
    const ownerFileIds = await GenomicFile.find({ owner: ownerId, uploadStatus: "confirmed" })
      .select("_id")
      .lean()
      .then(docs => docs.map(d => d._id));

    const [verifiedCount, failedCount] = await Promise.all([
      AuditLog.countDocuments({ fileId: { $in: ownerFileIds }, operation: "INTEGRITY_VERIFIED" }),
      AuditLog.countDocuments({ fileId: { $in: ownerFileIds }, operation: "INTEGRITY_FAILED"   }),
    ]);

    // 5. Recent 10 audit events from AuditLog (for this owner's files)
    const recentEvents = await AuditLog.find({ fileId: { $in: ownerFileIds } })
      .sort({ timestamp: -1 })
      .limit(10)
      .populate("fileId", "originalName datasetId")
      .populate("userId", "name email")
      .lean();

    return res.status(200).json({
      success: true,
      stats: {
        totalDatasets,
        blockchainRegistered,
        totalRequests,
        pendingCount,
        approvedCount,
        rejectedCount,
        revokedCount,
        integrityVerified: verifiedCount,
        integrityFailed:   failedCount,
        totalIntegrityChecks: verifiedCount + failedCount,
      },
      recentActivity: recentEvents.map(e => ({
        id:        String(e._id),
        operation: e.operation,
        status:    e.status,
        fileName:  e.fileId?.originalName ?? "Unknown",
        datasetId: e.fileId?.datasetId    ?? null,
        actor:     e.userId?.name         ?? "Unknown",
        details:   e.details,
        timestamp: e.timestamp,
      })),
    });
  } catch (err) {
    console.error("[integrityController] getOwnerStats:", err);
    return res.status(500).json({ success: false, message: "Failed to load integrity stats" });
  }
};

module.exports = { getFileIntegrity, getOwnerStats };
