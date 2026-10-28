"use strict";
/**
 * downloadBenchmark.js  — Phase 8/12
 * AES-256-CBC (V1) vs AES-256-CBC + HMAC-SHA256 (V2) latency across 3 file sizes.
 * N_RUNS >= 3. All data synthetic. No external services required.
 * Usage:  node backend/experiments/downloadBenchmark.js
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto = require("crypto");
const { encryptBuffer, decryptBuffer, encryptBufferV2, decryptBufferV2 } =
  require("../services/encryptionService");
const { BENCHMARK, writeResult, computeStats } = require("./experimentManifest");

const N     = BENCHMARK.N_RUNS;
const SIZES = BENCHMARK.SYNTHETIC_FILE_SIZES_BYTES;

// ── V1: AES-256-CBC only ───────────────────────────────────────────────────────
function benchmarkV1(plaintext) {
  const encMs = [], decMs = [];
  for (let i = 0; i < N; i++) {
    const keyHex = crypto.randomBytes(32).toString("hex");
    const ivHex  = crypto.randomBytes(16).toString("hex");

    let t = process.hrtime.bigint();
    const ct = encryptBuffer(plaintext, keyHex, ivHex);
    encMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(3));

    t = process.hrtime.bigint();
    decryptBuffer(ct, keyHex, ivHex);
    decMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(3));

    console.log(`    V1 run ${i+1}: enc=${encMs[i]} ms  dec=${decMs[i]} ms`);
  }
  return { encrypt: computeStats(encMs), decrypt: computeStats(decMs) };
}

// ── V2: AES-256-CBC + HMAC-SHA256 ─────────────────────────────────────────────
function benchmarkV2(plaintext) {
  const encMs = [], decMs = [];
  for (let i = 0; i < N; i++) {
    const keyHex = crypto.randomBytes(32).toString("hex");
    const ivHex  = crypto.randomBytes(16).toString("hex");

    let t = process.hrtime.bigint();
    const v2 = encryptBufferV2(plaintext, keyHex, ivHex); // { ciphertext, mac }
    encMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(3));

    t = process.hrtime.bigint();
    decryptBufferV2(v2.ciphertext, keyHex, ivHex, v2.mac);
    decMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(3));

    console.log(`    V2 run ${i+1}: enc=${encMs[i]} ms  dec=${decMs[i]} ms`);
  }
  return { encrypt: computeStats(encMs), decrypt: computeStats(decMs) };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault Download Pipeline Latency Benchmark ===");
  console.log(`  N_RUNS=${N}  Sizes=${SIZES.map(s=>`${(s/1024).toFixed(0)}KB`).join(", ")}`);
  console.log(`  ${new Date().toISOString()}\n`);

  const out = {
    experiment: "download_pipeline_latency",
    runAt: new Date().toISOString(),
    nRuns: N,
    stages: {},
    notes: [
      "Plaintexts are randomly generated — no real genomic data.",
      "V1 = AES-256-CBC. V2 = AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC).",
      "Timings use process.hrtime.bigint() (ns resolution).",
      "Each run: fresh random key + IV.",
    ],
  };

  for (const size of SIZES) {
    const label   = `${(size/1024).toFixed(0)}KB`;
    const plain   = crypto.randomBytes(size);
    console.log(`--- ${label} ---`);

    console.log("  V1:");
    const v1 = benchmarkV1(plain);
    console.log("  V2:");
    const v2 = benchmarkV2(plain);

    const oe = +(v2.encrypt.mean - v1.encrypt.mean).toFixed(3);
    const od = +(v2.decrypt.mean - v1.decrypt.mean).toFixed(3);
    console.log(`  Overhead: enc +${oe} ms  dec +${od} ms\n`);

    out.stages[label] = {
      fileSizeBytes: size,
      v1, v2,
      overhead: { encryptMs: oe, decryptMs: od, acceptableUnder10ms: Math.abs(oe) < 10 },
    };
  }

  writeResult("download", out);
  console.log("=== Download benchmark complete ===");
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
