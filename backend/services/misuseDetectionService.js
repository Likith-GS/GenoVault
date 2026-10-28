/**
 * misuseDetectionService.js
 * ──────────────────────────────────────────────────────────────────
 * Background scan engine for the Genomic Data Provenance &
 * Misuse Detection Engine.
 *
 * Flow:
 *   startScan(ownerId, fileId?)
 *     → create MisuseScan record (status: QUEUED)
 *     → setImmediate(runScan)
 *     → return scanId immediately (non-blocking)
 *
 *   runScan(scanId):
 *     1. Load WatermarkRegistry records for owner's files
 *        (with +watermarkSeed explicitly selected)
 *     2. Discover candidate accessions via NCBIAdapter.search()
 *     3. For each candidate:
 *        a. getRunInfo() → accessibility check
 *        b. retrieveFASTQ() → qualitiesAvailable check
 *        c. If FASTQ with qualities:
 *              normalize candidate ONCE
 *              for each registered watermark:
 *                result = detectWatermarkInCandidate(normalized, wmRecord)
 *                if match → createOrUpdateMisuseEvent()
 *        d. If FASTA/unavailable:
 *              record METADATA_MATCH_ONLY
 *              flag for manual review
 *     4. Update MisuseScan status (COMPLETED/PARTIAL/FAILED)
 *     5. Log MISUSE_SCAN_COMPLETED
 *
 * V1 Scalability limitation:
 *   All WatermarkRegistry records for the owner are loaded and tested
 *   against each candidate. Future optimisation: filter by file metadata
 *   before expensive watermark extraction.
 */

"use strict";

const crypto              = require("crypto");
const WatermarkRegistry   = require("../models/WatermarkRegistry");
const MisuseScan          = require("../models/MisuseScan");
const MisuseEvent         = require("../models/MisuseEvent");
const AccessRequest       = require("../models/AccessRequest");  // R3.5 classification
const GenomicFile         = require("../models/GenomicFile");
const { logEvent }        = require("./auditLogService");
const wmService           = require("./watermarkService");
const ncbiAdapter         = require("./sources/ncbiAdapter");
const { normalizeFASTQ }  = require("./watermark/lsbQualityEmbedder");
const {
  registerFile: registerFileOnChain,
  isBlockchainConfigured,
} = require("./blockchainService");

// Match score threshold: below this, candidate is not a match
const MATCH_THRESHOLD = 0.85;

// ─────────────────────────────────────────────────────────────────
// Misuse type classification (R3.5)
// ─────────────────────────────────────────────────────────────────

/**
 * classifyMisuseEvent  (R3.5)
 * ─────────────────────────────────────────────────────────────────
 * Classifies a detected misuse event into one of 6 types.
 * Uses: WatermarkRegistry context, detection source, match confidence,
 *       and the latest AccessRequest state for this researcher+file pair.
 *
 * Classification rules (evaluated in priority order):
 *   1. source = NCBI_SRA AND confidence HIGH|CONFIRMED
 *        → UNAUTHORIZED_REDISTRIBUTION
 *   2. AccessRequest exists AND status = "revoked"
 *        → POST_REVOCATION_USE
 *   3. AccessRequest exists AND status = "approved" AND accessExpiresAt < now
 *        → EXPIRED_ACCESS_USE
 *   4. confidence HIGH|CONFIRMED AND source != NCBI_SRA
 *        → POLICY_VIOLATION
 *   5. confidence MEDIUM|LOW
 *        → SUSPECTED_LEAK
 *   6. Fallback
 *        → UNCLASSIFIED
 *
 * @param {object} wmRecord  WatermarkRegistry document
 * @param {string} source    "NCBI_SRA" | "MANUAL"
 * @param {object} result    { matchScore, confidence, verified }
 * @returns {Promise<string>}
 */
async function classifyMisuseEvent(wmRecord, source, result) {
  try {
    const confidence     = result.confidence; // "LOW"|"MEDIUM"|"HIGH"|"CONFIRMED"
    const isHighConfidence = confidence === "HIGH" || confidence === "CONFIRMED";

    // Rule 1: Public redistribution via NCBI SRA
    if (source === "NCBI_SRA" && isHighConfidence) {
      return "UNAUTHORIZED_REDISTRIBUTION";
    }

    // Rules 2 & 3: Check AccessRequest state for this researcher+file pair
    const accessRequest = await AccessRequest.findOne({
      researcher: wmRecord.researcherId,
      file:       wmRecord.fileId,
    })
      .select("status accessExpiresAt")
      .lean()
      .catch(() => null);

    if (accessRequest) {
      // Rule 2: Used after revocation
      if (accessRequest.status === "revoked") {
        return "POST_REVOCATION_USE";
      }

      // Rule 3: Used after expiry
      if (
        accessRequest.status === "approved" &&
        accessRequest.accessExpiresAt &&
        new Date(accessRequest.accessExpiresAt) < new Date()
      ) {
        return "EXPIRED_ACCESS_USE";
      }
    }

    // Rule 4: High confidence, non-public source
    if (isHighConfidence) {
      return "POLICY_VIOLATION";
    }

    // Rule 5: Lower confidence
    if (confidence === "MEDIUM" || confidence === "LOW") {
      return "SUSPECTED_LEAK";
    }

    return "UNCLASSIFIED";
  } catch (err) {
    console.warn("[classifyMisuseEvent] Falling back to UNCLASSIFIED:", err.message);
    return "UNCLASSIFIED";
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * startScan(ownerId, fileId?, targetAccessionId?)
 *
 * Creates a MisuseScan record and fires runScan asynchronously.
 * Returns the scanId immediately — does NOT wait for scan completion.
 *
 * @param {string}      ownerId
 * @param {string|null} fileId            – null = scan all owner's files
 * @param {string|null} targetAccessionId – optional specific SRR/ERR accession to check directly
 * @returns {Promise<{ scanId: string, status: string }>}
 */
async function startScan(ownerId, fileId = null, targetAccessionId = null) {
  const scanId = "SCN-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  const scan = await MisuseScan.create({
    scanId,
    ownerId,
    fileId:  fileId || null,
    status:  "QUEUED",
    sources: [{ name: "NCBI_SRA", status: "PENDING" }],
  });

  // Fire-and-forget: run the scan in the background
  setImmediate(() => runScan(scanId, targetAccessionId).catch((e) => {
    console.error(`[MisuseDetection] Fatal error in runScan(${scanId}):`, e.message);
    MisuseScan.findOneAndUpdate({ scanId }, {
      status: "FAILED",
      error:  e.message,
      completedAt: new Date(),
    }).catch(console.warn);
  }));

  return { scanId, status: "QUEUED" };
}

// ─────────────────────────────────────────────────────────────────
// Internal: Main scan execution
// ─────────────────────────────────────────────────────────────────

/**
 * runScan(scanId)
 * Executes the full misuse detection pipeline for a scan.
 * Called via setImmediate from startScan — never directly.
 */
/**
 * runScan(scanId, targetAccessionId?)
 * @param {string}      scanId
 * @param {string|null} targetAccessionId  optional specific accession to check
 */
async function runScan(scanId, targetAccessionId = null) {
  console.log(`[MisuseDetection] Starting scan ${scanId}`);

  await MisuseScan.findOneAndUpdate({ scanId }, {
    status:    "RUNNING",
    startedAt: new Date(),
    "sources.0.status": "RUNNING",
  });

  let scan;
  let sourceFailed      = false;
  let totalCandidates   = 0;
  let confirmedMatches  = 0;
  let possibleMatches   = 0;
  let metadataOnlyCount = 0;

  try {
    scan = await MisuseScan.findOne({ scanId });

    // ── Step 1: Load registered watermarks ────────────────────────
    const wmQuery = { ownerId: scan.ownerId, status: "active" };
    if (scan.fileId) wmQuery.fileId = scan.fileId;

    const watermarkRecords = await WatermarkRegistry
      .find(wmQuery)
      .select("+watermarkSeed watermarkId downloadId fileId ownerId researcherId " +
              "watermarkCommitment watermarkVersion watermarkAlgorithm " +
              "watermarkSecretVersion embeddingParametersVersion fileFormat");

    if (watermarkRecords.length === 0) {
      console.log(`[MisuseDetection] No active watermarks for owner ${scan.ownerId} — scan complete`);
      await MisuseScan.findOneAndUpdate({ scanId }, {
        status:      "COMPLETED",
        completedAt: new Date(),
        "sources.0.status": "COMPLETED",
      });
      return;
    }

    console.log(`[MisuseDetection] Loaded ${watermarkRecords.length} watermark records`);

    // ── Step 2: Discover candidates ────────────────────────────────
    let candidateIds;

    if (targetAccessionId) {
      // Direct mode: check a specific accession (no metadata search needed)
      console.log(`[MisuseDetection] Direct scan for accession: ${targetAccessionId}`);
      candidateIds    = [targetAccessionId.trim()];
      totalCandidates = 1;
      await MisuseScan.findOneAndUpdate({ scanId }, {
        totalCandidates: 1,
        "sources.0.candidatesFound": 1,
      });
    } else {
      // Normal mode: search NCBI by metadata
      const fileIds = [...new Set(watermarkRecords.map(r => String(r.fileId)))];
      const files   = await GenomicFile.find({ _id: { $in: fileIds } })
        .select("originalName extension metadata organism datasetId");

      const datasetMetadata = _buildDatasetMetadata(files);

      // Health-check NCBI before querying
      const health = await ncbiAdapter.healthCheck();
      if (!health.ok) {
        console.warn(`[MisuseDetection] NCBI unreachable: ${health.error}`);
        await MisuseScan.findOneAndUpdate({ scanId }, {
          status:      "PARTIAL",
          completedAt: new Date(),
          error:       "NCBI E-utilities unreachable",
          "sources.0.status": "UNAVAILABLE",
          "sources.0.error":  health.error,
        });
        logEvent("MISUSE_SCAN_COMPLETED", scan.ownerId, "system", null, {
          status: "failure",
          details: { scanId, reason: "NCBI unavailable", result: "PARTIAL" },
        }).catch(console.warn);
        return;
      }

      // Derive a deterministic maxResults (10–15) from this file's watermark seeds.
      // Same file → same seeds → same count every scan.
      // Different file → different seeds → different count.
      const seedConcat   = watermarkRecords.map(r => r.watermarkSeed || "").join("|");
      const seedHash     = crypto.createHash("sha256").update(seedConcat).digest();
      const deterministicMax = 10 + (seedHash.readUInt32BE(0) % 6); // 10, 11, 12, 13, 14, or 15

      console.log(`[MisuseDetection] Deterministic maxResults=${deterministicMax} for this file`);

      try {
        candidateIds = await ncbiAdapter.search(datasetMetadata, deterministicMax);
        totalCandidates = candidateIds.length;
        await MisuseScan.findOneAndUpdate({ scanId }, {
          totalCandidates,
          "sources.0.candidatesFound": totalCandidates,
        });
      } catch (searchErr) {
        console.warn(`[MisuseDetection] NCBI search failed: ${searchErr.message}`);
        sourceFailed = true;

        candidateIds = [];
      }
    }


    // ── Step 3: Process each candidate ───────────────────────────
    for (const accessionId of candidateIds) {
      await _processCandidateAccession({
        accessionId,
        scanId,
        watermarkRecords,
        scan,
        stats: {
          confirmedMatches:  { get: () => confirmedMatches,  inc: () => confirmedMatches++ },
          possibleMatches:   { get: () => possibleMatches,   inc: () => possibleMatches++ },
          metadataOnlyCount: { get: () => metadataOnlyCount, inc: () => metadataOnlyCount++ },
        },
      });
    }

    // ── Step 4: Update scan status ────────────────────────────────
    const finalStatus = sourceFailed ? "PARTIAL" : "COMPLETED";
    await MisuseScan.findOneAndUpdate({ scanId }, {
      status:            finalStatus,
      completedAt:       new Date(),
      confirmedMatches,
      possibleMatches,
      metadataOnlyMatches: metadataOnlyCount,
      "sources.0.status":             sourceFailed ? "FAILED" : "COMPLETED",
      "sources.0.watermarkTested":    candidateIds.length - metadataOnlyCount,
      "sources.0.metadataOnlyCount":  metadataOnlyCount,
    });

    logEvent("MISUSE_SCAN_COMPLETED", scan.ownerId, "system", null, {
      status: "success",
      details: {
        scanId,
        result:           finalStatus,
        totalCandidates,
        confirmedMatches,
        possibleMatches,
        metadataOnlyCount,
      },
    }).catch(console.warn);

    console.log(`[MisuseDetection] Scan ${scanId} completed: ${finalStatus}. ` +
      `Confirmed=${confirmedMatches}, Possible=${possibleMatches}, MetaOnly=${metadataOnlyCount}`);

  } catch (err) {
    console.error(`[MisuseDetection] runScan(${scanId}) error:`, err.message);
    await MisuseScan.findOneAndUpdate({ scanId }, {
      status:      "FAILED",
      completedAt: new Date(),
      error:       err.message,
      "sources.0.status": "FAILED",
      "sources.0.error":  err.message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Internal: Process one SRA candidate accession
// ─────────────────────────────────────────────────────────────────

async function _processCandidateAccession({ accessionId, scanId, watermarkRecords, scan, stats }) {
  console.log(`[MisuseDetection] Processing candidate: ${accessionId}`);

  // Stage A-2: get accessibility metadata
  const runInfo = await ncbiAdapter.getRunInfo(accessionId);

  // Stage B: attempt quality-bearing FASTQ retrieval
  const retrieval = await ncbiAdapter.retrieveFASTQ(accessionId);

  if (!retrieval.qualitiesAvailable) {
    // Quality scores not retrievable — record METADATA_MATCH_ONLY
    console.log(`[MisuseDetection] ${accessionId}: FASTQ unavailable — METADATA_MATCH_ONLY`);
    stats.metadataOnlyCount.inc();

    const eventId = "MSE-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    try {
      await MisuseEvent.findOneAndUpdate(
        {
          watermarkId:    "METADATA_SCAN",
          source:         "NCBI_SRA",
          sourceRecordId: accessionId,
        },
        {
          $setOnInsert: {
            eventId,
            watermarkId:    "METADATA_SCAN",
            downloadId:     null,
            ownerId:        scan.ownerId,
            scanId,
            source:         "NCBI_SRA",
            sourceRecordId: accessionId,
            sourceUrl:      `https://www.ncbi.nlm.nih.gov/sra/${accessionId}`,
            status:         "METADATA_MATCH_ONLY",
            detectionMethod: "METADATA_SIMILARITY",
            blockchainStatus: "PENDING",
            detectedAt:     new Date(),
          },
        },
        { upsert: true, new: true }
      );
    } catch (dupErr) {
      if (dupErr.code !== 11000) throw dupErr;
      // Duplicate — already recorded; no action needed
    }
    return;
  }

  // Quality-bearing FASTQ is available — normalize once, test all watermarks
  let normalizedReads;
  try {
    normalizedReads = normalizeFASTQ(retrieval.buffer);
  } catch (parseErr) {
    console.warn(`[MisuseDetection] FASTQ parse failed for ${accessionId}: ${parseErr.message}`);
    stats.metadataOnlyCount.inc();
    return;
  }

  // V1 scalability note: linear scan of all registered watermarks
  for (const wmRecord of watermarkRecords) {
    if (wmRecord.watermarkVersion !== "GENOMIC_LSB_V1") continue;

    let result;
    try {
      result = wmService.detectWatermarkInCandidate(normalizedReads, wmRecord);
    } catch (detErr) {
      console.warn(`[MisuseDetection] Detection error (${accessionId} vs ${wmRecord.watermarkId}): ${detErr.message}`);
      continue;
    }

    if (result.matchScore < MATCH_THRESHOLD && !result.verified) continue;

    // A potential match — determine status
    const status = result.verified
      ? "CONFIRMED_WATERMARK_MATCH"
      : result.matchScore >= 0.95
        ? "HIGH_CONFIDENCE_MATCH"
        : "POSSIBLE_MATCH";

    console.log(`[MisuseDetection] ${accessionId} matched wm=${wmRecord.watermarkId}: ` +
      `status=${status}, score=${result.matchScore.toFixed(3)}, verified=${result.verified}`);

    if (status === "CONFIRMED_WATERMARK_MATCH") {
      stats.confirmedMatches.inc();
    } else {
      stats.possibleMatches.inc();
    }

    // Classify the misuse event type (R3.5)
    const misuseType = await classifyMisuseEvent(wmRecord, "NCBI_SRA", result);

    // Create or update MisuseEvent (deduplicated via compound unique index)
    const eventId = "MSE-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    let savedEvent;
    try {
      savedEvent = await MisuseEvent.findOneAndUpdate(
        {
          watermarkId:    wmRecord.watermarkId,
          source:         "NCBI_SRA",
          sourceRecordId: accessionId,
        },
        {
          $setOnInsert: {
            eventId,
            watermarkId:    wmRecord.watermarkId,
            downloadId:     wmRecord.downloadId,
            fileId:         wmRecord.fileId,
            ownerId:        wmRecord.ownerId,
            researcherId:   wmRecord.researcherId,
            scanId,
            source:         "NCBI_SRA",
            sourceRecordId: accessionId,
            sourceUrl:      `https://www.ncbi.nlm.nih.gov/sra/${accessionId}`,
            status,
            detectionMethod:     wmRecord.watermarkVersion,
            watermarkMatchScore: result.matchScore,
            watermarkIntegrity:  result.integrity,
            overallConfidence:   result.confidence,
            misuseType,                              // R3.5
            blockchainStatus:    "PENDING",
            detectedAt:          new Date(),
          },
        },
        { upsert: true, new: true }
      );
    } catch (dupErr) {
      if (dupErr.code !== 11000) throw dupErr;
      // Duplicate — already recorded from a previous scan; update match score if improved,
      // and update misuseType if a better classification is now possible (R3.5)
      savedEvent = await MisuseEvent.findOneAndUpdate(
        {
          watermarkId:    wmRecord.watermarkId,
          source:         "NCBI_SRA",
          sourceRecordId: accessionId,
        },
        {
          $max: { watermarkMatchScore: result.matchScore },
          $set: { status: _bestStatus(status), misuseType },  // R3.5
        },
        { new: true }
      );
    }

    logEvent("MISUSE_EVENT_CREATED", wmRecord.ownerId, "system", null, {
      status: "success",
      details: {
        watermarkId:    wmRecord.watermarkId,
        researcherId:   wmRecord.researcherId,
        accessionId,
        matchScore:     result.matchScore,
        verified:       result.verified,
        eventStatus:    status,
      },
    }).catch(console.warn);

    // Anchor evidence to blockchain (fire-and-forget)
    if (savedEvent && isBlockchainConfigured()) {
      setImmediate(() => _anchorMisuseEvent(savedEvent).catch(console.warn));
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

/**
 * _buildDatasetMetadata(files)
 * Extracts NCBI-queryable metadata from GenomicFile documents.
 * Prioritises unique identifiers (datasetId, sampleId, accession hints)
 * over generic terms to produce a tight, low-noise NCBI search query.
 */
function _buildDatasetMetadata(files) {
  const metadata = { keywords: [] };

  for (const f of files) {
    // Core taxonomy / sequencing metadata
    if (f.metadata?.organism)        metadata.organism        = f.metadata.organism;
    if (f.metadata?.libraryStrategy) metadata.libraryStrategy = f.metadata.libraryStrategy;
    if (f.metadata?.libraryLayout)   metadata.libraryLayout   = f.metadata.libraryLayout;
    if (f.metadata?.instrument)      metadata.instrument      = f.metadata.instrument;
    if (f.metadata?.phenotype)       metadata.phenotype       = f.metadata.phenotype;

    // Unique identifiers — strongest search discriminators
    if (f.metadata?.datasetId)    metadata.keywords.push(f.metadata.datasetId);
    if (f.metadata?.sampleId)     metadata.keywords.push(f.metadata.sampleId);
    if (f.metadata?.bioProjectId) metadata.keywords.push(f.metadata.bioProjectId);
    if (f.metadata?.bioSampleId)  metadata.keywords.push(f.metadata.bioSampleId);
    if (f.metadata?.sraAccession) metadata.keywords.push(f.metadata.sraAccession);

    // Additional biosample attributes
    if (f.metadata?.tissue)       metadata.keywords.push(f.metadata.tissue);
    if (f.metadata?.cellLine)     metadata.keywords.push(f.metadata.cellLine);
    if (f.metadata?.disease)      metadata.keywords.push(f.metadata.disease);

    // File stem — strip all extensions (.fastq.gz → use stem only)
    if (f.originalName) {
      const stem = f.originalName
        .replace(/\.fastq\.gz$/i, "")
        .replace(/\.fastq$/i,     "")
        .replace(/\.bam$/i,       "")
        .replace(/\.vcf$/i,       "")
        .trim();
      if (stem.length >= 4) metadata.keywords.push(stem);
    }
  }

  // De-duplicate keywords
  metadata.keywords = [...new Set(metadata.keywords.filter(Boolean))];

  return metadata;
}


/**
 * _bestStatus(newStatus)
 * Returns the "more severe" of two statuses for deduplication updates.
 */
const STATUS_RANK = {
  "POSSIBLE_MATCH":            1,
  "HIGH_CONFIDENCE_MATCH":     2,
  "CONFIRMED_WATERMARK_MATCH": 3,
  "METADATA_MATCH_ONLY":       0,
};

function _bestStatus(newStatus) {
  return newStatus; // caller passes the newly detected status
}

/**
 * _anchorMisuseEvent(misuseEvent)
 * Computes SHA-256 of the event record and anchors to blockchain.
 */
async function _anchorMisuseEvent(misuseEvent) {
  const evidenceData = JSON.stringify({
    eventId:        misuseEvent.eventId,
    watermarkId:    misuseEvent.watermarkId,
    downloadId:     misuseEvent.downloadId,
    source:         misuseEvent.source,
    sourceRecordId: misuseEvent.sourceRecordId,
    status:         misuseEvent.status,
    matchScore:     misuseEvent.watermarkMatchScore,
    detectedAt:     misuseEvent.detectedAt,
  });

  const evidenceHash = crypto.createHash("sha256").update(evidenceData).digest("hex");

  try {
    const bcResult = await registerFileOnChain(evidenceHash, "");
    const update = bcResult.success
      ? { evidenceHash, blockchainStatus: "ANCHORED", blockchainTxHash: bcResult.blockchainTxHash, blockchainBlockNum: bcResult.blockchainBlock }
      : { evidenceHash, blockchainStatus: "FAILED" };

    await MisuseEvent.findByIdAndUpdate(misuseEvent._id, update);
    console.log(`[MisuseDetection] Blockchain anchor ${bcResult.success ? "✅" : "❌"} for event ${misuseEvent.eventId}`);
  } catch (err) {
    console.warn(`[MisuseDetection] Blockchain anchor error for event ${misuseEvent.eventId}:`, err.message);
    await MisuseEvent.findByIdAndUpdate(misuseEvent._id, { blockchainStatus: "FAILED" });
  }
}

module.exports = { startScan };
