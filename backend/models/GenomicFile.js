const mongoose = require("mongoose");

/**
 * GenomicFile
 * ───────────
 * Persists the metadata for every successfully uploaded genomic file.
 * The actual file bytes live in Azure Blob Storage (primary) and
 * Filebase/IPFS (backup). This document is the authoritative index.
 */
const genomicFileSchema = new mongoose.Schema(
  {
    // ── Ownership ──────────────────────────────────────────────
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ── File identity ──────────────────────────────────────────
    originalName: {
      type: String,
      required: true,
      trim: true,
    },

    storedName: {
      type: String,   // timestamp + uuid + ext (safe name used in blob storage)
      required: true,
    },

    extension: {
      type: String,
      enum: [".fastq", ".bam", ".vcf"],
      required: true,
    },

    sizeBytes: {
      type: Number,
      required: true,
    },

    mimeType: {
      type: String,
    },

    // ── Azure Blob Storage (primary) ───────────────────────────
    azureBlobName: {
      type: String,
      required: true,
    },

    azureContainerName: {
      type: String,
      required: true,
    },

    cloudUrl: {
      type: String,
      required: true,
    },

    // ── IPFS / Filebase (backup) ───────────────────────────────
    ipfsCid: {
      type: String,
      default: null,
    },

    ipfsUrl: {
      type: String,
      default: null,
    },

    ipfsStatus: {
      type: String,
      enum: ["pending", "uploading", "done", "failed"],
      default: "pending",
    },

    // ── Encryption (AES-256-CBC) ───────────────────────────────
    // The AES key is stored in Azure Key Vault (never here).
    // The IV is NOT secret — it is safe to store in MongoDB.
    isEncrypted: {
      type: Boolean,
      default: false,
    },

    encryptionIv: {
      type: String, // 32-char hex (16 bytes)
      default: null,
      select: false, // Not returned by default — only fetched during decryption
    },

    // ── Encryption versioning (R3.2) ───────────────────────────
    // v1 = AES-256-CBC only (no MAC) — all existing files
    // v2 = AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC — new uploads
    // Existing documents without this field are implicitly v1.
    encryptionVersion: {
      type: String,
      enum: ["v1", "v2"],
      default: "v1",
    },

    // HMAC-SHA256 authentication tag for V2 files (Encrypt-then-MAC).
    // MAC covers: IV || ciphertext.
    // MAC key is HKDF-derived from the encryption key — not stored here.
    // select:false — never returned in normal queries, only fetched during download.
    encryptionMac: {
      type: String, // 64-char hex (32 bytes / 256-bit)
      default: null,
      select: false,
    },

    // ── Upload metadata ────────────────────────────────────────
    uploadStatus: {
      type: String,
      enum: ["confirmed", "deleted"],
      default: "confirmed",
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },

    // ── Dataset catalog ID ─────────────────────────────
    datasetId: {
      type:    String,
      unique:  true,
      sparse:  true,         // sparse so existing docs with null don’t conflict
      default: null,
    },

    // ── Availability ─────────────────────────────────
    availability: {
      type:    String,
      enum:    ["Available", "Restricted"],
      default: "Available",
    },

    // ── Genomic metadata (entered by owner at upload) ───────
    genomeBuild: {
      type: String,
      enum: ["GRCh38", "GRCh37", "hg19", "hg18", "T2T-CHM13", "Other"],
      default: null,
    },

    sequencingType: {
      type: String,
      enum: [
        "Whole Genome (WGS)", "Whole Exome (WES)", "RNA-seq",
        "Amplicon", "Single-cell RNA-seq", "ChIP-seq", "ATAC-seq", "Other",
      ],
      default: null,
    },

    riskCategory: {
      type: String,
      trim: true,
      default: null,
    },

    qualityScore: {
      type:    String,
      enum:    ["High", "Medium", "Low"],
      default: null,
    },

    detectedVariants: {
      type:    [String],
      default: [],
    },

    predictedRisks: {
      type:    [String],
      default: [],
    },

    phenotype: {
      type:    [String],
      default: [],
    },

    // ── Blockchain (Ethereum Sepolia) registration ─────────────────
    // Set by the background job after AES encryption completes.
    // null = not yet registered.

    // On-chain file ID (uint256 returned by registerFile())
    blockchainFileId: {
      type: Number,
      default: null,
    },

    // Transaction hash of the registerFile() call
    blockchainTxHash: {
      type: String,
      default: null,
    },

    blockchainBlockNum: {
      type: Number,
      default: null,
    },

    // SHA-256 hex of the ENCRYPTED blob (stored on-chain)
    blockchainFileHash: {
      type: String,
      default: null,
    },

    // SHA-256 hex of the RAW uploaded blob — computed at confirm-upload time,
    // before encryption. Used by the integrity SHA layer as a baseline hash
    // so verification always runs even if blockchain registration hasn't completed.
    uploadSha256Hash: {
      type: String,
      default: null,
    },

    // IPFS CID stored on-chain (field 4 of the contract)
    blockchainIpfsCID: {
      type: String,
      default: null,
    },

    blockchainTimestamp: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for fast owner-based listing
genomicFileSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model("GenomicFile", genomicFileSchema);
