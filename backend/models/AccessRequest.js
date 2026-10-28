/**
 * AccessRequest.js
 * ────────────────
 * Tracks researcher requests to access a specific genomic file,
 * and the owner's approval/denial decision.
 *
 * Lifecycle:
 *   pending  → approved | denied
 *   approved → access is granted for ACCESS_GRANT_HOURS (default 24h)
 */

const mongoose = require("mongoose");

const accessRequestSchema = new mongoose.Schema(
  {
    // The file being requested
    file: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GenomicFile",
      required: true,
      index: true,
    },

    // Denormalized file name — preserved even if the file is deleted
    fileName: {
      type:    String,
      default: null,
    },

    // The researcher who sent the request
    researcher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The data owner who owns the file (denormalized for fast queries)
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Optional legacy reason field (kept for backward-compat)
    reason: {
      type: String,
      trim: true,
      maxlength: [1000, "Reason cannot exceed 1000 characters"],
      default: "",
    },

    // ── Research Access Request structured fields ──────────────────────────
    projectTitle: {
      type: String,
      trim: true,
      maxlength: [200, "Project title cannot exceed 200 characters"],
      default: "",
    },

    // Purpose of research (detailed, replaces reason going forward)
    purpose: {
      type: String,
      trim: true,
      maxlength: [2000, "Purpose cannot exceed 2000 characters"],
      default: "",
    },

    // Access level requested
    accessType: {
      type: String,
      enum: ["read-only", "downloadable"],
      default: "read-only",
    },

    // Whether researcher checked "may request extension later"
    extensionRequested: {
      type: Boolean,
      default: false,
    },

    // Whether data will be shared with collaborators (shown to owner before approval)
    dataSharedWithCollaborators: {
      type: Boolean,
      default: false,
    },

    // Researcher's institution (pre-filled from profile)
    institution: {
      type: String,
      trim: true,
      maxlength: [200, "Institution name cannot exceed 200 characters"],
      default: "",
    },

    // Researcher's contact email for this request
    contactEmail: {
      type: String,
      trim: true,
      default: "",
    },

    // Benefits / risks as stated by researcher
    benefits: {
      type: String,
      trim: true,
      maxlength: [500, "Benefits cannot exceed 500 characters"],
      default: "",
    },

    risks: {
      type: String,
      trim: true,
      maxlength: [500, "Risks cannot exceed 500 characters"],
      default: "",
    },

    // Owner's note when requesting more information
    ownerNote: {
      type: String,
      trim: true,
      maxlength: [1000, "Owner note cannot exceed 1000 characters"],
      default: "",
    },

    // Workflow status
    status: {
      type: String,
      enum: ["pending", "approved", "denied", "rejected", "revoked", "more-info"],
      default: "pending",
      index: true,
    },

    // ── Identity versioning (R3.1) ─────────────────────────────────────────
    // Tracks which ORCID→bytes32 derivation was used for this request's
    // on-chain researcher identifier:
    //   v1 = keccak256(ORCID)            — legacy, used for all existing records
    //   v2 = HMAC-SHA256(secret, ORCID)  — keyed pseudonymous derivation (current)
    // Existing documents without this field are implicitly v1.
    // The smart contract stores bytes32 identifiers and has no concept of
    // identity versioning — this field is for application-level tracking only.
    identityVersion: {
      type: String,
      enum: ["v1", "v2"],
      default: "v2",
    },

    // When the owner approved (null until approved)
    approvedAt: {
      type: Date,
      default: null,
    },

    // When access expires (set on approval = approvedAt + ACCESS_GRANT_HOURS)
    accessExpiresAt: {
      type: Date,
      default: null,
    },

    // ── Blockchain receipt fields + per-transition status (R2.3) ──────────
    //
    // Two independent state machines:
    //   Application state  (status field above): PENDING | APPROVED | REJECTED | REVOKED
    //   Blockchain state   (*BlockchainStatus):  not_submitted | submitted | confirmed | failed
    //
    // These are INDEPENDENT. Examples:
    //   status=APPROVED, approveBlockchainStatus=CONFIRMED → fully verified approval
    //   status=APPROVED, approveBlockchainStatus=FAILED    → approved in app, tx failed on-chain
    //   status=APPROVED, approveBlockchainStatus=SUBMITTED → approved, tx in flight
    //
    // The download authorization policy reads BOTH fields. This separation
    // makes the MongoDB/blockchain relationship explicit and auditable.
    // Existing documents without *BlockchainStatus implicitly = 'not_submitted'.

    // Request transaction (AccessRequested event)
    requestTxHash:            { type: String, default: null },
    requestBlockNumber:       { type: Number, default: null },
    requestGasUsed:           { type: String, default: null },
    requestTxStatus:          { type: String, default: null },
    requestEtherscanUrl:      { type: String, default: null },
    requestBlockchainStatus:  {
      type: String,
      enum: ["not_submitted", "submitted", "confirmed", "failed"],
      default: "not_submitted",
    },

    // Approval transaction (AccessApproved event)
    approveTxHash:            { type: String, default: null },
    approveBlockNumber:       { type: Number, default: null },
    approveGasUsed:           { type: String, default: null },
    approveTxStatus:          { type: String, default: null },
    approveEtherscanUrl:      { type: String, default: null },
    approveBlockchainStatus:  {
      type: String,
      enum: ["not_submitted", "submitted", "confirmed", "failed"],
      default: "not_submitted",
    },

    // Rejection transaction (AccessRejected event)
    rejectTxHash:             { type: String, default: null },
    rejectBlockNumber:        { type: Number, default: null },
    rejectGasUsed:            { type: String, default: null },
    rejectTxStatus:           { type: String, default: null },
    rejectEtherscanUrl:       { type: String, default: null },
    rejectBlockchainStatus:   {
      type: String,
      enum: ["not_submitted", "submitted", "confirmed", "failed"],
      default: "not_submitted",
    },

    // Revocation transaction (AccessRevoked event)
    revokeTxHash:             { type: String, default: null },
    revokeBlockNumber:        { type: Number, default: null },
    revokeGasUsed:            { type: String, default: null },
    revokeTxStatus:           { type: String, default: null },
    revokeEtherscanUrl:       { type: String, default: null },
    revokeBlockchainStatus:   {
      type: String,
      enum: ["not_submitted", "submitted", "confirmed", "failed"],
      default: "not_submitted",
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate pending requests (one active request per researcher-file pair)
accessRequestSchema.index({ file: 1, researcher: 1 }, { unique: true });

// Fast lookup of all requests for a specific file
accessRequestSchema.index({ file: 1, status: 1 });

// Fast lookup of all requests sent by a specific researcher
accessRequestSchema.index({ researcher: 1, status: 1 });

module.exports = mongoose.model("AccessRequest", accessRequestSchema);
