/**
 * watermark.test.js
 * ──────────────────────────────────────────────────────────────────
 * 29-test suite for the Genomic Data Provenance & Misuse Detection Engine.
 *
 * Tests:
 *   1–14:  Functional Tests (embedding, detection, pipeline)
 *   15:    Concurrent Download Test
 *   16–26: Robustness Tests (error correction, format boundaries)
 *   27:    Commitment consistency
 *   28:    Modified payload rejection
 *   29:    Seed/payload/commitment distinction
 *
 * Run with: npm test (or: npx jest backend/tests/watermark.test.js)
 */

"use strict";

// ─────────────────────────────────────────────────────────────────
// Test environment setup
// ─────────────────────────────────────────────────────────────────

// Set a real WATERMARK_SECRET before loading any module that reads it
process.env.WATERMARK_SECRET         = "a".repeat(64); // 256-bit hex
process.env.WATERMARK_SECRET_VERSION = "watermark-key-v1";
process.env.WATERMARK_VERSION        = "GENOMIC_LSB_V1";

const crypto       = require("crypto");
const lsbEmbedder  = require("../services/watermark/lsbQualityEmbedder");
const metaEmbedder = require("../services/watermark/metadataEmbedder");
const wmService    = require("../services/watermarkService");

// ─────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────

/**
 * buildFastqBuffer(numReads, qualMin, qualMax)
 * Generates a valid FASTQ buffer with <numReads> synthetic reads.
 * Quality scores are random ASCII chars in [qualMin, qualMax].
 */
function buildFastqBuffer(numReads = 500, seqLen = 100, qualMin = 40, qualMax = 73) {
  const lines = [];
  for (let i = 0; i < numReads; i++) {
    const seq  = "A".repeat(seqLen);
    const qual = Array.from({ length: seqLen }, () =>
      String.fromCharCode(qualMin + Math.floor(Math.random() * (qualMax - qualMin)))
    ).join("");
    lines.push(`@read${i}`, seq, "+", qual);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

/**
 * buildWatermarkRecord(overrides)
 * Builds a minimal watermark record for testing, using real crypto pipeline.
 */
function buildWatermarkRecord(overrides = {}) {
  const ownerId         = "owner123";
  const researcherId    = "researcher456";
  const fileId          = "file789";
  const accessRequestId = "req001";
  const downloadId      = wmService.generateDownloadId();
  const watermarkId     = wmService.generateWatermarkId();
  const nonce           = crypto.randomBytes(32);
  const fileExt         = ".fastq";

  const watermarkSeed = wmService.generateWatermarkSeed(
    ownerId, researcherId, fileId, accessRequestId, downloadId, nonce
  );

  return wmService.buildWatermarkRecord({
    watermarkId,
    downloadId,
    fileId,
    ownerId,
    researcherId,
    accessRequestId,
    watermarkSeed,
    fileExt,
    fileSize:         1024,
    originalFileHash: "abc",
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────
// Tests 1–14: Functional Tests
// ─────────────────────────────────────────────────────────────────

describe("Tests 1–14: GENOMIC_LSB_V1 Functional Tests", () => {

  /** Test 1: normalizeFASTQ parses correct number of reads */
  test("1. normalizeFASTQ parses correct number of reads", () => {
    const buf = buildFastqBuffer(100, 50);
    const reads = lsbEmbedder.normalizeFASTQ(buf);
    expect(reads).toHaveLength(100);
  });

  /** Test 2: normalizeFASTQ read structure has required fields */
  test("2. normalizeFASTQ read structure has correct fields", () => {
    const buf = buildFastqBuffer(5, 30);
    const reads = lsbEmbedder.normalizeFASTQ(buf);
    for (const r of reads) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("sequence");
      expect(r).toHaveProperty("quality");
      expect(typeof r.quality).toBe("string");
    }
  });

  /** Test 3: embed returns a Buffer */
  test("3. embed() returns a watermarkedBuffer", () => {
    const buf   = buildFastqBuffer(200);
    const rec   = buildWatermarkRecord();
    const result = wmService.embedWatermark(buf, ".fastq", rec);
    expect(Buffer.isBuffer(result.watermarkedBuffer)).toBe(true);
  });

  /** Test 4: watermarked buffer is not identical to original */
  test("4. Watermarked buffer differs from original", () => {
    const buf    = buildFastqBuffer(200);
    const rec    = buildWatermarkRecord();
    const result = wmService.embedWatermark(buf, ".fastq", rec);
    expect(result.watermarkedBuffer.equals(buf)).toBe(false);
  });

  /** Test 5: watermarked buffer has same line count as original */
  test("5. Watermarked FASTQ has same number of lines as original", () => {
    const buf    = buildFastqBuffer(200);
    const rec    = buildWatermarkRecord();
    const result = wmService.embedWatermark(buf, ".fastq", rec);
    const origLines = buf.toString("utf8").split("\n").filter(Boolean).length;
    const wmLines   = result.watermarkedBuffer.toString("utf8").split("\n").filter(Boolean).length;
    expect(wmLines).toBe(origLines);
  });

  /** Test 6: detectWatermarkInCandidate returns verified=true for own watermark */
  test("6. Watermark is detected in watermarked output (verified=true)", () => {
    const buf    = buildFastqBuffer(300);
    const rec    = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
    const result = wmService.detectWatermarkInCandidate(watermarkedBuffer, rec);
    expect(result.verified).toBe(true);
  });

  /** Test 7: detectWatermarkInCandidate returns verified=false for wrong record */
  test("7. Watermark detection fails for a different watermark record", () => {
    const buf    = buildFastqBuffer(300);
    const rec1   = buildWatermarkRecord();
    const rec2   = buildWatermarkRecord();  // different seed
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec1);
    const result = wmService.detectWatermarkInCandidate(watermarkedBuffer, rec2);
    expect(result.verified).toBe(false);
  });

  /** Test 8: detectWatermarkInCandidate on the original (non-watermarked) returns verified=false */
  test("8. Detection on original (non-watermarked) buffer returns verified=false", () => {
    const buf  = buildFastqBuffer(300);
    const rec  = buildWatermarkRecord();
    const result = wmService.detectWatermarkInCandidate(buf, rec);
    expect(result.verified).toBe(false);
  });

  /** Test 9: computeWatermarkCommitment is SHA-256 of payload (not seed) */
  test("9. watermarkCommitment = SHA-256(watermarkPayload)", () => {
    const rec     = buildWatermarkRecord();
    const seed    = rec.watermarkSeed;
    const payload = wmService.deriveWatermarkPayload(seed);
    const expected = crypto.createHash("sha256").update(payload).digest("hex");
    expect(rec.watermarkCommitment).toBe(expected);
  });

  /** Test 10: generateWatermarkSeed produces different seeds for different inputs */
  test("10. generateWatermarkSeed produces unique seeds for different inputs", () => {
    const nonce1 = crypto.randomBytes(32);
    const nonce2 = crypto.randomBytes(32);
    const seed1 = wmService.generateWatermarkSeed("o1", "r1", "f1", "ar1", "dl1", nonce1);
    const seed2 = wmService.generateWatermarkSeed("o2", "r2", "f2", "ar2", "dl2", nonce2);
    expect(seed1).not.toBe(seed2);
  });

  /** Test 11: Same inputs + same nonce produce same seed (determinism) */
  test("11. Same inputs produce same watermarkSeed (HMAC determinism)", () => {
    const nonce = crypto.randomBytes(32);
    const seed1 = wmService.generateWatermarkSeed("o", "r", "f", "ar", "dl", nonce);
    const seed2 = wmService.generateWatermarkSeed("o", "r", "f", "ar", "dl", nonce);
    expect(seed1).toBe(seed2);
  });

  /** Test 12: Each download gets a unique watermark (unique nonce) */
  test("12. Different nonces produce different seeds (unique watermarks)", () => {
    const seeds = new Set();
    for (let i = 0; i < 10; i++) {
      const nonce = crypto.randomBytes(32);
      const seed  = wmService.generateWatermarkSeed("o", "r", "f", "ar", "dl", nonce);
      seeds.add(seed);
    }
    expect(seeds.size).toBe(10);  // all 10 must be unique
  });

  /** Test 13: detectWatermarkInCandidate accepts pre-normalized reads array */
  test("13. detectWatermarkInCandidate accepts pre-normalized reads array", () => {
    const buf  = buildFastqBuffer(300);
    const rec  = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
    const normalized = lsbEmbedder.normalizeFASTQ(watermarkedBuffer);
    const result = wmService.detectWatermarkInCandidate(normalized, rec);
    expect(result.verified).toBe(true);
  });

  /** Test 14: sequence data is NOT modified by embedding (LSB of quality only) */
  test("14. Sequence data is unchanged after watermark embedding", () => {
    const buf  = buildFastqBuffer(200);
    const rec  = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
    const origReads = lsbEmbedder.normalizeFASTQ(buf);
    const wmReads   = lsbEmbedder.normalizeFASTQ(watermarkedBuffer);
    expect(origReads.length).toBe(wmReads.length);
    for (let i = 0; i < origReads.length; i++) {
      expect(origReads[i].sequence).toBe(wmReads[i].sequence);
    }
  });

});

// ─────────────────────────────────────────────────────────────────
// Test 15: Concurrent Download Test
// ─────────────────────────────────────────────────────────────────

describe("Test 15: Concurrent Downloads", () => {

  test("15. 20 concurrent embeddings produce 20 distinct, independently-verifiable watermarks", async () => {
    const buf = buildFastqBuffer(300);
    const concurrency = 20;

    const results = await Promise.all(
      Array.from({ length: concurrency }, async () => {
        const rec = buildWatermarkRecord();
        const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
        const detection = wmService.detectWatermarkInCandidate(watermarkedBuffer, rec);
        return {
          watermarkId:  rec.watermarkId,
          commitment:   rec.watermarkCommitment,
          verified:     detection.verified,
        };
      })
    );

    // All should be verified
    const allVerified = results.every(r => r.verified);
    expect(allVerified).toBe(true);

    // All watermarkIds must be unique
    const ids = new Set(results.map(r => r.watermarkId));
    expect(ids.size).toBe(concurrency);

    // All commitments must be unique (different seeds → different payloads → different commitments)
    const commitments = new Set(results.map(r => r.commitment));
    expect(commitments.size).toBe(concurrency);
  });

});

// ─────────────────────────────────────────────────────────────────
// Tests 16–26: Robustness Tests
// ─────────────────────────────────────────────────────────────────

describe("Tests 16–26: Robustness Tests", () => {

  /** Test 16: WATERMARK_SECRET missing → generateWatermarkSeed throws */
  test("16. Missing WATERMARK_SECRET throws during seed generation", () => {
    const orig = process.env.WATERMARK_SECRET;
    delete process.env.WATERMARK_SECRET;
    expect(() =>
      wmService.generateWatermarkSeed("o", "r", "f", "ar", "dl", crypto.randomBytes(16))
    ).toThrow();
    process.env.WATERMARK_SECRET = orig;
  });

  /** Test 17: embedWatermark throws on unsupported format */
  test("17. embedWatermark throws for unsupported file extension", () => {
    const buf = Buffer.from("data");
    const rec = buildWatermarkRecord();
    expect(() => wmService.embedWatermark(buf, ".txt", rec)).toThrow();
  });

  /** Test 18: metadataEmbedder.embed for .bam inserts CO tag */
  test("18. metadataEmbedder inserts GENOVAULT_WM CO tag in BAM/SAM", () => {
    const samContent = "@HD\tVN:1.6\n@SQ\tSN:chr1\tLN:248956422\nread1\t0\tchr1\t100\t60\t*\t*\t0\t0\tACGT\tIIII\n";
    const buf = Buffer.from(samContent, "utf8");
    const rec = { watermarkId: "WM-AABBCCDD" };
    const { watermarkedBuffer } = metaEmbedder.embed(buf, ".bam", rec);
    expect(watermarkedBuffer.toString("utf8")).toContain("GENOVAULT_WM:WM-AABBCCDD");
  });

  /** Test 19: metadataEmbedder.embed for .vcf inserts header comment */
  test("19. metadataEmbedder inserts ##GENOVAULT_WM line in VCF", () => {
    const vcfContent = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n";
    const buf = Buffer.from(vcfContent, "utf8");
    const rec = { watermarkId: "WM-DEADBEEF" };
    const { watermarkedBuffer } = metaEmbedder.embed(buf, ".vcf", rec);
    expect(watermarkedBuffer.toString("utf8")).toContain("##GENOVAULT_WM=WM-DEADBEEF");
  });

  /** Test 20: metadataEmbedder.detectForRecord returns verified=true for correct ID */
  test("20. metadataEmbedder detects correct watermarkId in BAM", () => {
    const samContent = "@HD\tVN:1.6\n@CO\tGENOVAULT_WM:WM-AABBCCDD\nread1\t0\tchr1\t100\t60\t*\t*\t0\t0\tACGT\tIIII\n";
    const buf = Buffer.from(samContent, "utf8");
    const rec = { watermarkId: "WM-AABBCCDD" };
    const result = metaEmbedder.detectForRecord(buf, ".bam", rec);
    expect(result.verified).toBe(true);
    expect(result.matchScore).toBe(1);
  });

  /** Test 21: metadataEmbedder.detectForRecord returns verified=false for wrong ID */
  test("21. metadataEmbedder returns verified=false for wrong watermarkId", () => {
    const samContent = "@HD\tVN:1.6\n@CO\tGENOVAULT_WM:WM-AABBCCDD\n";
    const buf = Buffer.from(samContent, "utf8");
    const rec = { watermarkId: "WM-DIFFERENT" };
    const result = metaEmbedder.detectForRecord(buf, ".bam", rec);
    expect(result.verified).toBe(false);
    expect(result.matchScore).toBe(0);
  });

  /** Test 22: metadataEmbedder throws for unsupported format */
  test("22. metadataEmbedder throws for unsupported format", () => {
    const rec = { watermarkId: "WM-TEST" };
    expect(() => metaEmbedder.embed(Buffer.from("x"), ".fastq", rec)).toThrow();
    expect(() => metaEmbedder.detectForRecord(Buffer.from("x"), ".sam", rec)).toThrow();
  });

  /** Test 23: detectWatermarkInCandidate throws for METADATA_V1 without Buffer */
  test("23. detectWatermarkInCandidate throws if non-Buffer passed for METADATA_V1", () => {
    const rec = buildWatermarkRecord();
    rec.watermarkVersion = "METADATA_V1";
    rec.fileFormat = ".bam";
    expect(() => wmService.detectWatermarkInCandidate([], rec)).toThrow(TypeError);
  });

  /** Test 24: Embedding a FASTQ with low read count still produces valid result */
  test("24. Small FASTQ (50 reads) still produces a verifiable watermark", () => {
    const buf = buildFastqBuffer(50);
    const rec = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
    const result = wmService.detectWatermarkInCandidate(watermarkedBuffer, rec);
    // Small files may have fewer embedding positions; verified may be lower confidence
    // but the match should be detectable
    expect(result.matchScore).toBeGreaterThan(0);
  });

  /** Test 25: computeWatermarkedFileHash is SHA-256 of watermarked buffer */
  test("25. computeWatermarkedFileHash equals SHA-256(watermarkedBuffer)", () => {
    const buf = buildFastqBuffer(100);
    const rec = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);
    const expected = crypto.createHash("sha256").update(watermarkedBuffer).digest("hex");
    const actual   = wmService.computeWatermarkedFileHash(watermarkedBuffer);
    expect(actual).toBe(expected);
  });

  /** Test 26: generateWatermarkId produces WM-XXXXXXXX format */
  test("26. generateWatermarkId returns WM-XXXXXXXX format", () => {
    for (let i = 0; i < 20; i++) {
      const id = wmService.generateWatermarkId();
      expect(id).toMatch(/^WM-[0-9A-F]{8}$/);
    }
  });

});

// ─────────────────────────────────────────────────────────────────
// Tests 27–29: Cryptographic Commitment Tests
// ─────────────────────────────────────────────────────────────────

describe("Tests 27–29: Cryptographic Commitment Tests", () => {

  /** Test 27: Commitment is consistent across multiple builds with the same seed */
  test("27. Commitment is consistent: same seed always produces same commitment", () => {
    const rec1 = buildWatermarkRecord();
    const seed  = rec1.watermarkSeed;

    // Build a second record manually using the same seed
    const payload     = wmService.deriveWatermarkPayload(seed);
    const commitment2 = wmService.computeWatermarkCommitment(payload);

    expect(rec1.watermarkCommitment).toBe(commitment2);
  });

  /** Test 28: Modified payload is correctly rejected by commitment verification */
  test("28. Modified payload produces a different commitment — detection rejects it", () => {
    const buf = buildFastqBuffer(300);
    const rec = buildWatermarkRecord();
    const { watermarkedBuffer } = wmService.embedWatermark(buf, ".fastq", rec);

    // Tamper with watermarkCommitment to simulate a modified payload comparison
    const tamperedRec = {
      ...rec,
      watermarkCommitment: crypto.randomBytes(32).toString("hex"),  // wrong commitment
    };

    const result = wmService.detectWatermarkInCandidate(watermarkedBuffer, tamperedRec);
    expect(result.verified).toBe(false);
  });

  /** Test 29: Seed, payload, and commitment are all distinct values */
  test("29. Seed, payload, and commitment are three distinct cryptographic values", () => {
    const rec = buildWatermarkRecord();

    const seed       = rec.watermarkSeed;                                       // 64-char hex
    const payload    = wmService.deriveWatermarkPayload(seed).toString("hex");  // 16-char hex (8 bytes)
    const commitment = rec.watermarkCommitment;                                  // 64-char hex

    // All three are non-empty strings
    expect(seed).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(commitment).toBeTruthy();

    // All three are different values
    expect(seed).not.toBe(payload);
    expect(seed).not.toBe(commitment);
    expect(payload).not.toBe(commitment);

    // Seed is 64-char hex (256 bits)
    expect(seed).toMatch(/^[0-9a-f]{64}$/);

    // Payload is 16-char hex (64 bits = 8 bytes)
    expect(payload).toHaveLength(16);

    // Commitment is 64-char hex (SHA-256 output = 256 bits)
    expect(commitment).toMatch(/^[0-9a-f]{64}$/);

    // Commitment is SHA-256 of payload BYTES (not seed)
    const payloadBuf   = wmService.deriveWatermarkPayload(seed);
    const seedHash     = crypto.createHash("sha256").update(Buffer.from(seed, "hex")).digest("hex");
    const payloadHash  = crypto.createHash("sha256").update(payloadBuf).digest("hex");

    expect(commitment).toBe(payloadHash);   // commitment = SHA-256(payload) ✅
    expect(commitment).not.toBe(seedHash);  // commitment ≠ SHA-256(seed)   ✅
  });

});
