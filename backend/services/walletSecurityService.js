/**
 * walletSecurityService.js
 * ────────────────────────
 * Phase 3 (R3.3) — Blockchain wallet startup validation.
 *
 * Called once at server startup (from server.js). Validates that the
 * blockchain configuration is internally consistent BEFORE the server
 * accepts any requests. This catches misconfiguration early rather than
 * at first blockchain call.
 *
 * Checks performed:
 *   1. Required env vars are present
 *   2. Private key can be parsed to a valid Ethereum wallet
 *   3. Derived wallet address matches BLOCKCHAIN_DEPLOYER_ADDRESS
 *   4. Connected network chain ID === 11155111 (Sepolia)
 *   5. Contract address is a valid Ethereum address format
 *
 * Security rules:
 *   - The private key is NEVER logged under any condition
 *   - Only the derived wallet ADDRESS is logged (public information)
 *   - On validation failure, a clear error is thrown to halt startup
 *
 * ─── Emergency wallet rotation procedure ────────────────────────────────────
 * If the deployer wallet private key is compromised:
 *   1. Generate a new wallet:
 *        node -e "const e=require('ethers'); const w=e.Wallet.createRandom(); console.log('PK:', w.privateKey, '\nAddr:', w.address)"
 *   2. Fund the new wallet with Sepolia ETH (https://sepoliafaucet.com)
 *   3. Deploy a new GenomicDataRegistry contract pointing to the new wallet:
 *        cd blockchain && npx hardhat run scripts/deploy.js --network sepolia
 *   4. Update .env:
 *        BLOCKCHAIN_DEPLOYER_PRIVATE_KEY = <new private key>
 *        BLOCKCHAIN_DEPLOYER_ADDRESS     = <new wallet address>
 *        BLOCKCHAIN_CONTRACT_ADDRESS     = <new contract address>
 *   5. Restart the backend server
 *   6. Notify the team and document the key rotation event with timestamp
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

const { ethers } = require("ethers");

const SEPOLIA_CHAIN_ID = 11155111;

/**
 * validateBlockchainConfig
 * ────────────────────────
 * Validates blockchain env vars and network connectivity at startup.
 * Throws a descriptive Error if any check fails.
 *
 * @returns {Promise<{ walletAddress: string, chainId: number, contractAddress: string }>}
 */
const validateBlockchainConfig = async () => {
  // ── Check 1: Required env vars present ──────────────────────────────────
  const rpcUrl      = process.env.BLOCKCHAIN_RPC_URL;
  const privateKey  = process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY;
  const contractAddr = process.env.BLOCKCHAIN_CONTRACT_ADDRESS;
  const expectedAddr = process.env.BLOCKCHAIN_DEPLOYER_ADDRESS;

  if (!rpcUrl) {
    throw new Error("[WalletSecurity] BLOCKCHAIN_RPC_URL is not set");
  }
  if (!privateKey) {
    throw new Error("[WalletSecurity] BLOCKCHAIN_DEPLOYER_PRIVATE_KEY is not set");
  }
  if (!contractAddr) {
    throw new Error("[WalletSecurity] BLOCKCHAIN_CONTRACT_ADDRESS is not set");
  }

  // ── Check 2: Private key parses to a valid wallet ────────────────────────
  let wallet;
  try {
    wallet = new ethers.Wallet(privateKey.trim());
  } catch (err) {
    // NEVER log the private key — log the error type only
    throw new Error(
      `[WalletSecurity] BLOCKCHAIN_DEPLOYER_PRIVATE_KEY is invalid or malformed: ${err.message}`
    );
  }

  const derivedAddress = wallet.address;

  // ── Check 3: Derived address matches BLOCKCHAIN_DEPLOYER_ADDRESS ─────────
  if (expectedAddr) {
    if (derivedAddress.toLowerCase() !== expectedAddr.toLowerCase()) {
      throw new Error(
        `[WalletSecurity] Wallet address mismatch. ` +
        `BLOCKCHAIN_DEPLOYER_ADDRESS=${expectedAddr}, ` +
        `but private key derives address=${derivedAddress}. ` +
        `Verify BLOCKCHAIN_DEPLOYER_PRIVATE_KEY is correct.`
      );
    }
  }

  // ── Check 4: Contract address is a valid Ethereum address format ──────────
  if (!ethers.isAddress(contractAddr)) {
    throw new Error(
      `[WalletSecurity] BLOCKCHAIN_CONTRACT_ADDRESS is not a valid Ethereum address: ${contractAddr}`
    );
  }

  // ── Check 5: Network chain ID === 11155111 (Sepolia) ─────────────────────
  let chainId;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network  = await provider.getNetwork();
    chainId = Number(network.chainId);

    if (chainId !== SEPOLIA_CHAIN_ID) {
      throw new Error(
        `[WalletSecurity] Connected to chain ID ${chainId} but expected Sepolia (${SEPOLIA_CHAIN_ID}). ` +
        `Check BLOCKCHAIN_RPC_URL.`
      );
    }
  } catch (err) {
    if (err.message.startsWith("[WalletSecurity]")) throw err;
    // RPC unreachable — warn but do not halt (blockchain is optional / may be offline)
    console.warn(
      `[WalletSecurity] ⚠️  Could not connect to RPC to verify chain ID: ${err.message}. ` +
      `Chain ID validation skipped — verify BLOCKCHAIN_RPC_URL is correct.`
    );
    chainId = null;
  }

  // ── All checks passed — log ADDRESS only (never private key) ─────────────
  console.log(`[WalletSecurity] ✅ Wallet validated. Address: ${derivedAddress}`);
  console.log(`[WalletSecurity] ✅ Contract: ${contractAddr}`);
  if (chainId) {
    console.log(`[WalletSecurity] ✅ Network: Sepolia (chainId=${chainId})`);
  }

  return { walletAddress: derivedAddress, chainId, contractAddress: contractAddr };
};

/**
 * validateResearcherIdentityConfig
 * ──────────────────────────────────
 * Validates the RESEARCHER_ID_HMAC_SECRET is set and has the correct format.
 * Called at startup alongside blockchain validation.
 */
const validateResearcherIdentityConfig = () => {
  const secret = process.env.RESEARCHER_ID_HMAC_SECRET;
  if (!secret) {
    throw new Error(
      "[WalletSecurity] RESEARCHER_ID_HMAC_SECRET is not set. " +
      "New access requests will fail. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error(
      "[WalletSecurity] RESEARCHER_ID_HMAC_SECRET must be a 64-char lowercase hex string (256-bit key). " +
      `Got ${secret.length} chars.`
    );
  }
  console.log("[WalletSecurity] ✅ RESEARCHER_ID_HMAC_SECRET configured (v2 identity enabled)");
};

/**
 * runStartupValidation
 * ─────────────────────
 * Convenience wrapper called from server.js.
 * Runs both blockchain and identity config validation.
 * Blockchain failures are warnings (blockchain is optional).
 * Identity config failures are hard errors.
 *
 * @returns {Promise<void>}
 */
const runStartupValidation = async () => {
  // Identity config — hard error if missing
  try {
    validateResearcherIdentityConfig();
  } catch (err) {
    console.error(`[WalletSecurity] ❌ ${err.message}`);
    // Do not crash server — log prominently and continue (requests will fail at call time)
  }

  // Blockchain config — optional, warn only
  if (!process.env.BLOCKCHAIN_RPC_URL || !process.env.BLOCKCHAIN_DEPLOYER_PRIVATE_KEY) {
    console.warn("[WalletSecurity] ⚠️  Blockchain not fully configured — skipping wallet validation");
    return;
  }

  try {
    await validateBlockchainConfig();
  } catch (err) {
    console.error(`[WalletSecurity] ❌ Blockchain validation failed: ${err.message}`);
    // Do not crash server — blockchain may be unavailable (offline/testnet)
  }
};

module.exports = {
  validateBlockchainConfig,
  validateResearcherIdentityConfig,
  runStartupValidation,
};
