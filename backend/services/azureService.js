/**
 * azureService.js
 * ───────────────
 * Encapsulates all Azure Blob Storage operations.
 *
 * Architecture:
 *  • Frontend uploads DIRECTLY to Azure using a SAS token
 *  • Backend never touches the file bytes → no bottleneck
 *  • SAS token is scoped to a single blob, write-only, short-lived (30 min)
 */

const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");

const ACCOUNT_NAME   = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY    = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || "genomic-files";

/**
 * Build the BlobServiceClient (used for server-side operations like
 * confirming a blob exists or triggering IPFS backup).
 */
const getBlobServiceClient = () => {
  if (!ACCOUNT_NAME || !ACCOUNT_KEY) {
    throw new Error(
      "Azure Storage credentials missing. Set AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY in .env"
    );
  }
  const credential = new StorageSharedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY);
  return new BlobServiceClient(
    `https://${ACCOUNT_NAME}.blob.core.windows.net`,
    credential
  );
};

/**
 * generateUploadSasToken
 * ──────────────────────
 * Creates a write-only SAS token for a specific blob.
 * The frontend uses this token to upload directly to Azure.
 *
 * @param {string} blobName   - The safe stored filename
 * @param {number} expiryMins - Token validity in minutes (default: 30)
 * @returns {{ sasToken, blobUrl, containerName, blobName }}
 */
const generateUploadSasToken = (blobName, expiryMins = 30) => {
  if (!ACCOUNT_NAME || !ACCOUNT_KEY) {
    throw new Error("Azure Storage credentials not configured");
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(
    ACCOUNT_NAME,
    ACCOUNT_KEY
  );

  // Start 2 minutes in the past to handle clock skew between
  // local machine and Azure servers (prevents "signature invalid" errors)
  const startsOn  = new Date(Date.now() - 2 * 60 * 1000);
  const expiresOn = new Date(Date.now() + expiryMins * 60 * 1000);

  // Write-only permissions — frontend can upload but not read/list
  const permissions = new BlobSASPermissions();
  permissions.write  = true;
  permissions.create = true;

  const sasQueryParams = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName,
      permissions,
      startsOn,
      expiresOn,
    },
    sharedKeyCredential
  );

  const sasToken = sasQueryParams.toString();
  const blobUrl  = `https://${ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${blobName}`;

  return {
    sasToken,
    blobUrl,
    containerName: CONTAINER_NAME,
    blobName,
  };
};

/**
 * verifyBlobExists
 * ────────────────
 * Called by confirm-upload to make sure the frontend actually
 * finished uploading before we trigger IPFS backup.
 *
 * @param {string} blobName
 * @returns {Promise<boolean>}
 */
const verifyBlobExists = async (blobName) => {
  try {
    const client = getBlobServiceClient();
    const containerClient = client.getContainerClient(CONTAINER_NAME);
    const blobClient = containerClient.getBlobClient(blobName);
    return await blobClient.exists();
  } catch {
    return false;
  }
};

/**
 * getBlobProperties
 * ─────────────────
 * Returns size and content-type of a stored blob.
 * Used when confirming upload metadata server-side.
 *
 * @param {string} blobName
 */
const getBlobProperties = async (blobName) => {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const blobClient = containerClient.getBlobClient(blobName);
  const props = await blobClient.getProperties();
  return {
    sizeBytes: props.contentLength,
    mimeType:  props.contentType,
  };
};

/**
 * getReadableBlobStream
 * ─────────────────────
 * Returns a readable Node.js stream for a blob.
 * Used by ipfsService to stream the file to Filebase without
 * writing it to disk.
 *
 * @param {string} blobName
 */
const getReadableBlobStream = async (blobName) => {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const blobClient = containerClient.getBlobClient(blobName);
  const downloadResponse = await blobClient.download(0);
  return downloadResponse.readableStreamBody;
};


/**
 * ensureContainerExists
 * ─────────────────────
 * Creates the container if it doesn't already exist.
 * Should be called once on server startup.
 */
const ensureContainerExists = async () => {
  try {
    const client          = getBlobServiceClient();
    const containerClient = client.getContainerClient(CONTAINER_NAME);
    const created         = await containerClient.createIfNotExists();
    if (created.succeeded) {
      console.log(`[Azure] Container "${CONTAINER_NAME}" created`);
    }
  } catch (err) {
    console.error("[Azure] Failed to ensure container exists:", err.message);
  }
};

/**
 * configureCors
 * ─────────────
 * Sets CORS rules on the Azure Blob service so browsers can upload directly
 * without preflight OPTIONS requests blocking every single block upload.
 *
 * Without this, Chrome/Firefox sends an OPTIONS preflight before EVERY block,
 * effectively DOUBLING the number of round-trips and halving upload speed.
 *
 * Called once on server startup — safe to call repeatedly (idempotent).
 */
const configureCors = async () => {
  try {
    const client = getBlobServiceClient();

    await client.setProperties({
      cors: [
        {
          allowedOrigins:  "*",                                           // tighten to your domain in prod
          allowedMethods:  "DELETE,GET,HEAD,MERGE,POST,OPTIONS,PUT,PATCH",
          allowedHeaders:  "*",
          exposedHeaders:  "*",
          maxAgeInSeconds: 86400,                                         // 24h cache — no preflight repeat
        },
      ],
    });

    console.log("[Azure] ✅ CORS configured — browser direct-upload enabled");
  } catch (err) {
    console.error("[Azure] ❌ Failed to set CORS rules:", err.message);
    console.error("        → Upload may be slow due to preflight delays");
  }
};

/**
 * uploadEncryptedBuffer
 * ─────────────────────
 * Uploads a pre-encrypted Buffer directly from the backend to Azure.
 * Used in the server-side encryption upload flow.
 *
 * @param {string} blobName      - Unique blob name (same as stored in GenomicFile)
 * @param {Buffer} encryptedBuf  - AES-256-CBC encrypted file bytes
 * @param {string} contentType   - MIME type of the original file
 * @returns {Promise<string>}    - Full blob URL
 */
const uploadEncryptedBuffer = async (blobName, encryptedBuf, contentType = "application/octet-stream") => {
  const client          = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(encryptedBuf, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return `https://${ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${blobName}`;
};

/**
 * downloadBlobToBuffer
 * ────────────────────
 * Downloads a blob from Azure and returns its bytes as a Buffer.
 * Used during decryption: fetch encrypted bytes → decrypt → stream to researcher.
 *
 * @param {string} blobName
 * @returns {Promise<Buffer>}
 */
const downloadBlobToBuffer = async (blobName) => {
  const client          = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  const blobClient      = containerClient.getBlobClient(blobName);
  const downloadResp    = await blobClient.download(0);
  const stream          = downloadResp.readableStreamBody;
  const chunks          = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

module.exports = {
  generateUploadSasToken,
  verifyBlobExists,
  getBlobProperties,
  getReadableBlobStream,
  ensureContainerExists,
  configureCors,
  uploadEncryptedBuffer,
  downloadBlobToBuffer,
};
