/**
 * blockchainBenchmark.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8/12 — Blockchain transaction latency benchmark.
 *
 * Measures end-to-end latency (ms) for:
 *   1. registerFile()  — submitting a file hash to the smart contract
 *   2. verifyFileHashOnChain() — reading a registered hash back
 *
 * Policy:
 *   - N_RUNS ≥ 3 per operation (reviewer requirement — no fabricated numbers)
 *   - Uses a synthetic SHA-256 hash (not real patient data)
 *   - Writes timing results to results/phase4_blockchain/blockchain_latency.json
 *   - Reports mean, median, SD, min, max per operation
 *
 * Usage:
 *   node backend/experiments/blockchainBenchmark.js
 *
 * Requirements:
 *   - PRIVATE_KEY, BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CONTRACT_ADDRESS in .env
 *   - Network: Ethereum Sepolia (chainId 11155111)
 *
 * IMPORTANT: This script submits REAL transactions to Sepolia testnet.
 * Each registerFile() call costs Sepolia test ETH (free from faucets).
 * Run only when a funded Sepolia wallet is configured.
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto   = require("crypto");
const { registerFile, verifyFileHashOnChain, isBlockchainConfigured } =
  require("../services/blockchainService");
const { BENCHMARK, writeResult, computeStats } = require("./experimentManifest");

const N = BENCHMARK.N_RUNS;

// ─── Utility ──────────────────────────────────────────────────────────────────
function syntheticHash() {
  // A random 32-byte hash — used as a fake file hash for benchmarking only.
  // This is NOT anchored to any real genomic file.
  return crypto.randomBytes(32).toString("hex");
}

async function timedCall(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  const ms = Date.now() - t0;
  console.log(`  [${label}] ${ms} ms`);
  return { ms, result };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault Blockchain Latency Benchmark ===");
  console.log(`  N_RUNS = ${N} (reviewer requirement: ≥3)`);
  console.log(`  Network: Ethereum Sepolia (chainId 11155111)`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log();

  if (!isBlockchainConfigured()) {
    console.error("ERROR: Blockchain not configured. Set PRIVATE_KEY, BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CONTRACT_ADDRESS in .env");
    process.exit(1);
  }

  // ── Register File (write) ────────────────────────────────────────────────
  console.log(`--- registerFile() — N=${N} runs ---`);
  const registerMs  = [];
  const registeredHashes = [];

  for (let i = 0; i < N; i++) {
    const fakeHash    = syntheticHash();
    const fakeFileId  = `BENCH-${i + 1}`;
    const fakeOwnerOrcidHash = syntheticHash();
    console.log(`  Run ${i + 1}/${N}: hash=${fakeHash.slice(0, 16)}...`);

    const { ms } = await timedCall(`registerFile run ${i + 1}`, () =>
      registerFile(fakeFileId, fakeHash, fakeOwnerOrcidHash)
    );
    registerMs.push(ms);
    registeredHashes.push(fakeHash);

    // Brief pause between write transactions to avoid nonce conflicts
    await new Promise(r => setTimeout(r, 3000));
  }

  const registerStats = computeStats(registerMs);
  console.log("\n  registerFile() stats:", registerStats);

  // ── Verify File Hash (read) ──────────────────────────────────────────────
  console.log(`\n--- verifyFileHashOnChain() — N=${N} runs ---`);
  const verifyMs = [];

  for (let i = 0; i < N; i++) {
    const hash = registeredHashes[i];
    console.log(`  Run ${i + 1}/${N}: hash=${hash.slice(0, 16)}...`);

    const { ms } = await timedCall(`verifyFileHashOnChain run ${i + 1}`, () =>
      verifyFileHashOnChain(hash)
    );
    verifyMs.push(ms);
  }

  const verifyStats = computeStats(verifyMs);
  console.log("\n  verifyFileHashOnChain() stats:", verifyStats);

  // ── Write results ────────────────────────────────────────────────────────
  const output = {
    experiment:    "blockchain_latency",
    runAt:         new Date().toISOString(),
    network:       "Ethereum Sepolia",
    chainId:       11155111,
    contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS,
    nRuns:         N,
    registerFile:  { timingsMs: registerMs, stats: registerStats },
    verifyHash:    { timingsMs: verifyMs,   stats: verifyStats   },
    notes: [
      "Timings include full network round-trip to Sepolia RPC endpoint.",
      "registerFile() waits for transaction receipt (1 block confirmation).",
      "verifyFileHashOnChain() is a read call (eth_call) — no mining wait.",
      "Synthetic hashes used — no real patient data submitted.",
    ],
  };

  writeResult("blockchain", output);
  console.log("\n=== Blockchain benchmark complete ===");
}

main().catch(err => {
  console.error("Blockchain benchmark FAILED:", err.message);
  process.exit(1);
});
