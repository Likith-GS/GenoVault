/**
 * encryptionService.js
 * ────────────────────
 * AES-256-CBC encryption utility — encrypt and decrypt Buffer/streams.
 *
 * Encryption versioning:
 *   V1  AES-256-CBC only (no MAC)
 *       Used for all existing files. IV stored in MongoDB. No HMAC.
 *       Blockchain-anchored SHA-256 detects blob-level changes to stored
 *       ciphertext, but does not provide authenticated encryption.
 *
 *   V2  AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC)
 *       Used for all new uploads. Provides ciphertext authentication
 *       independently of the storage layer.
 *       MAC key is derived from the encryption key via HKDF-SHA256 with
 *       a distinct context string — no key reuse.
 *       MAC covers: IV || ciphertext (Encrypt-then-MAC construction).
 *       MAC is verified BEFORE decryption (fail-fast on tampered data).
 *
 * Design decisions:
 *  • Key is NEVER persisted here — passed in from Azure Key Vault at call time
 *  • IV is random per-file (16 bytes), stored in MongoDB (not a secret)
 *  • Returns Buffer — callers decide how to handle (stream, blob upload, etc.)
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-cbc";
const KEY_BYTES = 32; // AES-256 → 32 byte key
const IV_BYTES  = 16; // AES-CBC  → 16 byte IV

/**
 * generateKey
 * ───────────
 * Generates a cryptographically secure 32-byte AES-256 key.
 * Returns a hex string (64 chars) — safe to store in Azure Key Vault.
 *
 * @returns {string} 64-char hex string
 */
const generateKey = () => crypto.randomBytes(KEY_BYTES).toString("hex");

/**
 * generateIV
 * ──────────
 * Generates a random 16-byte IV for CBC mode.
 * The IV is NOT secret — it is stored alongside file metadata in MongoDB.
 *
 * @returns {string} 32-char hex string
 */
const generateIV = () => crypto.randomBytes(IV_BYTES).toString("hex");

/**
 * encryptBuffer
 * ─────────────
 * Encrypts a Buffer using AES-256-CBC.
 *
 * @param {Buffer} plainBuffer  - Raw file bytes
 * @param {string} keyHex       - 64-char hex AES key (from Key Vault)
 * @param {string} ivHex        - 32-char hex IV
 * @returns {Buffer}            - Encrypted bytes
 */
const encryptBuffer = (plainBuffer, keyHex, ivHex) => {
  const key    = Buffer.from(keyHex, "hex");
  const iv     = Buffer.from(ivHex,  "hex");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  return Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
};

/**
 * decryptBuffer
 * ─────────────
 * Decrypts a Buffer using AES-256-CBC.
 * Called ONLY on-demand — decrypted bytes are never persisted.
 *
 * @param {Buffer} encryptedBuffer - Encrypted file bytes
 * @param {string} keyHex          - 64-char hex AES key (from Key Vault)
 * @param {string} ivHex           - 32-char hex IV (from MongoDB)
 * @returns {Buffer}               - Decrypted (plain) bytes
 */
const decryptBuffer = (encryptedBuffer, keyHex, ivHex) => {
  const key      = Buffer.from(keyHex, "hex");
  const iv       = Buffer.from(ivHex,  "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
};

/**
 * decryptPartialBuffer
 * ────────────────────
 * Decrypts only the first N complete AES-CBC blocks (no padding check).
 * Used for file previews — lets us decrypt the first 256 bytes without
 * needing to download the entire file.
 *
 * IMPORTANT: Input size must be a multiple of 16 bytes.
 * NOTE: Only applicable to V1 files. V2 files require full MAC verification
 *       before any decryption — partial decryption is not supported for V2.
 *
 * @param {Buffer} encChunk - First N bytes of the encrypted blob (N % 16 === 0)
 * @param {string} keyHex   - 64-char hex AES key
 * @param {string} ivHex    - 32-char hex IV
 * @returns {Buffer}        - Decrypted bytes (same length as input)
 */
const decryptPartialBuffer = (encChunk, keyHex, ivHex) => {
  const key      = Buffer.from(keyHex, "hex");
  const iv       = Buffer.from(ivHex,  "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAutoPadding(false);  // skip PKCS7 check — partial data only
  return decipher.update(encChunk);
};

/**
 * streamToBuffer — converts a Readable stream to a Buffer.
 */
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data",  (c) => chunks.push(c));
    stream.on("end",   ()  => resolve(Buffer.concat(chunks)));
    stream.on("error", (e) => reject(e));
  });

// ─────────────────────────────────────────────────────────────────────────────
// V2 — AES-256-CBC + HMAC-SHA256 (Encrypt-then-MAC, R3.2)
// ─────────────────────────────────────────────────────────────────────────────

const HKDF_MAC_INFO   = "genovault-mac-v2";   // context string for HKDF key derivation
const HKDF_HASH       = "sha256";
const HKDF_MAC_LENGTH = 32;                   // 256-bit MAC key

/**
 * _deriveMacKey (internal)
 * ─────────────────────────
 * Derives a MAC key from the encryption key using HKDF-SHA256 with a
 * fixed context/info string. This ensures the MAC key is cryptographically
 * independent from the encryption key, avoiding key reuse.
 *
 * @param {Buffer} encKey  - 32-byte encryption key
 * @returns {Buffer}       - 32-byte MAC key
 */
const _deriveMacKey = (encKey) =>
  Buffer.from(
    crypto.hkdfSync(HKDF_HASH, encKey, "", HKDF_MAC_INFO, HKDF_MAC_LENGTH)
  );

/**
 * encryptBufferV2  (V2 — Encrypt-then-MAC)
 * ─────────────────────────────────────────
 * Encrypts a Buffer using AES-256-CBC and authenticates the result with
 * HMAC-SHA256 over the IV and ciphertext (Encrypt-then-MAC construction).
 *
 * The MAC key is derived from the encryption key via HKDF-SHA256 using
 * the context string "genovault-mac-v2" — no key reuse.
 *
 * @param {Buffer} plainBuffer  - Raw file bytes
 * @param {string} keyHex       - 64-char hex AES key (from Key Vault)
 * @param {string} ivHex        - 32-char hex IV
 * @returns {{ ciphertext: Buffer, mac: string }}
 *   ciphertext — encrypted bytes
 *   mac        — HMAC-SHA256 hex string (64 chars) stored in GenomicFile.encryptionMac
 */
const encryptBufferV2 = (plainBuffer, keyHex, ivHex) => {
  const encKey = Buffer.from(keyHex, "hex");
  const iv     = Buffer.from(ivHex,  "hex");
  const macKey = _deriveMacKey(encKey);

  // 1. Encrypt
  const cipher     = crypto.createCipheriv(ALGORITHM, encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);

  // 2. MAC over IV || ciphertext (Encrypt-then-MAC)
  const mac = crypto
    .createHmac("sha256", macKey)
    .update(iv)
    .update(ciphertext)
    .digest("hex");

  return { ciphertext, mac };
};

/**
 * decryptBufferV2  (V2 — verify MAC then decrypt)
 * ─────────────────────────────────────────────────
 * Verifies the HMAC-SHA256 MAC BEFORE decrypting. If the MAC does not
 * match, an error is thrown immediately without decrypting any bytes
 * (fail-fast, prevents oracle attacks).
 *
 * Comparison is constant-time via crypto.timingSafeEqual to prevent
 * timing-based MAC forgery attacks.
 *
 * @param {Buffer} encryptedBuffer  - Encrypted file bytes (from Azure)
 * @param {string} keyHex           - 64-char hex AES key (from Key Vault)
 * @param {string} ivHex            - 32-char hex IV (from MongoDB)
 * @param {string} expectedMacHex   - 64-char hex MAC (from MongoDB encryptionMac)
 * @returns {Buffer}                - Decrypted (plain) bytes
 * @throws  {Error}                 - If MAC verification fails
 */
const decryptBufferV2 = (encryptedBuffer, keyHex, ivHex, expectedMacHex) => {
  const encKey = Buffer.from(keyHex,  "hex");
  const iv     = Buffer.from(ivHex,   "hex");
  const macKey = _deriveMacKey(encKey);

  // 1. Compute MAC over IV || ciphertext
  const computedMac = crypto
    .createHmac("sha256", macKey)
    .update(iv)
    .update(encryptedBuffer)
    .digest("hex");

  // 2. Constant-time comparison — prevents timing oracle on MAC
  const computedBuf = Buffer.from(computedMac,    "hex");
  const expectedBuf = Buffer.from(expectedMacHex, "hex");

  if (computedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(computedBuf, expectedBuf)) {
    throw new Error(
      "[Encryption] V2 MAC verification failed — " +
      "ciphertext may have been tampered with or the wrong key/IV was supplied"
    );
  }

  // 3. Decrypt only after MAC verification passes
  const decipher = crypto.createDecipheriv(ALGORITHM, encKey, iv);
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
};

module.exports = {
  // V1 — AES-256-CBC (legacy, used for all existing files — do NOT remove)
  generateKey,
  generateIV,
  encryptBuffer,
  decryptBuffer,
  decryptPartialBuffer,
  // V2 — AES-256-CBC + HMAC-SHA256 Encrypt-then-MAC (new uploads)
  encryptBufferV2,
  decryptBufferV2,
  // Utility
  streamToBuffer,
};
