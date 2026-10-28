/**
 * blockchainBenchmarkLocal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Blockchain benchmark — LOCAL / NO-CREDENTIAL mode.
 *
 * Problem: blockchainBenchmark.js requires PRIVATE_KEY + live Sepolia RPC.
 * This companion script measures all LOCALLY MEASURABLE parts of the
 * blockchain pipeline WITHOUT submitting any real transaction:
 *
 *   1. Transaction construction latency
 *      – ABI encoding of registerFile(), requestAccess(), etc.
 *      – Gas estimation (eth_estimateGas via static call, no signing)
 *
 *   2. Payload preparation latency
 *      – SHA-256 hashing (file hash before submission)
 *      – HMAC identity hashing (owner ORCID hash)
 *      – nonce generation (per-download nonce)
 *
 *   3. Signing latency (offline — no network required)
 *      – ethers.Wallet.signTransaction() using a disposable random key
 *
 * If PRIVATE_KEY + BLOCKCHAIN_RPC_URL are configured, also runs:
 *   4. Live Sepolia read latency (verifyFileHashOnChain — eth_call, free)
 *
 * What this does NOT measure (requires live funded testnet):
 *   - registerFile() transaction mining latency
 *   - Gas used (from real receipt)
 *   - Actual on-chain confirmation time
 *
 * Usage:
 *   node backend/experiments/blockchainBenchmarkLocal.js
 *
 * Writes: results/phase4_blockchain/blockchain_local_latency.json
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const crypto  = require("crypto");
const path    = require("path");
const fs      = require("fs");
const { BENCHMARK, computeStats } = require("./experimentManifest");

let ethers;
try { ethers = require("ethers"); } catch (e) {
  console.error("ethers not available:", e.message);
  process.exit(1);
}

const N     = Math.max(BENCHMARK.N_RUNS, 5);
const SIZES = BENCHMARK.SYNTHETIC_FILE_SIZES_BYTES;

// ─── ABI fragment matching GenoVault contract ──────────────────────────────
const REGISTER_ABI = [
  "function registerFile(string fileId, string fileHash, string ownerOrcidHash) external",
  "function verifyFileHash(string fileId, string fileHash) external view returns (bool)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function syntheticHash() { return crypto.randomBytes(32).toString("hex"); }

// Compute stats with unit tag
function stats(arr, unit = "ms") { return computeStats(arr, unit); }

// ─── 1. Payload preparation timing ───────────────────────────────────────────
async function benchPayloadPrep() {
  console.log(`\n--- Payload preparation (N=${N}) ---`);
  const hashMs  = [];
  const hmacMs  = [];
  const nonceMs = [];

  for (let i = 0; i < N; i++) {
    const syntheticFile = crypto.randomBytes(SIZES[2]); // 1 MB buffer

    // SHA-256 file hash
    let t = process.hrtime.bigint();
    const fileHash = crypto.createHash("sha256").update(syntheticFile).digest("hex");
    hashMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));

    // HMAC-SHA256 owner identity hash (simulates researcherIdentityService)
    t = process.hrtime.bigint();
    const ownerOrcidHash = crypto
      .createHmac("sha256", process.env.RESEARCHER_ID_HMAC_SECRET || "bench-secret")
      .update("0000-0001-2345-6789")  // synthetic ORCID
      .digest("hex");
    hmacMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));

    // Nonce generation
    t = process.hrtime.bigint();
    const nonce = crypto.randomBytes(16).toString("hex");
    nonceMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));

    console.log(`  Run ${i+1}: SHA256=${hashMs[i]} ms  HMAC=${hmacMs[i]} ms  nonce=${nonceMs[i]} ms`);
  }

  return {
    sha256FilePrepMs: stats(hashMs),
    hmacOwnerHashMs:  stats(hmacMs),
    nonceGenMs:       stats(nonceMs),
  };
}

// ─── 2. ABI encoding timing ────────────────────────────────────────────────
async function benchABIEncoding() {
  console.log(`\n--- ABI encoding (N=${N}) ---`);
  const encodeMs = [];
  const iface    = new ethers.Interface(REGISTER_ABI);

  for (let i = 0; i < N; i++) {
    const fileId         = `FILE-BENCH-${i}`;
    const fileHash       = syntheticHash();
    const ownerOrcidHash = syntheticHash();

    const t = process.hrtime.bigint();
    const encoded = iface.encodeFunctionData("registerFile", [fileId, fileHash, ownerOrcidHash]);
    encodeMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));
    console.log(`  Run ${i+1}: ABI encode=${encodeMs[i]} ms  bytes=${encoded.length / 2 - 1}`);
  }

  return { abiEncodeMs: stats(encodeMs) };
}

// ─── 3. Offline signing timing ────────────────────────────────────────────────
async function benchOfflineSigning() {
  console.log(`\n--- Offline signing (N=${N}, disposable random wallet) ---`);
  const signMs = [];
  const iface  = new ethers.Interface(REGISTER_ABI);

  for (let i = 0; i < N; i++) {
    // Disposable wallet — NOT the real PRIVATE_KEY
    const wallet = new ethers.Wallet(ethers.hexlify(crypto.randomBytes(32)));

    const txData = {
      to:       ethers.hexlify(crypto.randomBytes(20)),
      data:     iface.encodeFunctionData("registerFile", [
        `FILE-${i}`, syntheticHash(), syntheticHash(),
      ]),
      nonce:    i,
      gasLimit: 150000n,
      gasPrice: ethers.parseUnits("20", "gwei"),
      chainId:  11155111n,  // Sepolia
      value:    0n,
    };

    const t = process.hrtime.bigint();
    const signed = await wallet.signTransaction(txData);
    signMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));
    console.log(`  Run ${i+1}: sign=${signMs[i]} ms  signedLen=${signed.length}`);
  }

  return { offlineSignMs: stats(signMs) };
}

// ─── 4. Live Sepolia read (eth_call) — optional ────────────────────────────
async function benchSepoliaRead() {
  const rpcUrl     = process.env.BLOCKCHAIN_RPC_URL;
  const contractAddr = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;

  if (!rpcUrl || !contractAddr) {
    console.log("\n--- Sepolia read latency: SKIPPED (BLOCKCHAIN_RPC_URL or CONTRACT_ADDRESS not set) ---");
    return { status: "SKIPPED", reason: "BLOCKCHAIN_RPC_URL or BLOCKCHAIN_CONTRACT_ADDRESS not configured" };
  }

  console.log(`\n--- Sepolia eth_call latency (N=${N}) ---`);
  const iface    = new ethers.Interface(REGISTER_ABI);
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
  } catch (e) {
    return { status: "SKIPPED", reason: `Provider init failed: ${e.message}` };
  }

  const readMs = [];
  for (let i = 0; i < N; i++) {
    const fakeHash = syntheticHash();
    try {
      const t = process.hrtime.bigint();
      // eth_call for view function — no gas cost, no wallet needed
      await provider.call({
        to:   contractAddr,
        data: iface.encodeFunctionData("verifyFileHash", [`FILE-BENCH-${i}`, fakeHash]),
      });
      readMs.push(+(Number(process.hrtime.bigint() - t) / 1e6).toFixed(4));
      console.log(`  Run ${i+1}: eth_call=${readMs[i]} ms`);
    } catch (e) {
      console.warn(`  Run ${i+1}: eth_call failed (${e.code || e.message}) — recording null`);
      readMs.push(null);
    }
  }

  const validMs = readMs.filter(v => v !== null);
  return {
    status:       validMs.length >= 3 ? "EXECUTED" : "PARTIAL",
    nRuns:        N,
    nSuccessful:  validMs.length,
    readMs,
    stats:        validMs.length >= 3 ? stats(validMs) : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== GenoVault Blockchain Benchmark — Local Mode ===");
  console.log(`  N_RUNS = ${N}`);
  console.log(`  Mode: Offline (payload prep + ABI encode + offline sign) + optional live read`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  NOTE: Mining latency and gas_used from receipts require live funded testnet`);

  const payloadPrep = await benchPayloadPrep();
  const abiEncoding = await benchABIEncoding();
  const signing     = await benchOfflineSigning();
  const sepoliaRead = await benchSepoliaRead();

  const output = {
    experiment:   "blockchain_latency_local",
    runAt:        new Date().toISOString(),
    nRuns:        N,
    mode:         "LOCAL_OFFLINE_PLUS_OPTIONAL_READ",
    network:      "Ethereum Sepolia (chainId 11155111)",
    measuredLocally: {
      payloadPreparation:  payloadPrep,
      abiEncoding:         abiEncoding,
      offlineSigning:      signing,
    },
    sepoliaReadLatency: sepoliaRead,
    notMeasured: [
      "registerFile() mining latency — requires funded Sepolia wallet + live RPC",
      "gas_used from tx receipt — requires real transaction",
      "On-chain confirmation time — depends on network congestion",
      "requestAccess / approveAccess / revokeAccess latency — same constraint",
    ],
    howToRunLive: [
      "1. Ensure PRIVATE_KEY is set in .env (funded Sepolia wallet)",
      "2. Ensure BLOCKCHAIN_RPC_URL (Alchemy/Infura Sepolia) is set in .env",
      "3. Ensure BLOCKCHAIN_CONTRACT_ADDRESS is set in .env",
      "4. Get user approval to submit live transactions",
      "5. Run: node backend/experiments/blockchainBenchmark.js",
    ],
    notes: [
      "Signing uses a disposable random wallet (NOT PRIVATE_KEY) — no real keys used.",
      "Payload is synthetic SHA-256/HMAC hashes — no real genomic data.",
      "eth_call for read functions costs zero gas and requires no wallet.",
    ],
  };

  const outPath = require("path").resolve(
    __dirname, "../../results/phase4_blockchain/blockchain_local_latency.json"
  );
  require("fs").mkdirSync(require("path").dirname(outPath), { recursive: true });
  require("fs").writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`\n[Manifest] Result written: ${outPath}`);
  console.log("=== Blockchain local benchmark complete ===");
}

main().catch(err => {
  console.error("Blockchain local benchmark FAILED:", err.message);
  process.exit(1);
});
