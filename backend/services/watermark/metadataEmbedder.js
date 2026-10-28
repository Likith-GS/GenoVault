/**
 * metadataEmbedder.js
 * ──────────────────────────────────────────────────────────────────
 * Metadata-field watermarking for BAM and VCF files — METADATA_V1
 *
 * ⚠️  WEAK WATERMARK — metadata can be stripped by standard tools.
 *     This is a compatibility mechanism only so that BAM/VCF downloads
 *     receive some provenance tracking. It does NOT satisfy the
 *     "cannot be trivially removed" requirement.
 *
 * BAM: Inserts watermarkId into the CO (comment) optional field of the
 *      SAM header. The CO tag is a standard optional header tag.
 *
 * VCF: Inserts a ##GENOVAULT_WM comment line in the VCF header
 *      carrying the watermarkId.
 *
 * Detection reads the tag/comment and matches watermarkId against
 * registered records — no cryptographic position reconstruction needed.
 *
 * This service is clearly labelled WEAK_WATERMARK internally.
 */

"use strict";

// ── Watermark tag constants ──────────────────────────────────────
const WM_TAG_BAM = "CO:Z:GENOVAULT_WM:";   // SAM optional tag prefix
const WM_TAG_VCF = "##GENOVAULT_WM=";       // VCF meta-info line prefix

// ─────────────────────────────────────────────────────────────────
// BAM helpers (operate on SAM text representation)
// ─────────────────────────────────────────────────────────────────

/**
 * embedBAM(buffer, watermarkRecord)
 * Inserts @CO watermark tag into the SAM/BAM header lines.
 *
 * BAM files are binary — only the header is text (SAM format).
 * We slice the first HEADER_SLICE bytes for text parsing, embed
 * the tag into the header, then re-join with the untouched binary body.
 * This avoids the Node.js string-length crash on large BAM files.
 *
 * @param {Buffer} buffer
 * @param {Object} watermarkRecord  – must include watermarkId
 * @returns {{ watermarkedBuffer: Buffer }}
 */
const HEADER_SLICE = 65536; // 64 KB — far larger than any real BAM header

function embedBAM(buffer, watermarkRecord) {
  // WEAK_WATERMARK: metadata-only; can be stripped by samtools view -H

  // Only convert the header region to text — do NOT toString() the whole file
  const headerBuf  = buffer.slice(0, Math.min(HEADER_SLICE, buffer.length));
  const bodyBuf    = buffer.slice(Math.min(HEADER_SLICE, buffer.length));

  const headerText = headerBuf.toString("latin1"); // latin1 preserves bytes 1-to-1
  const lines      = headerText.split(/\r?\n/);
  const tag        = `@CO\t${WM_TAG_BAM}${watermarkRecord.watermarkId}`;

  // Insert after last @HD or @SQ header line, before first read
  let insertIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("@HD") || lines[i].startsWith("@SQ")) {
      insertIdx = i + 1;
    }
  }

  lines.splice(insertIdx, 0, tag);
  const newHeaderBuf = Buffer.from(lines.join("\n"), "latin1");
  return { watermarkedBuffer: Buffer.concat([newHeaderBuf, bodyBuf]) };
}

/**
 * detectBAM(buffer, watermarkRecord)
 * Scans SAM header for the watermark CO tag and verifies watermarkId.
 * Only scans the first HEADER_SLICE bytes to avoid OOM on large BAM files.
 *
 * @param {Buffer} buffer
 * @param {Object} watermarkRecord
 * @returns {{ verified: boolean, matchScore: number, integrity: number }}
 */
function detectBAM(buffer, watermarkRecord) {
  // WEAK_WATERMARK: detection only checks if the tag is present in the header
  const headerText = buffer.slice(0, Math.min(HEADER_SLICE, buffer.length)).toString("latin1");
  const tag        = `${WM_TAG_BAM}${watermarkRecord.watermarkId}`;

  const found = headerText.includes(tag);
  return {
    verified:   found,
    matchScore: found ? 1 : 0,
    integrity:  found ? 1 : 0,
  };
}


// ─────────────────────────────────────────────────────────────────
// VCF helpers
// ─────────────────────────────────────────────────────────────────

/**
 * embedVCF(buffer, watermarkRecord)
 * Inserts a ##GENOVAULT_WM meta-info line into the VCF header.
 *
 * @param {Buffer} buffer
 * @param {Object} watermarkRecord
 * @returns {{ watermarkedBuffer: Buffer }}
 */
function embedVCF(buffer, watermarkRecord) {
  // WEAK_WATERMARK: metadata-only; can be stripped by bcftools annotate
  const text  = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const tag   = `${WM_TAG_VCF}${watermarkRecord.watermarkId}`;

  // Insert after the ##fileformat= line (always first in valid VCF)
  let insertIdx = 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("##fileformat")) {
      insertIdx = i + 1;
      break;
    }
  }

  lines.splice(insertIdx, 0, tag);
  return { watermarkedBuffer: Buffer.from(lines.join("\n"), "utf8") };
}

/**
 * detectVCF(buffer, watermarkRecord)
 * Scans VCF header for the watermark meta-info line.
 *
 * @param {Buffer} buffer
 * @param {Object} watermarkRecord
 * @returns {{ verified: boolean, matchScore: number, integrity: number }}
 */
function detectVCF(buffer, watermarkRecord) {
  // WEAK_WATERMARK
  const text = buffer.toString("utf8");
  const tag  = `${WM_TAG_VCF}${watermarkRecord.watermarkId}`;

  const found = text.includes(tag);
  return {
    verified:   found,
    matchScore: found ? 1 : 0,
    integrity:  found ? 1 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * embed(buffer, fileExt, watermarkRecord)
 * Dispatches to the correct format embedder.
 *
 * @param {Buffer} buffer
 * @param {string} fileExt  – ".bam" | ".vcf"
 * @param {Object} watermarkRecord
 * @returns {{ watermarkedBuffer: Buffer }}
 */
function embed(buffer, fileExt, watermarkRecord) {
  // WEAK_WATERMARK — metadata watermark only; not cryptographically robust
  switch (fileExt.toLowerCase()) {
    case ".bam": return embedBAM(buffer, watermarkRecord);
    case ".vcf": return embedVCF(buffer, watermarkRecord);
    default:
      throw new Error(
        `metadataEmbedder: unsupported format "${fileExt}". ` +
        `Use lsbQualityEmbedder for .fastq files.`
      );
  }
}

/**
 * detectForRecord(buffer, fileExt, watermarkRecord)
 * Extracts and tests a metadata watermark from a candidate file.
 *
 * @param {Buffer} buffer
 * @param {string} fileExt
 * @param {Object} watermarkRecord
 * @returns {{ verified: boolean, matchScore: number, integrity: number }}
 */
function detectForRecord(buffer, fileExt, watermarkRecord) {
  // WEAK_WATERMARK — detection is presence-only; metadata may have been stripped
  switch (fileExt.toLowerCase()) {
    case ".bam": return detectBAM(buffer, watermarkRecord);
    case ".vcf": return detectVCF(buffer, watermarkRecord);
    default:
      throw new Error(
        `metadataEmbedder: unsupported format "${fileExt}" for detection.`
      );
  }
}

module.exports = { embed, detectForRecord };
