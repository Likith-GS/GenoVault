/**
 * fileController.js
 * ─────────────────
 *
 * Upload architecture:
 *
 *  1. GET  /api/files/get-upload-url
 *       → Validates file metadata, generates a safe blob name,
 *         returns a SAS token so the browser uploads DIRECTLY to Azure.
 *         No file bytes ever touch this server → zero bottleneck.
 *
 *  2. POST /api/files/confirm-upload
 *       → Called after the browser finishes uploading.
 *         Responds IMMEDIATELY (< 100 ms) then in the background:
 *           a. Downloads the plaintext blob from Azure
 *           b. Encrypts it with AES-256-CBC (Node crypto module)
 *           c. Overwrites the blob with ciphertext
 *           d. Stores the AES key in Azure Key Vault
 *           e. Updates MongoDB (isEncrypted = true)
 *           f. Triggers IPFS backup of the encrypted blob
 *         The user sees "Upload complete!" immediately — no waiting for
 *         encryption.
 */

const { v4: uuidv4 } = require("uuid");
const path        = require("path");
const crypto      = require("crypto");
const GenomicFile = require("../models/GenomicFile");

const {
  generateUploadSasToken,
  verifyBlobExists,
  getBlobProperties,
  downloadBlobToBuffer,
  uploadEncryptedBuffer,
  getReadableBlobStream,
} = require("../services/azureService");

const { uploadToIPFS, deleteFromIPFS }   = require("../services/ipfsService");
const {
  generateKey,
  generateIV,
  encryptBuffer,
  encryptBufferV2,
  decryptPartialBuffer,
} = require("../services/encryptionService");
const { storeEncryptionKey, deleteEncryptionKey } = require("../services/keyVaultService");
const { registerFileOnChain }            = require("../services/blockchainService");

// ── Allowed genomic file extensions ─────────────────────────────────────
const ALLOWED_EXTENSIONS = new Set([".fastq", ".fastq.gz", ".bam", ".vcf"]);

/**
 * getFileExt(filename)
 * Returns the full file extension, handling compound extensions like .fastq.gz.
 * path.extname("file.fastq.gz") returns ".gz" — this returns ".fastq.gz".
 */
function getFileExt(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".fastq.gz"))  return ".fastq.gz";
  if (lower.endsWith(".tar.gz"))    return ".tar.gz";
  return path.extname(filename).toLowerCase();
}

/**
 * generateSafeBlobName
 * ────────────────────
 * Creates a safe, unique blob name.
 * Format: <timestamp>_<uuid12>.<ext>
 */
const generateSafeBlobName = (originalName) => {
  const ext       = getFileExt(originalName);
  const timestamp = Date.now();
  const unique    = uuidv4().replace(/-/g, "").slice(0, 12);
  return `${timestamp}_${unique}${ext}`;
};

/* ──────────────────────────────────────────────────────────────────────────
   Background encryption job
   ─────────────────────────
   Runs AFTER confirmUpload has already responded to the client.
   Steps:
     1. Download plaintext blob from Azure
     2. Encrypt with AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC, V2)
     3. Overwrite blob with ciphertext
     4. Store AES key in Azure Key Vault
     5. Update MongoDB (isEncrypted, encryptionIv, encryptionVersion:'v2', encryptionMac)
     6. Compute SHA-256 of the encrypted blob → register on blockchain
     7. Start IPFS backup of encrypted blob
────────────────────────────────────────────────────────────────────────────*/
const runBackgroundEncryptAndBackup = async (fileId, blobName, originalName, mimeType, sizeBytes) => {
  let encryptedBuffer = null;

  // ── Phase 1: AES-256-CBC encryption ───────────────────────────────────
  try {
    console.log(`[Encrypt] ⏳ Downloading blob for encryption: ${blobName}`);
    const plainBuffer = await downloadBlobToBuffer(blobName);

    const aesKeyHex = generateKey();
    const ivHex      = generateIV();

    // V2: AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC
    // encryptBufferV2 returns { ciphertext, mac } where mac covers IV||ciphertext.
    const { ciphertext: encryptedBuffer_, mac: encryptionMac } = encryptBufferV2(plainBuffer, aesKeyHex, ivHex);
    encryptedBuffer = encryptedBuffer_;

    console.log(`[Encrypt] 🔐 Re-uploading encrypted blob (${encryptedBuffer.length} bytes)`);
    await uploadEncryptedBuffer(blobName, encryptedBuffer, mimeType);

    await storeEncryptionKey(String(fileId), aesKeyHex);
    console.log(`[KeyVault] ✅ AES key stored for file: ${fileId}`);

    await GenomicFile.findByIdAndUpdate(fileId, {
      isEncrypted:       true,
      encryptionIv:      ivHex,
      encryptionVersion: "v2",
      encryptionMac:     encryptionMac,
    });
    console.log(`[Encrypt] ✅ V2 Encrypt-then-MAC complete: ${blobName}`);
  } catch (encErr) {
    console.error(`[Encrypt] ❌ Encryption failed for ${blobName}:`, encErr.message);
  }

  // ── Phase 2: SHA-256 hash + Blockchain registration ──────────────────
  // Compute SHA-256 of the encrypted blob.
  // The hash is ALWAYS stored in MongoDB as blockchainFileHash so the
  // integrity SHA layer can compare it against the live Azure blob on
  // every Re-verify, even when blockchain registration is disabled or fails.
  let sha256hex = null;
  try {
    const dataToHash = encryptedBuffer || Buffer.from(blobName);
    sha256hex        = crypto.createHash("sha256").update(dataToHash).digest("hex");

    // ── Always persist the hash immediately ─────────────────────────────
    // This is the off-chain stored hash used by the SHA-256 integrity layer.
    // Blockchain registration below is independent — it anchors this hash
    // on Sepolia but the comparison works with or without it.
    await GenomicFile.findByIdAndUpdate(fileId, {
      blockchainFileHash: sha256hex,
    });
    console.log(`[SHA256] ✅ Hash stored: ${sha256hex.slice(0, 16)}… (off-chain baseline)`);

    // ── Attempt on-chain registration (Sepolia) ──────────────────────────
    console.log(`[Blockchain] ⏳ Registering on Sepolia: ${sha256hex.slice(0, 16)}…`);
    const bcResult = await registerFileOnChain(sha256hex, "");

    if (bcResult.disabled) {
      console.warn(`[Blockchain] ⚠️  Skipped (not configured) — hash still stored off-chain`);
    } else if (bcResult.success) {
      // Supplement the record with on-chain metadata
      await GenomicFile.findByIdAndUpdate(fileId, {
        blockchainFileId:    bcResult.fileId,
        blockchainTxHash:    bcResult.txHash,
        blockchainBlockNum:  bcResult.blockNumber,
        blockchainTimestamp: new Date(),
      });
      console.log(`[Blockchain] ✅ fileId=${bcResult.fileId} | Tx: ${bcResult.txHash} | Block: ${bcResult.blockNumber}`);
    } else {
      console.warn(`[Blockchain] ⚠️  Registration failed: ${bcResult.error} — hash still stored off-chain`);
    }
  } catch (bcErr) {
    console.error(`[Blockchain] ❌ Exception:`, bcErr.message);
    // Even if an exception occurs, sha256hex may already be stored — do not wipe it.
  }


  // ── Phase 3: IPFS backup ──────────────────────────────────────────────
  // Pass encryptedBuffer directly — skips a full Azure re-download (~500 MB saved).
  // Falls back to Azure download if encryptedBuffer is null (encryption failed).
  try {
    await GenomicFile.findByIdAndUpdate(fileId, { ipfsStatus: "uploading" });
    const { cid, ipfsUrl } = await uploadToIPFS(
      blobName, originalName, mimeType, sizeBytes,
      encryptedBuffer   // ← in-memory buffer from Phase 1; null = download from Azure
    );
    await GenomicFile.findByIdAndUpdate(fileId, {
      ipfsCid:           cid,
      ipfsUrl,
      ipfsStatus:        "done",
      blockchainIpfsCID: cid,
    });
    console.log(`[IPFS] ✅ Backed up ${blobName} → CID: ${cid}`);
  } catch (ipfsErr) {
    console.error(`[IPFS] ❌ Backup failed for ${blobName}:`, ipfsErr.message);
    await GenomicFile.findByIdAndUpdate(fileId, { ipfsStatus: "failed" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/files/:id/retry-encryption
   Protected – owner role only

   Re-runs the full background job for a file stuck with isEncrypted=false
   or missing blockchainFileHash (i.e. the job previously failed silently).

   Flow:
     1. Validate file ownership and state
     2. Re-run runBackgroundEncryptAndBackup (encrypt → Key Vault → SHA-256
        → blockchain → IPFS)
     3. Return immediately — progress visible via GET /:id/ipfs-status
────────────────────────────────────────────────────────────────────────────*/
const retryEncryption = async (req, res) => {
  try {
    const fileId  = req.params.id;
    const ownerId = req.user.userId;

    const file = await GenomicFile.findById(fileId);
    if (!file || file.uploadStatus !== "confirmed") {
      return res.status(404).json({ success: false, message: "File not found" });
    }
    if (String(file.owner) !== String(ownerId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (file.isEncrypted && file.blockchainFileHash) {
      return res.status(400).json({
        success: false,
        message: "File is already encrypted and registered on blockchain — no retry needed",
      });
    }

    console.log(`[retryEncryption] 🔄 Retrying background job for file: ${fileId}`);

    // Re-run the full pipeline asynchronously — respond immediately
    setImmediate(() =>
      runBackgroundEncryptAndBackup(
        file._id,
        file.azureBlobName,
        file.originalName,
        file.mimeType,
        file.sizeBytes,
      )
    );

    return res.status(202).json({
      success: true,
      message: "Encryption and blockchain registration restarted in background. Use GET /:id/ipfs-status to track progress.",
      fileId: String(file._id),
    });
  } catch (err) {
    console.error("[retryEncryption]", err);
    return res.status(500).json({ success: false, message: "Retry failed" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/files/get-upload-url
   Protected – owner role only

   Query params:
     filename  (string, required) – original file name
     filesize  (number, required) – file size in bytes
     filetype  (string, optional) – MIME type hint

   Response:
     { sasUrl, blobName, blobUrl, sasToken, containerName, expiresInMinutes }
────────────────────────────────────────────────────────────────────────────*/
const getUploadUrl = async (req, res) => {
  try {
    const { filename, filesize } = req.query;

    if (!filename) {
      return res.status(400).json({ success: false, message: "filename query parameter is required" });
    }
    if (!filesize || isNaN(Number(filesize)) || Number(filesize) <= 0) {
      return res.status(400).json({ success: false, message: "filesize must be a positive number (bytes)" });
    }

    const ext = getFileExt(filename);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({
        success: false,
        message: `File type "${ext}" is not allowed. Accepted: .fastq, .fastq.gz, .bam, .vcf`,
      });
    }

    const blobName = generateSafeBlobName(filename);

    // 120-minute SAS window (generous for large genomic files)
    const { sasToken, blobUrl, containerName } = generateUploadSasToken(blobName, 120);

    return res.status(200).json({
      success: true,
      message: "SAS token generated. Upload the file directly to Azure.",
      blobName,
      blobUrl,
      sasToken,
      containerName,
      expiresInMinutes: 120,
      sasUrl: `${blobUrl}?${sasToken}`,
    });
  } catch (err) {
    console.error("[getUploadUrl]", err);
    const msg = err.message.includes("credentials")
      ? "Azure Storage is not configured."
      : "Failed to generate upload URL";
    return res.status(500).json({ success: false, message: msg });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/files/confirm-upload
   Protected – owner role only

   Body: { blobName, originalName, sizeBytes, mimeType, description }

   Responds IMMEDIATELY after saving metadata.
   AES-256 encryption + IPFS backup run in the background.
────────────────────────────────────────────────────────────────────────────*/
const confirmUpload = async (req, res) => {
  try {
    const {
      blobName, originalName, sizeBytes, mimeType, description,
      genomeBuild, sequencingType, riskCategory, qualityScore,
      detectedVariants, predictedRisks, phenotype,
    } = req.body;
    const userId = req.user.userId;

    if (!blobName || !originalName) {
      return res.status(400).json({ success: false, message: "blobName and originalName are required" });
    }

    const ext = getFileExt(originalName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({ success: false, message: `File type "${ext}" is not allowed. Accepted: .fastq, .fastq.gz, .bam, .vcf` });
    }

    // Verify the blob actually exists in Azure
    const exists = await verifyBlobExists(blobName);
    if (!exists) {
      return res.status(400).json({
        success: false,
        message: "Blob not found in Azure. Ensure the file was fully uploaded before confirming.",
      });
    }

    // Get actual properties from Azure
    let actualSize = Number(sizeBytes) || 0;
    let actualMime = mimeType || "application/octet-stream";
    try {
      const props = await getBlobProperties(blobName);
      actualSize  = props.sizeBytes || actualSize;
      actualMime  = props.mimeType  || actualMime;
    } catch { /* use client-provided values */ }

    const containerName = process.env.AZURE_CONTAINER_NAME || "genomic-files";
    const accountName   = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const cloudUrl      = `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}`;

    // Auto-generate dataset ID: GV-XXXX (unique 4-digit-ish number from timestamp)
    const datasetId = `GV-${(Date.now() % 9000 + 1000).toString().padStart(4, "0")}`;

    // Compute SHA-256 of the raw uploaded blob (streaming — no full buffer in RAM).
    // Stored as uploadSha256Hash so the integrity SHA layer can always run a
    // live hash comparison even if blockchain registration hasn't completed yet.
    let uploadSha256Hash = null;
    try {
      const rawStream  = await getReadableBlobStream(blobName);
      const hashCalc   = crypto.createHash("sha256");
      await new Promise((resolve, reject) => {
        rawStream.on("data",  (chunk) => hashCalc.update(chunk));
        rawStream.on("end",   resolve);
        rawStream.on("error", reject);
      });
      uploadSha256Hash = hashCalc.digest("hex");
      console.log(`[ConfirmUpload] SHA-256 of raw blob: ${uploadSha256Hash.slice(0, 16)}…`);
    } catch (hashErr) {
      console.warn(`[ConfirmUpload] SHA-256 pre-compute failed (non-fatal): ${hashErr.message}`);
    }

    // Save metadata immediately (isEncrypted starts false — background job sets it true)
    const genomicFile = await GenomicFile.create({
      owner:              userId,
      originalName,
      storedName:         blobName,
      extension:          ext,
      sizeBytes:          actualSize,
      mimeType:           actualMime,
      azureBlobName:      blobName,
      azureContainerName: containerName,
      cloudUrl,
      uploadSha256Hash,
      isEncrypted:        false,
      ipfsStatus:         "pending",
      description:        description || "",
      datasetId,
      availability:       "Available",
      genomeBuild:        genomeBuild        || null,
      sequencingType:     sequencingType     || null,
      riskCategory:       riskCategory       || null,
      qualityScore:       qualityScore       || null,
      detectedVariants:   Array.isArray(detectedVariants)  ? detectedVariants  : [],
      predictedRisks:     Array.isArray(predictedRisks)    ? predictedRisks    : [],
      phenotype:          Array.isArray(phenotype)         ? phenotype         : [],
    });

    // ── Respond immediately — user sees "Upload complete!" right away ───
    res.status(201).json({
      success: true,
      message: "Upload confirmed. AES-256 encryption and IPFS backup running in the background.",
      file: {
        id:          genomicFile._id,
        originalName,
        sizeBytes:   actualSize,
        isEncrypted: false,        // will become true once background job finishes
        cloudUrl,
        ipfsCid:     null,
        ipfsUrl:     null,
        ipfsStatus:  "pending",
        uploadedAt:  genomicFile.createdAt,
      },
    });

    // ── Kick off background encryption + IPFS (non-blocking) ────────────
    setImmediate(() =>
      runBackgroundEncryptAndBackup(
        genomicFile._id,
        blobName,
        originalName,
        actualMime,
        actualSize
      )
    );

  } catch (err) {
    console.error("[confirmUpload]", err);
    return res.status(500).json({ success: false, message: "Failed to confirm upload" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/files/my-files
   Protected – owner role only
────────────────────────────────────────────────────────────────────────────*/
const getMyFiles = async (req, res) => {
  try {
    const userId = req.user.userId;
    const files = await GenomicFile.find({ owner: userId, uploadStatus: "confirmed" })
      .sort({ createdAt: -1 })
      .select("-__v");
    return res.status(200).json({ success: true, count: files.length, files });
  } catch (err) {
    console.error("[getMyFiles]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch files" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/files/:id/ipfs-status
   Protected – lets frontend poll for IPFS backup completion
────────────────────────────────────────────────────────────────────────────*/
const getIpfsStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const file = await GenomicFile.findById(id).select("ipfsStatus ipfsCid ipfsUrl isEncrypted");
    if (!file) return res.status(404).json({ success: false, message: "File not found" });
    return res.status(200).json({
      success:    true,
      ipfsStatus: file.ipfsStatus,
      ipfsCid:    file.ipfsCid,
      ipfsUrl:    file.ipfsUrl,
      isEncrypted: file.isEncrypted,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to get IPFS status" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   DELETE /api/files/:id
   Protected – owner role only
────────────────────────────────────────────────────────────────────────────*/
const deleteFile = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user.userId;
    const file     = await GenomicFile.findById(id);

    if (!file) return res.status(404).json({ success: false, message: "File not found" });
    if (String(file.owner) !== String(userId))
      return res.status(403).json({ success: false, message: "Access denied" });

    const blobName      = file.azureBlobName;
    const containerName = file.azureContainerName;
    const errors        = [];

    // 1. Delete from Azure
    try {
      const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
      const name = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const key  = process.env.AZURE_STORAGE_ACCOUNT_KEY;
      if (name && key) {
        const cred   = new StorageSharedKeyCredential(name, key);
        const client = new BlobServiceClient(`https://${name}.blob.core.windows.net`, cred);
        await client.getContainerClient(containerName).getBlobClient(blobName).deleteIfExists();
        console.log(`[Azure] ✅ Deleted blob: ${blobName}`);
      }
    } catch (azureErr) {
      console.error(`[Azure] ❌ Delete failed:`, azureErr.message);
      errors.push(`Azure: ${azureErr.message}`);
    }

    // 2. Delete from IPFS
    try {
      if (file.ipfsStatus === "done" || file.ipfsStatus === "uploading") {
        await deleteFromIPFS(blobName);
        console.log(`[IPFS] ✅ Unpinned: ${blobName}`);
      }
    } catch (ipfsErr) {
      console.warn(`[IPFS] ⚠️ Unpin skipped:`, ipfsErr.message);
    }

    // 3. Delete from MongoDB (GenomicFile document)
    await GenomicFile.findByIdAndDelete(id);

    // 4. Cascade-delete: MisuseEvents and WatermarkRegistry for this file.
    //    Uses two passes:
    //      a) by fileId (ObjectId match — the normal case)
    //      b) by watermarkId set — catches events where fileId was stored as null
    //         but still belong to this file's watermark records.
    try {
      const MisuseEvent        = require("../models/MisuseEvent");
      const WatermarkRegistry  = require("../models/WatermarkRegistry");

      // Pass (a): collect watermarkIds for this file before deleting registry
      const wmRecords = await WatermarkRegistry.find({ fileId: id }, { watermarkId: 1 }).lean();
      const watermarkIds = wmRecords.map(r => r.watermarkId);

      // Pass (b): delete events by fileId OR watermarkId
      const eventFilter = watermarkIds.length
        ? { $or: [{ fileId: id }, { watermarkId: { $in: watermarkIds } }] }
        : { fileId: id };

      const [eventsDeleted, wmDeleted] = await Promise.all([
        MisuseEvent.deleteMany(eventFilter),
        WatermarkRegistry.deleteMany({ fileId: id }),
      ]);

      console.log(
        `[deleteFile] 🧹 Cascade: removed ${eventsDeleted.deletedCount} misuse events ` +
        `and ${wmDeleted.deletedCount} watermark records for file ${id}`
      );
    } catch (cascadeErr) {
      console.warn(`[deleteFile] ⚠️ Cascade delete warning:`, cascadeErr.message);
      errors.push(`Cascade: ${cascadeErr.message}`);
    }

    // 5. Delete AES key from Key Vault (best-effort)
    try {
      await deleteEncryptionKey(id);
    } catch (kvErr) {
      console.warn(`[KeyVault] ⚠️ Could not delete key for ${id}:`, kvErr.message);
    }

    return res.status(200).json({
      success: true,
      message: errors.length
        ? `File deleted from database. Azure errors: ${errors.join("; ")}`
        : "File deleted from Azure, IPFS, Key Vault, and database.",
    });
  } catch (err) {
    console.error("[deleteFile]", err);
    return res.status(500).json({ success: false, message: "Failed to delete file" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/files/:id/retry-ipfs
   Protected – owner role only
────────────────────────────────────────────────────────────────────────────*/
const retryIpfs = async (req, res) => {
  try {
    const { id }   = req.params;
    const userId   = req.user.userId;
    const file     = await GenomicFile.findById(id);

    if (!file)
      return res.status(404).json({ success: false, message: "File not found" });
    if (String(file.owner) !== String(userId))
      return res.status(403).json({ success: false, message: "Access denied" });
    if (file.ipfsStatus === "done")
      return res.status(400).json({ success: false, message: "IPFS backup already completed" });

    await GenomicFile.findByIdAndUpdate(id, { ipfsStatus: "pending", ipfsCid: null, ipfsUrl: null });

    setImmediate(async () => {
      try {
        await GenomicFile.findByIdAndUpdate(id, { ipfsStatus: "uploading" });
        const { cid, ipfsUrl } = await uploadToIPFS(
          file.azureBlobName, file.originalName,
          file.mimeType || "application/octet-stream", file.sizeBytes
        );
        await GenomicFile.findByIdAndUpdate(id, { ipfsCid: cid, ipfsUrl, ipfsStatus: "done" });
        console.log(`[IPFS] ✅ Retry succeeded for ${file.azureBlobName} → CID: ${cid}`);
      } catch (ipfsErr) {
        console.error(`[IPFS] ❌ Retry failed for ${file.azureBlobName}:`, ipfsErr.message);
        await GenomicFile.findByIdAndUpdate(id, { ipfsStatus: "failed" });
      }
    });

    return res.status(202).json({
      success:    true,
      message:    "IPFS retry started. Poll /ipfs-status for progress.",
      ipfsStatus: "pending",
    });
  } catch (err) {
    console.error("[retryIpfs]", err);
    return res.status(500).json({ success: false, message: "Failed to start IPFS retry" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/files/:id/preview
   Protected – owner role only
   Returns first 256 bytes of the file in both encrypted and decrypted form.
   Uses HTTP Range request — never downloads the full file.
────────────────────────────────────────────────────────────────────────────*/
const previewFile = async (req, res) => {
  try {
    const { id }  = req.params;
    const userId  = req.user.userId;

    const file = await GenomicFile.findById(id).select("+encryptionIv");
    if (!file)
      return res.status(404).json({ success: false, message: "File not found" });
    if (String(file.owner) !== String(userId))
      return res.status(403).json({ success: false, message: "Access denied" });

    // Download exactly 256 bytes (16 × 16-byte AES blocks) — fast range request
    const PREVIEW_BYTES = 256;
    const { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");
    const acct   = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const key    = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const cred   = new StorageSharedKeyCredential(acct, key);
    const svc    = new BlobServiceClient(`https://${acct}.blob.core.windows.net`, cred);
    const blob   = svc.getContainerClient(file.azureContainerName).getBlobClient(file.azureBlobName);
    const resp   = await blob.download(0, PREVIEW_BYTES);
    const chunks = [];
    for await (const c of resp.readableStreamBody)
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const encChunk = Buffer.concat(chunks).slice(0, PREVIEW_BYTES);

    // Convert to array of { hex, dec } objects for the frontend
    const toByteArray = (buf) =>
      [...buf].map(b => ({ hex: b.toString(16).padStart(2, "0"), dec: b }));

    const encryptedBytes = toByteArray(encChunk);

    // Decrypt the 256-byte chunk if key+IV are available
    let decryptedBytes = null;
    if (file.isEncrypted && file.encryptionIv) {
      try {
        const aesKey  = await retrieveEncryptionKey(String(file._id));
        const aligned = encChunk.slice(0, Math.floor(encChunk.length / 16) * 16);
        const plain   = decryptPartialBuffer(aligned, aesKey, file.encryptionIv);
        decryptedBytes = toByteArray(plain);
      } catch (kvErr) {
        console.warn(`[Preview] Could not decrypt for preview: ${kvErr.message}`);
      }
    }

    return res.status(200).json({
      success:        true,
      fileName:       file.originalName,
      fileSize:       file.sizeBytes,
      isEncrypted:    file.isEncrypted,
      encryptionIv:   file.encryptionIv,
      algorithm:      "AES-256-CBC",
      previewBytes:   encChunk.length,
      encrypted:      encryptedBytes,    // raw ciphertext from Azure
      decrypted:      decryptedBytes,    // plaintext (null if not encrypted)
    });
  } catch (err) {
    console.error("[previewFile]", err);
    return res.status(500).json({ success: false, message: "Failed to generate preview" });
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   getPublicFiles  —  GET /api/files/public
   ─────────────────────────────────────────
   Returns a catalogue of all uploaded genomic files for researchers to browse.
   Only safe, non-sensitive metadata is returned (no cloud URLs, no IVs).
   Accessible by any authenticated researcher.
   ────────────────────────────────────────────────────────────────────────── */
const getPublicFiles = async (req, res) => {
  try {
    const files = await GenomicFile.find(
      { uploadStatus: "confirmed" },
      {
        _id: 1, originalName: 1, extension: 1, sizeBytes: 1,
        description: 1, isEncrypted: 1, ipfsStatus: 1,
        ipfsCid: 1, createdAt: 1, owner: 1,
        // catalog fields
        datasetId: 1, availability: 1,
        genomeBuild: 1, sequencingType: 1, riskCategory: 1,
        qualityScore: 1, detectedVariants: 1, predictedRisks: 1, phenotype: 1,
      }
    )
      // Populate ONLY anonymized owner fields — NO name or email
      .populate("owner", "age gender country")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, files });
  } catch (err) {
    console.error("[getPublicFiles]", err);
    return res.status(500).json({ success: false, message: "Failed to fetch datasets" });
  }
};

module.exports = { getUploadUrl, confirmUpload, getMyFiles, getIpfsStatus, previewFile, deleteFile, retryIpfs, getPublicFiles, retryEncryption };

