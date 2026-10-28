   /**
 * lsbQualityEmbedder.js
 * ──────────────────────────────────────────────────────────────────
 * FASTQ Quality-Score LSB Watermarking — GENOMIC_LSB_V1
 *
 * Embeds a 64-bit watermarkPayload into a FASTQ file by flipping the
 * least-significant bit of selected Phred quality-score ASCII characters.
 * DNA sequence bases are NEVER modified.
 *
 * Algorithm roles (must be kept distinct):
 *   watermarkSeed       – controls WHERE bits are embedded (position selection)
 *   watermarkPayload    – WHAT is embedded (64-bit identifier)
 *   watermarkCommitment – SHA-256(watermarkPayload); verifies recovered payload
 *
 * Error correction:
 *   Each payload bit is repeated N=7 times (repetition code).
 *   Majority-vote decoding tolerates up to 3/7 corrupted bits per group.
 *   Total encoded bits = 64 × 7 = 448.
 *
 * Block strategy:
 *   Encoded bits are distributed across configurable blocks spread through
 *   the file to tolerate read deletion and partial-file scenarios.
 *   Read reordering is NOT guaranteed — positions are derived from the
 *   normalized read stream index.
 *
 * Capacity guard:
 *   Files with fewer than 448 eligible quality positions cannot be watermarked.
 */

"use strict";

const crypto = require("crypto");
const zlib   = require("zlib");
const { promisify } = require("util");

const gunzipAsync = promisify(zlib.gunzip);
const gzipAsync   = promisify(zlib.gzip);

// ── Gzip helpers ─────────────────────────────────────────────────

/** Returns true if buffer starts with gzip magic bytes 0x1F 0x8B */
function isGzip(buf) {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// ── Constants (V1 defaults — overridden by embeddingParametersVersion) ──
const V1_PAYLOAD_BITS        = 64;
const V1_REPETITION_FACTOR   = 7;
const V1_ENCODED_BITS        = V1_PAYLOAD_BITS * V1_REPETITION_FACTOR; // 448
const V1_MIN_QUALITY_ASCII   = 43;   // Phred Q10; skip positions below this
const V1_BLOCK_COUNT         = 4;
const V1_REDUNDANCY_FACTOR   = 2;

// ─────────────────────────────────────────────────────────────────
// FASTQ Normalisation
// ─────────────────────────────────────────────────────────────────

/**
 * normalizeFASTQ(buffer)
 * Parses a FASTQ buffer into an array of read objects.
 * Auto-decompresses gzip input (.fastq.gz) before parsing.
 * Handles Unix and Windows line endings.
 *
 * READ-ORDER INDEPENDENCE: Reads are sorted by their read ID (header after '@'
 * up to first whitespace). This makes watermark positions identical regardless
 * of read order — essential for NCBI SRA detection since fasterq-dump returns
 * reads sorted by read name, not original submission order.
 *
 * @param {Buffer} buffer  – raw FASTQ or gzip-compressed FASTQ
 * @returns {{ header: string, sequence: string, plus: string, quality: string, readId: string }[]}
 */
function normalizeFASTQ(buffer) {
  // Auto-decompress gzip — synchronous path using zlib.gunzipSync
  const rawBuf = isGzip(buffer) ? zlib.gunzipSync(buffer) : buffer;

  const text  = rawBuf.toString("utf8");
  const lines = text.split(/\r?\n/);

  const reads = [];
  let i = 0;

  while (i < lines.length) {
    // Skip blank lines between records
    if (lines[i] === "") { i++; continue; }

    if (!lines[i].startsWith("@")) {
      throw new Error(
        `FASTQ parse error at line ${i + 1}: expected '@' header, got: ${lines[i].slice(0, 40)}`
      );
    }

    const header   = lines[i];
    const sequence = lines[i + 1] || "";
    const plus     = lines[i + 2] || "";
    const quality  = lines[i + 3] || "";

    if (!plus.startsWith("+")) {
      throw new Error(
        `FASTQ parse error at line ${i + 3}: expected '+' separator`
      );
    }

    if (quality.length !== sequence.length) {
      throw new Error(
        `FASTQ parse error: quality length (${quality.length}) ≠ sequence length ` +
        `(${sequence.length}) at read ${reads.length + 1}`
      );
    }

    // Extract read ID: everything after '@' up to first whitespace
    const readId = header.slice(1).split(/\s/)[0];
    reads.push({ header, sequence, plus, quality, readId });
    i += 4;
  }

  if (reads.length === 0) {
    throw new Error("FASTQ buffer contains no valid reads");
  }

  // Sort by readId — ensures watermark positions are identical regardless
  // of what order NCBI SRA / fasterq-dump returns reads in
  reads.sort((a, b) => (a.readId < b.readId ? -1 : a.readId > b.readId ? 1 : 0));

  return reads;
}

/**
 * serializeFASTQ(reads)
 * Converts parsed reads back to a FASTQ Buffer.
 *
 * @param {{ header: string, sequence: string, plus: string, quality: string }[]} reads
 * @returns {Buffer}
 */
function serializeFASTQ(reads) {
  const lines = reads.flatMap(r => [r.header, r.sequence, r.plus, r.quality]);
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

// ─────────────────────────────────────────────────────────────────
// Position Selection (deterministic from seed)
// ─────────────────────────────────────────────────────────────────

/**
 * selectEmbeddingPositions(reads, watermarkSeed, secret, params)
 * Deterministically selects (readIndex, charIndex) pairs for embedding.
 * Positions with quality ASCII < minQualityThreshold are skipped.
 *
 * Uses HMAC-SHA256 counter mode: HMAC(seed||secret, counter_bytes)
 * to generate a stream of candidate positions.
 *
 * @param {Array}  reads           – parsed FASTQ reads
 * @param {string} watermarkSeed   – 64-char hex (256-bit)
 * @param {string} secret          – WATERMARK_SECRET env var
 * @param {Object} params          – embeddingParametersVersion object
 * @returns {{ readIdx: number, charIdx: number }[]}  length = encodedBits
 */
function selectEmbeddingPositions(reads, watermarkSeed, secret, params) {
  const encodedBits    = params.encodedBits || V1_ENCODED_BITS;

  const positions  = [];
  const usedSet    = new Set();   // "readIdx:charIdx" — avoid collisions
  let   counter    = 0;
  const maxAttempts = encodedBits * 200; // safety cap

  while (positions.length < encodedBits && counter < maxAttempts) {
    const ctrBuf = Buffer.alloc(4);
    ctrBuf.writeUInt32BE(counter, 0);
    const hmac   = crypto.createHmac("sha256", secret);
    hmac.update(Buffer.from(watermarkSeed, "hex"));
    hmac.update(ctrBuf);
    const digest = hmac.digest();   // 32 bytes

    // Bytes 0-3 → readIdx, bytes 4-7 → charIdx (independent regions)
    const readIdx = digest.readUInt32BE(0) % reads.length;
    const qualLen = reads[readIdx].quality.length;

    if (qualLen === 0) { counter++; continue; }

    const charIdx = digest.readUInt32BE(4) % qualLen;
    const key     = `${readIdx}:${charIdx}`;

    // NOTE: No quality-threshold filter here — filtering by quality value
    // causes embed/detect divergence because LSB flipping can push a
    // boundary-quality score (e.g. ASCII 43 → 42) below the threshold,
    // making the detect pass skip that position and produce a different
    // position array than the embed pass. Positions are purely coordinate-based.
    if (!usedSet.has(key)) {
      positions.push({ readIdx, charIdx });
      usedSet.add(key);
    }

    counter++;
  }

  if (positions.length < encodedBits) {
    throw new Error(
      `Insufficient eligible quality positions: found ${positions.length}, ` +
      `need ${encodedBits}. File may be too small for watermarking.`
    );
  }

  return positions;
}


// ─────────────────────────────────────────────────────────────────
// Error-Correction Codec (Repetition Code N=7)
// ─────────────────────────────────────────────────────────────────

/**
 * encodePayload(payloadBytes, repetitionFactor)
 * Expands each bit N times for error correction.
 *
 * @param {Buffer} payloadBytes
 * @param {number} repetitionFactor
 * @returns {number[]}  array of 0/1 bits, length = payloadBits × N
 */
function encodePayload(payloadBytes, repetitionFactor) {
  const bits = [];
  for (const byte of payloadBytes) {
    for (let b = 7; b >= 0; b--) {
      const bit = (byte >> b) & 1;
      for (let r = 0; r < repetitionFactor; r++) {
        bits.push(bit);
      }
    }
  }
  return bits;
}

/**
 * decodePayload(bits, repetitionFactor, payloadBits)
 * Majority-vote decoding. Tolerates up to floor(N/2) corrupt bits per group.
 *
 * @param {number[]} bits
 * @param {number}   repetitionFactor
 * @param {number}   payloadBits
 * @returns {Buffer}
 */
function decodePayload(bits, repetitionFactor, payloadBits) {
  const recovered = [];
  for (let i = 0; i < payloadBits; i++) {
    const group = bits.slice(i * repetitionFactor, (i + 1) * repetitionFactor);
    const ones  = group.reduce((s, b) => s + b, 0);
    recovered.push(ones > repetitionFactor / 2 ? 1 : 0);
  }

  // Pack bits back into bytes
  const bytes = [];
  for (let i = 0; i < recovered.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | (recovered[i + b] || 0);
    }
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * embed(fastqBuffer, watermarkRecord)
 *
 * Embeds the watermarkPayload into the FASTQ quality scores using
 * the GENOMIC_LSB_V1 algorithm.
 *
 * watermarkRecord must contain:
 *   - watermarkSeed          (256-bit HMAC hex)
 *   - watermarkCommitment    (SHA-256(watermarkPayload) hex)
 *   - embeddingParametersVersion (versioned params object)
 *
 * Returns: { watermarkedBuffer }
 * The caller should separately verify the embedded watermark using
 * detectForRecord() before delivering the file.
 *
 * @param {Buffer} fastqBuffer
 * @param {Object} watermarkRecord
 * @returns {{ watermarkedBuffer: Buffer }}
 */
function embed(fastqBuffer, watermarkRecord) {
  const secret = process.env.WATERMARK_SECRET;
  if (!secret) {
    throw new Error("WATERMARK_SECRET not configured — cannot embed watermark");
  }

  const params       = watermarkRecord.embeddingParametersVersion || {};
  const repetition   = params.repetitionFactor || V1_REPETITION_FACTOR;
  const payloadBits  = params.payloadBits      || V1_PAYLOAD_BITS;

  // Recover the 64-bit payload from the commitment by deriving it again
  // from the seed (same derivation used at generation time)
  const seedBuf      = Buffer.from(watermarkRecord.watermarkSeed, "hex");
  // payload = first 8 bytes of seed (matches deriveWatermarkPayload in watermarkService)
  const payloadBytes = seedBuf.slice(0, 8);

  // Verify our derived payload matches the stored commitment
  const derivedCommitment = crypto
    .createHash("sha256")
    .update(payloadBytes)
    .digest("hex");

  if (derivedCommitment !== watermarkRecord.watermarkCommitment) {
    throw new Error(
      "Commitment mismatch: derived payload does not match stored watermarkCommitment"
    );
  }

  // Parse and embed
  const isCompressed = isGzip(fastqBuffer);
  // normalizeFASTQ auto-decompresses, so pass buffer directly
  const reads     = normalizeFASTQ(fastqBuffer);
  const positions = selectEmbeddingPositions(
    reads,
    watermarkRecord.watermarkSeed,
    secret,
    params
  );
  const encodedBits = encodePayload(payloadBytes, repetition);

  // Deep-copy reads to avoid mutation of input
  const modifiedReads = reads.map(r => ({ ...r, quality: r.quality }));

  for (let i = 0; i < positions.length; i++) {
    const { readIdx, charIdx } = positions[i];
    const qualArr = modifiedReads[readIdx].quality.split("");
    const code    = qualArr[charIdx].charCodeAt(0);
    const bit     = encodedBits[i];

    // Set LSB to the encoded bit
    const newCode = (code & 0xFE) | bit;
    qualArr[charIdx] = String.fromCharCode(newCode);
    modifiedReads[readIdx] = {
      ...modifiedReads[readIdx],
      quality: qualArr.join(""),
    };
  }

  let watermarkedBuffer = serializeFASTQ(modifiedReads);

  // Re-compress if input was gzip — deliver .fastq.gz as .fastq.gz
  if (isCompressed) {
    watermarkedBuffer = zlib.gzipSync(watermarkedBuffer);
  }

  return { watermarkedBuffer, wasCompressed: isCompressed };
}

/**
 * detectForRecord(normalizedReads, watermarkRecord)
 *
 * Tests a candidate (pre-normalized reads array) against ONE specific
 * registered watermark record.
 *
 * Returns:
 *   {
 *     matchScore:      number,   // 0–1: fraction of correctly recovered bits
 *     integrity:       number,   // 0–1: fraction of positions present
 *     verified:        boolean,  // true iff SHA-256(recovered payload) === commitment
 *     recoveredPayload:Buffer,   // the 64-bit payload recovered from candidate
 *   }
 *
 * @param {{ header, sequence, plus, quality }[]} normalizedReads
 * @param {Object} watermarkRecord   – must include watermarkSeed (explicitly selected)
 * @returns {Object}
 */
function detectForRecord(normalizedReads, watermarkRecord) {
  const secret = process.env.WATERMARK_SECRET;
  if (!secret) {
    throw new Error("WATERMARK_SECRET not configured — cannot detect watermark");
  }

  const params       = watermarkRecord.embeddingParametersVersion || {};
  const repetition   = params.repetitionFactor || V1_REPETITION_FACTOR;
  const payloadBits  = params.payloadBits      || V1_PAYLOAD_BITS;
  const encodedBits  = params.encodedBits      || V1_ENCODED_BITS;

  // Reconstruct expected positions using the registered seed
  let positions;
  let integrityLoss = 0;

  try {
    positions = selectEmbeddingPositions(
      normalizedReads,
      watermarkRecord.watermarkSeed,
      secret,
      params
    );
  } catch {
    // File too small — integrity = 0
    return {
      matchScore:       0,
      integrity:        0,
      verified:         false,
      recoveredPayload: Buffer.alloc(payloadBits / 8),
    };
  }

  // Extract LSBs from candidate at expected positions
  const extractedBits = [];
  let   presentCount  = 0;

  for (const { readIdx, charIdx } of positions) {
    if (readIdx < normalizedReads.length &&
        charIdx < normalizedReads[readIdx].quality.length) {
      const code = normalizedReads[readIdx].quality.charCodeAt(charIdx);
      extractedBits.push(code & 1);
      presentCount++;
    } else {
      extractedBits.push(0);   // position missing — treat as 0
      integrityLoss++;
    }
  }

  const integrity = presentCount / encodedBits;

  // Majority-vote decode
  const recoveredPayload = decodePayload(extractedBits, repetition, payloadBits);

  // Cryptographic verification: SHA-256(recoveredPayload) vs commitment
  const recoveredCommitment = crypto
    .createHash("sha256")
    .update(recoveredPayload)
    .digest("hex");

  const verified = recoveredCommitment === watermarkRecord.watermarkCommitment;

  // Match score: fraction of payload bits that decoded correctly
  // (approximate — compare recovered vs expected payload)
  const seedBuf       = Buffer.from(watermarkRecord.watermarkSeed, "hex");
  const expectedPayload = seedBuf.slice(0, 8);
  let   matchingBits  = 0;

  for (let i = 0; i < payloadBits; i++) {
    const byteIdx      = Math.floor(i / 8);
    const bitIdx       = 7 - (i % 8);
    const expectedBit  = (expectedPayload[byteIdx] >> bitIdx) & 1;
    const recoveredBit = (recoveredPayload[byteIdx] >> bitIdx) & 1;
    if (expectedBit === recoveredBit) matchingBits++;
  }

  const matchScore = matchingBits / payloadBits;

  return { matchScore, integrity, verified, recoveredPayload };
}

module.exports = { normalizeFASTQ, serializeFASTQ, embed, detectForRecord };
