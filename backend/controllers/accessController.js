/**
 * accessController.js
 * ───────────────────
 * Implements the secure access control + decryption pipeline:
 *
 *  POST /api/access/request-access    – Researcher requests a file
 *  POST /api/access/approve-request   – Owner approves (marks approved)
 *  POST /api/access/verify-pin        – Owner verifies 6-digit PIN → grants time-limited token
 *  GET  /api/access/download/:fileId  – Researcher downloads (decrypt on-demand)
 *  GET  /api/access/my-requests       – Researcher sees their own requests
 *  GET  /api/access/incoming-requests – Owner sees requests for their files
 *
 * Security guarantees:
 *  ✅ AES key NEVER leaves Key Vault to the frontend
 *  ✅ Decrypted bytes NEVER persisted — streamed once and discarded
 *  ✅ PIN verified via bcrypt against stored hash
 *  ✅ Access is time-limited (ACCESS_GRANT_HOURS, default 24h)
 *  ✅ Only approved researchers can download
 */

const bcrypt         = require("bcryptjs");
const crypto         = require("crypto");
const { pipeline }   = require("stream");
const User           = require("../models/User");
const GenomicFile    = require("../models/GenomicFile");
const AccessRequest  = require("../models/AccessRequest");
const WatermarkRegistry = require("../models/WatermarkRegistry");
const { retrieveEncryptionKey, retrievePinHash } = require("../services/keyVaultService");
const { getReadableBlobStream, downloadBlobToBuffer } = require("../services/azureService");
const { logEvent }                               = require("../services/auditLogService");
const { registerFileOnChain, isBlockchainConfigured } = require("../services/blockchainService");

const wmService = require("../services/watermarkService");

const {
  requestAccess:   blockchainRequestAccess,
  approveAccess:   blockchainApproveAccess,
  rejectAccess:    blockchainRejectAccess,
  revokeAccess:    blockchainRevokeAccess,
  checkAccess:     blockchainCheckAccess,
} = require("../services/blockchainService");

const ACCESS_GRANT_HOURS = parseInt(process.env.ACCESS_GRANT_HOURS) || 24;

/* ─────────────────────────────────────────────────────────────────
   POST /api/access/request-access
   Protected – researcher role only

   Body: { fileId, reason? }
   → Creates an AccessRequest with status "pending"
─────────────────────────────────────────────────────────────────*/
const requestAccess = async (req, res) => {
  try {
    const {
      fileId,
      reason,
      projectTitle,
      purpose,
      accessType,
      extensionRequested,
      dataSharedWithCollaborators,
      institution,
      contactEmail,
      benefits,
      risks,
    } = req.body;
    const researcherId = req.user.userId;

    if (!fileId) {
      return res.status(400).json({ success: false, message: "fileId is required" });
    }

    // Find the file and its owner
    const file = await GenomicFile.findById(fileId);
    if (!file || file.uploadStatus !== "confirmed") {
      return res.status(404).json({ success: false, message: "File not found" });
    }

    // Prevent owner from requesting their own file
    if (String(file.owner) === String(researcherId)) {
      return res.status(400).json({ success: false, message: "You cannot request access to your own file" });
    }

    // ── Cooldown / conflict check ─────────────────────────────────────────
    // Find the MOST RECENT request for this file by this researcher
    const existing = await AccessRequest.findOne(
      { file: fileId, researcher: researcherId },
      null,
      { sort: { createdAt: -1 } }   // most recent first
    );

    if (existing) {
      const COOLDOWN_MS   = 24 * 60 * 60 * 1000; // 24 hours
      const now           = Date.now();

      // "approved" is only truly active if the access window hasn't expired
      const isApprovedAndActive =
        existing.status === "approved" &&
        existing.accessExpiresAt &&
        new Date(existing.accessExpiresAt).getTime() > now;

      // Active states — cannot re-request regardless of time
      if (existing.status === "pending" || existing.status === "more-info" || isApprovedAndActive) {
        return res.status(409).json({
          success:       false,
          message:       `A request already exists with status: ${existing.status}`,
          request:       existing,
          cooldownUntil: null, // blocked until owner acts
        });
      }

      // All other states: denied / rejected / revoked / expired-approved
      // Enforce 24h cooldown from when the request was CREATED
      const cooldownUntil = new Date(existing.createdAt.getTime() + COOLDOWN_MS);
      if (cooldownUntil.getTime() > now) {
        return res.status(429).json({
          success:       false,
          message:       "You must wait 24 hours before requesting access to this dataset again.",
          cooldownUntil: cooldownUntil.toISOString(),
        });
      }
      // Cooldown expired — delete old request so a fresh one can be created
      await AccessRequest.deleteOne({ _id: existing._id });
    }

    const accessRequest = await AccessRequest.create({
      file:       fileId,
      fileName:   file.originalName,           // snapshot — survives file deletion
      researcher: researcherId,
      owner:      file.owner,
      // Legacy field
      reason: reason || purpose || "",
      // Structured fields
      projectTitle:               projectTitle || "",
      purpose:                    purpose      || reason || "",
      accessType:                 accessType   || "read-only",
      extensionRequested:         !!extensionRequested,
      dataSharedWithCollaborators:!!dataSharedWithCollaborators,
      institution:                institution  || "",
      contactEmail:               contactEmail || "",
      benefits:                   benefits     || "",
      risks:                      risks        || "",
      status:                     "pending",
    });

    // -- Blockchain: record access request on-chain (non-blocking)
    // Requires the researcher to have an ORCID set in their profile.
    if (isBlockchainConfigured() && file.blockchainFileId) {
      const researcher = await User.findById(researcherId).select("orcid");
      if (researcher && researcher.orcid) {
        // Mark as submitted BEFORE the async call (R2.3 blockchain state machine)
        await AccessRequest.findByIdAndUpdate(accessRequest._id, {
          requestBlockchainStatus: "submitted",
        });
        blockchainRequestAccess(file.blockchainFileId, researcher.orcid)
          .then(async (bcResult) => {
            if (bcResult.success) {
              await AccessRequest.findByIdAndUpdate(accessRequest._id, {
                requestTxHash:            bcResult.blockchainTxHash,
                requestBlockNumber:       bcResult.blockchainBlock,
                requestGasUsed:          bcResult.gasUsed,
                requestTxStatus:         bcResult.transactionStatus,
                requestEtherscanUrl:     bcResult.etherscanUrl,
                requestBlockchainStatus: "confirmed",   // R2.3
              });
              console.log(`[AccessController] Blockchain request tx: ${bcResult.blockchainTxHash}`);
            } else {
              await AccessRequest.findByIdAndUpdate(accessRequest._id, {
                requestBlockchainStatus: "failed",      // R2.3
              });
              console.warn(`[AccessController] Blockchain request failed (non-blocking): ${bcResult.error}`);
            }
          })
          .catch(async (e) => {
            await AccessRequest.findByIdAndUpdate(accessRequest._id, {
              requestBlockchainStatus: "failed",        // R2.3
            }).catch(() => {});
            console.warn("[AccessController] Blockchain request error (non-blocking):", e.message);
          });
      } else {
        console.warn(`[AccessController] Researcher ${researcherId} has no ORCID — skipping blockchain request`);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Access request submitted. The data owner will be notified.",
      request: accessRequest,
    });
  } catch (err) {
    console.error("[requestAccess]", err);
    return res.status(500).json({ success: false, message: "Failed to submit access request" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   POST /api/access/approve-request
   Protected – owner role only

   Body: { requestId }
   → Sets status to "approved", sets approvedAt and accessExpiresAt
   → Does NOT yet allow download — owner must still verify PIN
─────────────────────────────────────────────────────────────────*/
const approveRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const ownerId       = req.user.userId;

    if (!requestId) {
      return res.status(400).json({ success: false, message: "requestId is required" });
    }

    const request = await AccessRequest.findById(requestId).populate("file").populate("researcher", "orcid");
    if (!request) {
      return res.status(404).json({ success: false, message: "Access request not found" });
    }

    // Verify the caller is the file owner
    if (String(request.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied — you do not own this file" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status}`,
      });
    }

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_GRANT_HOURS * 60 * 60 * 1000);

    request.status          = "approved";
    request.approvedAt      = now;
    request.accessExpiresAt = expiresAt;
    await request.save();

    // -- Blockchain: approve access on-chain (non-blocking)
    if (isBlockchainConfigured() && request.file && request.file.blockchainFileId && request.researcher && request.researcher.orcid) {
      // Mark as submitted BEFORE the async call (R2.3 blockchain state machine)
      await AccessRequest.findByIdAndUpdate(requestId, {
        approveBlockchainStatus: "submitted",
      });
      blockchainApproveAccess(request.file.blockchainFileId, request.researcher.orcid, ACCESS_GRANT_HOURS * 3600)
        .then(async (bcResult) => {
          if (bcResult.success) {
            await AccessRequest.findByIdAndUpdate(requestId, {
              approveTxHash:            bcResult.blockchainTxHash,
              approveBlockNumber:       bcResult.blockchainBlock,
              approveGasUsed:          bcResult.gasUsed,
              approveTxStatus:         bcResult.transactionStatus,
              approveEtherscanUrl:     bcResult.etherscanUrl,
              approveBlockchainStatus: "confirmed",   // R2.3
            });
            console.log(`[AccessController] Blockchain approve tx: ${bcResult.blockchainTxHash}`);
          } else {
            await AccessRequest.findByIdAndUpdate(requestId, {
              approveBlockchainStatus: "failed",      // R2.3
            });
            console.warn(`[AccessController] Blockchain approve failed (non-blocking): ${bcResult.error}`);
          }
        })
        .catch(async (e) => {
          await AccessRequest.findByIdAndUpdate(requestId, {
            approveBlockchainStatus: "failed",        // R2.3
          }).catch(() => {});
          console.warn("[AccessController] Blockchain approve error (non-blocking):", e.message);
        });
    }

    return res.status(200).json({
      success: true,
      message: `Access approved. The researcher can download the file for ${ACCESS_GRANT_HOURS} hours. Please verify your PIN to authorize.`,
      request: {
        id:              request._id,
        status:          request.status,
        approvedAt:      request.approvedAt,
        accessExpiresAt: request.accessExpiresAt,
      },
    });
  } catch (err) {
    console.error("[approveRequest]", err);
    return res.status(500).json({ success: false, message: "Failed to approve request" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   POST /api/access/deny-request
   Protected – owner role only

   Body: { requestId }
─────────────────────────────────────────────────────────────────*/
const denyRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const ownerId       = req.user.userId;

    const request = await AccessRequest.findById(requestId).populate("file").populate("researcher", "orcid");
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (String(request.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (request.status !== "pending") {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
    }

    request.status = "rejected";
    await request.save();

    // -- Blockchain: reject access on-chain (non-blocking)
    if (isBlockchainConfigured() && request.file && request.file.blockchainFileId && request.researcher && request.researcher.orcid) {
      // Mark as submitted BEFORE the async call (R2.3 blockchain state machine)
      await AccessRequest.findByIdAndUpdate(requestId, {
        rejectBlockchainStatus: "submitted",
      });
      blockchainRejectAccess(request.file.blockchainFileId, request.researcher.orcid)
        .then(async (bcResult) => {
          if (bcResult.success) {
            await AccessRequest.findByIdAndUpdate(requestId, {
              rejectTxHash:            bcResult.blockchainTxHash,
              rejectBlockNumber:       bcResult.blockchainBlock,
              rejectGasUsed:          bcResult.gasUsed,
              rejectTxStatus:         bcResult.transactionStatus,
              rejectEtherscanUrl:     bcResult.etherscanUrl,
              rejectBlockchainStatus: "confirmed",   // R2.3
            });
            console.log(`[AccessController] Blockchain reject tx: ${bcResult.blockchainTxHash}`);
          } else {
            await AccessRequest.findByIdAndUpdate(requestId, {
              rejectBlockchainStatus: "failed",      // R2.3
            });
            console.warn(`[AccessController] Blockchain reject failed (non-blocking): ${bcResult.error}`);
          }
        })
        .catch(async (e) => {
          await AccessRequest.findByIdAndUpdate(requestId, {
            rejectBlockchainStatus: "failed",        // R2.3
          }).catch(() => {});
          console.warn("[AccessController] Blockchain reject error (non-blocking):", e.message);
        });
    }

    return res.status(200).json({ success: true, message: "Request rejected." });
  } catch (err) {
    console.error("[denyRequest]", err);
    return res.status(500).json({ success: false, message: "Failed to deny request" });
  }
};

/* -----------------------------------------------------------------
   POST /api/access/revoke-access
   Protected - owner role only

   Body: { requestId }
   Revokes an approved access (manual early revocation).
-----------------------------------------------------------------*/
const revokeRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const ownerId       = req.user.userId;

    const request = await AccessRequest.findById(requestId).populate("file").populate("researcher", "orcid");
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (String(request.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (request.status !== "approved") {
      return res.status(400).json({ success: false, message: "Only approved requests can be revoked" });
    }

    request.status = "revoked";
    await request.save();

    // -- Blockchain: revoke access on-chain (non-blocking)
    if (isBlockchainConfigured() && request.file && request.file.blockchainFileId && request.researcher && request.researcher.orcid) {
      // Mark as submitted BEFORE the async call (R2.3 blockchain state machine)
      await AccessRequest.findByIdAndUpdate(requestId, {
        revokeBlockchainStatus: "submitted",
      });
      blockchainRevokeAccess(request.file.blockchainFileId, request.researcher.orcid)
        .then(async (bcResult) => {
          if (bcResult.success) {
            await AccessRequest.findByIdAndUpdate(requestId, {
              revokeTxHash:            bcResult.blockchainTxHash,
              revokeBlockNumber:       bcResult.blockchainBlock,
              revokeGasUsed:          bcResult.gasUsed,
              revokeTxStatus:         bcResult.transactionStatus,
              revokeEtherscanUrl:     bcResult.etherscanUrl,
              revokeBlockchainStatus: "confirmed",   // R2.3
            });
            console.log(`[AccessController] Blockchain revoke tx: ${bcResult.blockchainTxHash}`);
          } else {
            await AccessRequest.findByIdAndUpdate(requestId, {
              revokeBlockchainStatus: "failed",      // R2.3
            });
            console.warn(`[AccessController] Blockchain revoke failed (non-blocking): ${bcResult.error}`);
          }
        })
        .catch(async (e) => {
          await AccessRequest.findByIdAndUpdate(requestId, {
            revokeBlockchainStatus: "failed",        // R2.3
          }).catch(() => {});
          console.warn("[AccessController] Blockchain revoke error (non-blocking):", e.message);
        });
    }

    return res.status(200).json({ success: true, message: "Access revoked." });
  } catch (err) {
    console.error("[revokeRequest]", err);
    return res.status(500).json({ success: false, message: "Failed to revoke access" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   POST /api/access/verify-pin
   Protected – owner role only

   Body: { requestId, pin }
   → Verifies the owner's 6-digit PIN (bcrypt compare)
   → If correct: confirms access is live (already done via approve)
   → Returns success/failure — no token issued (JWT already handles auth)

   The PIN gate exists so that approval + access-enabling are two
   separate authenticated actions (defense in depth).
─────────────────────────────────────────────────────────────────*/
const verifyPin = async (req, res) => {
  try {
    const { requestId, pin } = req.body;
    const ownerId            = req.user.userId;

    if (!requestId || !pin) {
      return res.status(400).json({ success: false, message: "requestId and pin are required" });
    }

    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({ success: false, message: "PIN must be exactly 6 digits" });
    }

    // Fetch the access request
    const request = await AccessRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (String(request.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (request.status !== "approved") {
      return res.status(400).json({ success: false, message: "Request must be approved before PIN verification" });
    }

    // Retrieve the bcrypt PIN hash from Azure Key Vault
    let pinHash;
    try {
      pinHash = await retrievePinHash(String(ownerId));
    } catch {
      return res.status(400).json({
        success: false,
        message: "No PIN is set on your account. Please set a PIN via Settings first.",
      });
    }

    // Bcrypt comparison
    const isPinValid = await bcrypt.compare(pin, pinHash);
    if (!isPinValid) {
      return res.status(401).json({ success: false, message: "Incorrect PIN. Access denied." });
    }

    return res.status(200).json({
      success: true,
      message: "PIN verified. Access granted.",
      access: {
        fileId:          request.file,
        requestId:       request._id,
        accessExpiresAt: request.accessExpiresAt,
      },
    });
  } catch (err) {
    console.error("[verifyPin]", err);
    return res.status(500).json({ success: false, message: "PIN verification failed" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/access/download/:fileId
   Protected – researcher role only

   → Checks the researcher has an approved, non-expired request
   → Fetches encrypted file from Azure
   → Retrieves AES key from Key Vault
   → Decrypts in-memory using stored IV
   → Streams decrypted bytes to researcher
   → NOTHING is stored — decrypted data exists only in this request
─────────────────────────────────────────────────────────────────*/
const downloadFile = async (req, res) => {
  try {
    const { fileId }    = req.params;
    const researcherId  = req.user.userId;

    // -- 1. Find file metadata
    const file = await GenomicFile.findById(fileId).select("+encryptionIv");
    if (!file || file.uploadStatus !== "confirmed") {
      return res.status(404).json({ success: false, message: "File not found" });
    }

    // -- 2. Check researcher has approved, non-expired access (MongoDB gate)
    const now     = new Date();
    const request = await AccessRequest.findOne({
      file:       fileId,
      researcher: researcherId,
      status:     "approved"
    });

    if (!request) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Submit an access request and wait for owner approval.",
      });
    }

    if (request.accessExpiresAt && request.accessExpiresAt < now) {
      return res.status(403).json({
        success: false,
        message: "Your access window has expired. Please request access again.",
      });
    }

    // -- 2b. Access-type gate: only "downloadable" (or legacy "download") type can download
    // "read-only" means metadata/preview access only
    if (request.accessType && request.accessType !== "downloadable" && request.accessType !== "download") {
      return res.status(403).json({
        success: false,
        message: `Download is not permitted — your access type is "${request.accessType}". You need download access.`,
      });
    }

    // -- 3. Blockchain gate: verify access on-chain (read-only, zero gas)
    // Only enforced when blockchain is configured and file is registered on-chain.
    if (isBlockchainConfigured() && file.blockchainFileId) {
      const researcher = await User.findById(researcherId).select("orcid");
      if (researcher && researcher.orcid) {
        const bcCheck = await blockchainCheckAccess(file.blockchainFileId, researcher.orcid);
        if (!bcCheck.hasAccess && !bcCheck.disabled) {
          console.warn(`[Download] Blockchain gate: access denied for researcher ${researcherId} on file ${fileId}`);
          return res.status(403).json({
            success: false,
            message: "Blockchain verification failed: access not approved or has expired on-chain.",
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PASS 1 — SHA-256 Integrity Verification (Unit 6, Module 1)
    // ═══════════════════════════════════════════════════════════════════
    // Log that the researcher initiated a download attempt.
    logEvent("DOWNLOAD_INITIATED", researcherId, "researcher", file, {
      status:    "success",
      ipAddress: req.ip,
      details:   { fileId: String(file._id), fileName: file.originalName },
    }).catch(console.warn);

    // Only verify if the file has a trusted blockchain hash.
    // (Files uploaded before Unit 6 may not have blockchainFileHash set.)
    if (file.blockchainFileHash) {
      console.log(`[Integrity] ⏳ Pass 1 — streaming SHA-256 check for: ${file.azureBlobName}`);

      // Open a fresh Azure stream for hash calculation only (Pass 1).
      // getReadableBlobStream() opens a new independent HTTP GET each call.
      // Memory usage = O(chunk_size), never O(file_size).
      const hashStream = await getReadableBlobStream(file.azureBlobName);
      const hashCalc   = crypto.createHash("sha256");

      await new Promise((resolve, reject) => {
        hashStream.on("data",  (chunk) => hashCalc.update(chunk));
        hashStream.on("end",   resolve);
        hashStream.on("error", reject);
      });

      const liveHash   = hashCalc.digest("hex");
      const storedHash = file.blockchainFileHash;

      if (liveHash !== storedHash) {
        // ── Integrity check FAILED ─────────────────────────────────
        console.error(`[Integrity] ❌ SHA-256 MISMATCH for file ${fileId}`);
        console.error(`[Integrity]    stored: ${storedHash}`);
        console.error(`[Integrity]    live  : ${liveHash}`);

        // Log both INTEGRITY_FAILED and DOWNLOAD_FAILED (non-blocking)
        logEvent("INTEGRITY_FAILED", researcherId, "researcher", file, {
          status:    "failure",
          ipAddress: req.ip,
          details:   {
            reason:     "SHA-256 mismatch — file may have been tampered",
            storedHash,
            liveHash,
          },
        }).catch(console.warn);

        logEvent("DOWNLOAD_FAILED", researcherId, "researcher", file, {
          status:    "failure",
          ipAddress: req.ip,
          details:   { reason: "Blocked by integrity check (SHA-256 mismatch)" },
        }).catch(console.warn);

        return res.status(409).json({
          success: false,
          message: "File integrity verification failed. The file may have been tampered with. Download blocked.",
          code:    "INTEGRITY_FAILED",
        });
      }

      // ── Integrity check PASSED ──────────────────────────────────
      console.log(`[Integrity] ✅ SHA-256 verified for file ${fileId}`);
      logEvent("INTEGRITY_VERIFIED", researcherId, "researcher", file, {
        status:    "success",
        ipAddress: req.ip,
        details:   { storedHash, liveHash, match: true },
      }).catch(console.warn);
    } else {
      console.warn(`[Integrity] ⚠️  Skipping SHA-256 check — no blockchainFileHash stored for file ${fileId}`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // WATERMARK GUARD — fail-safe before any file data is prepared
    // ═══════════════════════════════════════════════════════════════════

    // Guard: WATERMARK_SECRET must be configured or download is blocked
    if (!process.env.WATERMARK_SECRET) {
      logEvent("WATERMARK_EMBEDDING_FAILED", researcherId, "researcher", file, {
        status: "failure", ipAddress: req.ip,
        details: { reason: "WATERMARK_SECRET not configured" },
      }).catch(console.warn);
      return res.status(503).json({
        success: false,
        message: "Download service temporarily unavailable — watermarking not configured.",
        code:    "WATERMARK_SECRET_MISSING",
      });
    }

    // Guard: file size limit (V1 in-memory buffer limit)
    const wmMaxMB  = parseInt(process.env.WM_MAX_FILE_SIZE_MB) || 500;
    const fileSizeMB = (file.sizeBytes || 0) / (1024 * 1024);
    if (fileSizeMB > wmMaxMB) {
      logEvent("WATERMARK_FAILED_SIZE_LIMIT", researcherId, "researcher", file, {
        status: "failure", ipAddress: req.ip,
        details: { reason: `File ${fileSizeMB.toFixed(1)} MB exceeds WM limit ${wmMaxMB} MB` },
      }).catch(console.warn);
      return res.status(503).json({
        success: false,
        message: `File exceeds V1 watermarking size limit (${wmMaxMB} MB). Download blocked.`,
        code:    "FILE_TOO_LARGE_FOR_WATERMARKING",
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // PASS 2 — In-Memory Decryption (required for watermark embedding)
    // ═══════════════════════════════════════════════════════════════════

    // -- 4. Retrieve AES key from Key Vault
    console.log(`[Download] Retrieving AES key from Key Vault: ${fileId}`);
    const aesKeyHex = await retrieveEncryptionKey(String(file._id));

    // -- 5. Download encrypted blob to buffer and decrypt
    console.log(`[Download] Buffering Azure blob for watermarking: ${file.azureBlobName}`);
    const encryptedBuffer = await downloadBlobToBuffer(file.azureBlobName);

    let plainBuffer;
    if (!file.isEncrypted || !file.encryptionIv) {
      console.warn(`[Download] File not encrypted — using raw buffer`);
      plainBuffer = encryptedBuffer;
    } else {
      const key      = Buffer.from(aesKeyHex, "hex");
      const iv       = Buffer.from(file.encryptionIv, "hex");
      const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
      plainBuffer    = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // PASS 3 — Watermark Embedding
    // ═══════════════════════════════════════════════════════════════════

    // -- 6. Generate unique identifiers and seed
    const downloadId  = wmService.generateDownloadId();
    const watermarkId = wmService.generateWatermarkId();
    const nonce       = crypto.randomBytes(32);
    const ownerId     = String(file.owner);
    const fileExt     = (file.extension || "").toLowerCase();

    const watermarkSeed = wmService.generateWatermarkSeed(
      ownerId,
      String(researcherId),
      String(file._id),
      String(request._id),
      downloadId,
      nonce
    );

    // Compute SHA-256 of the original plaintext (pre-watermark)
    const originalFileHash = crypto.createHash("sha256").update(plainBuffer).digest("hex");

    // Build the watermark record object
    const watermarkRecord = wmService.buildWatermarkRecord({
      watermarkId,
      downloadId,
      fileId:           String(file._id),
      originalFileName: file.originalName ?? null,   // snapshot — survives file deletion
      ownerId,
      researcherId:    String(researcherId),
      accessRequestId: String(request._id),
      watermarkSeed,
      fileExt,
      fileSize:        plainBuffer.length,
      originalFileHash,
    });

    // -- 7. Embed watermark (dispatch to LSB or metadata embedder)
    let watermarkedBuffer;
    try {
      const embedResult = wmService.embedWatermark(plainBuffer, fileExt, watermarkRecord);
      watermarkedBuffer = embedResult.watermarkedBuffer;
    } catch (embedErr) {
      console.error("[Watermark] Embedding failed:", embedErr.message);
      logEvent("WATERMARK_EMBEDDING_FAILED", researcherId, "researcher", file, {
        status: "failure", ipAddress: req.ip,
        details: { reason: embedErr.message },
      }).catch(console.warn);
      return res.status(500).json({
        success: false,
        message: "Watermark embedding failed. Download blocked.",
        code:    "WATERMARK_EMBEDDING_FAILED",
      });
    }

    logEvent("WATERMARK_EMBEDDED", researcherId, "researcher", file, {
      status: "success", ipAddress: req.ip,
      details: { watermarkId, downloadId, fileExt },
    }).catch(console.warn);

    // -- 8. Self-verify: confirm watermark can be recovered from output
    try {
      const selfTest = wmService.detectWatermarkInCandidate(watermarkedBuffer, watermarkRecord);
      if (!selfTest.verified) {
        throw new Error(`Self-test failed: commitment mismatch (matchScore=${selfTest.matchScore.toFixed(3)})`);
      }
    } catch (verifyErr) {
      console.error("[Watermark] Self-verification failed:", verifyErr.message);
      logEvent("WATERMARK_EMBEDDING_FAILED", researcherId, "researcher", file, {
        status: "failure", ipAddress: req.ip,
        details: { reason: `Self-verify: ${verifyErr.message}` },
      }).catch(console.warn);
      return res.status(500).json({
        success: false,
        message: "Watermark verification failed. Download blocked.",
        code:    "WATERMARK_VERIFICATION_FAILED",
      });
    }

    logEvent("WATERMARK_VERIFIED", researcherId, "researcher", file, {
      status: "success", ipAddress: req.ip,
      details: { watermarkId, downloadId },
    }).catch(console.warn);

    // -- 9. Compute watermarked file hash and save registry record
    const watermarkedFileHash = wmService.computeWatermarkedFileHash(watermarkedBuffer);
    watermarkRecord.watermarkedFileHash = watermarkedFileHash;

    let savedRegistry;
    try {
      savedRegistry = await WatermarkRegistry.create(watermarkRecord);
    } catch (saveErr) {
      console.error("[Watermark] Registry save failed:", saveErr.message);
      logEvent("WATERMARK_EMBEDDING_FAILED", researcherId, "researcher", file, {
        status: "failure", ipAddress: req.ip,
        details: { reason: `Registry save: ${saveErr.message}` },
      }).catch(console.warn);
      return res.status(500).json({
        success: false,
        message: "Failed to record watermark. Download blocked.",
        code:    "WATERMARK_REGISTRY_SAVE_FAILED",
      });
    }

    // -- 10. Anchor watermarked file hash to blockchain (fire-and-forget)
    if (isBlockchainConfigured()) {
      setImmediate(() => {
        registerFileOnChain(watermarkedFileHash, "")
          .then(async (bcResult) => {
            const update = bcResult.success
              ? { blockchainStatus: "ANCHORED", blockchainTxHash: bcResult.blockchainTxHash, blockchainBlockNum: bcResult.blockchainBlock }
              : { blockchainStatus: "FAILED" };
            await WatermarkRegistry.findByIdAndUpdate(savedRegistry._id, update);
            console.log(`[Watermark] Blockchain anchor ${bcResult.success ? "✅" : "❌"} for ${watermarkId}`);
          })
          .catch((e) => {
            console.warn("[Watermark] Blockchain anchor error (non-blocking):", e.message);
            WatermarkRegistry.findByIdAndUpdate(savedRegistry._id, { blockchainStatus: "FAILED" }).catch(() => {});
          });
      });
    } else {
      await WatermarkRegistry.findByIdAndUpdate(savedRegistry._id, { blockchainStatus: "FAILED" });
    }

    // ═══════════════════════════════════════════════════════════════════
    // DELIVER — Send watermarked buffer to researcher
    // ═══════════════════════════════════════════════════════════════════

    res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
    res.setHeader("Content-Type",  file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", watermarkedBuffer.length);
    res.setHeader("X-Watermark-Id", watermarkId);   // exposes ID only, not seed
    res.setHeader("X-Download-Id",  downloadId);

    logEvent("WATERMARKED_FILE_DOWNLOADED", researcherId, "researcher", file, {
      status: "success", ipAddress: req.ip,
      details: { watermarkId, downloadId, fileExt, sizeBytes: watermarkedBuffer.length },
    }).catch(console.warn);

    return res.send(watermarkedBuffer);

  } catch (err) {
    console.error("[downloadFile]", err);
    return res.status(500).json({ success: false, message: "File download failed" });
  }
};


/* -----------------------------------------------------------------
   POST /api/access/request-more-info
   Protected - owner role only

   Body: { requestId, ownerNote }
   Sets status to "more-info" and records the owner's note.
-----------------------------------------------------------------*/
const requestMoreInfo = async (req, res) => {
  try {
    const { requestId, ownerNote } = req.body;
    const ownerId = req.user.userId;

    const request = await AccessRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (String(request.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (!["pending", "more-info"].includes(request.status)) {
      return res.status(400).json({ success: false, message: `Cannot request more info — request is already ${request.status}` });
    }


    request.status    = "more-info";
    request.ownerNote = ownerNote || "";
    await request.save();

    return res.status(200).json({
      success: true,
      message: "Researcher notified to provide more information.",
    });
  } catch (err) {
    console.error("[requestMoreInfo]", err);
    return res.status(500).json({ success: false, message: "Failed to update request" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/access/my-requests
   Protected – researcher role only
   Lists all access requests the researcher has submitted.
─────────────────────────────────────────────────────────────────*/
const getMyRequests = async (req, res) => {
  try {
    const researcherId = req.user.userId;
    const requests = await AccessRequest.find({ researcher: researcherId })
      .populate("file", "originalName sizeBytes mimeType createdAt isEncrypted")
      .populate("owner", "name email")
      .sort({ createdAt: -1 });

    // Filter out orphaned requests where the file or owner was deleted
    const safeRequests = requests.filter(r => r.file != null && r.owner != null);

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.status(200).json({ success: true, count: safeRequests.length, requests: safeRequests });
  } catch (err) {
    console.error("[getMyRequests]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch requests" });
  }
};

/* ─────────────────────────────────────────────────────────────────
   GET /api/access/incoming-requests
   Protected – owner role only
   Lists all requests for the owner's files.
─────────────────────────────────────────────────────────────────*/
const getIncomingRequests = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const requests = await AccessRequest.find({ owner: ownerId })
      .populate("file", "originalName sizeBytes isEncrypted extension")
      .populate("researcher", "name email")
      .sort({ createdAt: -1 });

    // Filter out orphaned requests where the file or researcher was deleted
    // (populate returns null for missing referenced docs — accessing .name etc. on null crashes frontend)
    const safeRequests = requests.filter(r => r.file != null && r.researcher != null);

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.status(200).json({ success: true, count: safeRequests.length, requests: safeRequests });
  } catch (err) {
    console.error("[getIncomingRequests]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch incoming requests" });
  }
};

module.exports = {
  requestAccess,
  approveRequest,
  denyRequest,
  revokeRequest,
  requestMoreInfo,
  verifyPin,
  downloadFile,
  getMyRequests,
  getIncomingRequests,
};
