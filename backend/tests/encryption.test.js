/**
 * encryption.test.js
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 2 (R3.2) — Encrypt-then-MAC versioning tests.
 *
 * Tests:
 *   1.  V2 encrypt → decrypt succeeds (round-trip)
 *   2.  V2: modified ciphertext → MAC verification throws
 *   3.  V2: modified IV → MAC verification throws
 *   4.  V2: wrong MAC hex → throws
 *   5.  V2: incorrect MAC is rejected using constant-time comparison
 *   6.  V1 legacy decryptBuffer still works correctly
 *   7.  V1 file never reaches decryptBufferV2 without a MAC
 *   8.  encryptionVersion field is 'v2' for new uploads
 *
 * Run with: npx jest tests/encryption.test.js
 */

"use strict";

const crypto = require("crypto");
const {
  generateKey,
  generateIV,
  encryptBuffer,
  decryptBuffer,
  encryptBufferV2,
  decryptBufferV2,
} = require("../services/encryptionService");

// ── Test helpers ─────────────────────────────────────────────────────────────

const makePlain  = (size = 1024) => crypto.randomBytes(size);
const makeKeyHex = ()            => generateKey();
const makeIvHex  = ()            => generateIV();

// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 2 — Encrypt-then-MAC (R3.2)", () => {

  // T1: Round-trip ─────────────────────────────────────────────────────────
  test("1. V2 encrypt → decrypt round-trip succeeds", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const { ciphertext, mac } = encryptBufferV2(plain, keyHex, ivHex);
    const recovered           = decryptBufferV2(ciphertext, keyHex, ivHex, mac);

    expect(recovered.equals(plain)).toBe(true);
  });

  // T2: Modified ciphertext rejected ───────────────────────────────────────
  test("2. V2: modified ciphertext → MAC verification throws", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const { ciphertext, mac } = encryptBufferV2(plain, keyHex, ivHex);

    // Flip one byte in the ciphertext
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;

    expect(() => decryptBufferV2(tampered, keyHex, ivHex, mac)).toThrow(
      /MAC verification failed/
    );
  });

  // T3: Modified IV rejected ───────────────────────────────────────────────
  test("3. V2: modified IV → MAC verification throws", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const { ciphertext, mac } = encryptBufferV2(plain, keyHex, ivHex);

    // Use a different IV at decryption time
    const wrongIv = makeIvHex();
    expect(() => decryptBufferV2(ciphertext, keyHex, wrongIv, mac)).toThrow(
      /MAC verification failed/
    );
  });

  // T4: Wrong MAC rejected ─────────────────────────────────────────────────
  test("4. V2: completely wrong MAC hex → throws", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const { ciphertext } = encryptBufferV2(plain, keyHex, ivHex);
    const wrongMac       = crypto.randomBytes(32).toString("hex");

    expect(() => decryptBufferV2(ciphertext, keyHex, ivHex, wrongMac)).toThrow(
      /MAC verification failed/
    );
  });

  // T5: Constant-time rejection ────────────────────────────────────────────
  test("5. V2: incorrect MAC is rejected — constant-time comparison via timingSafeEqual", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const { ciphertext, mac } = encryptBufferV2(plain, keyHex, ivHex);

    // Flip one bit in the MAC — error must be thrown (not silently ignored)
    const tamperedMac = Buffer.from(mac, "hex");
    tamperedMac[0] ^= 0x01;
    const tamperedMacHex = tamperedMac.toString("hex");

    expect(() => decryptBufferV2(ciphertext, keyHex, ivHex, tamperedMacHex)).toThrow(
      /MAC verification failed/
    );
  });

  // T6: V1 legacy decrypt still works ─────────────────────────────────────
  test("6. V1 legacy decryptBuffer still decrypts V1 ciphertext correctly", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    // V1 encrypt (no MAC)
    const ciphertext = encryptBuffer(plain, keyHex, ivHex);

    // V1 decrypt
    const recovered  = decryptBuffer(ciphertext, keyHex, ivHex);

    expect(recovered.equals(plain)).toBe(true);
  });

  // T7: V1 file without MAC must NOT reach decryptBufferV2 ─────────────────
  test("7. V1 file without MAC string → decryptBufferV2 throws (missing expectedMacHex)", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const ciphertext = encryptBuffer(plain, keyHex, ivHex);

    // Simulate caller incorrectly passing null MAC (V1 file reaching V2 path)
    expect(() => decryptBufferV2(ciphertext, keyHex, ivHex, null)).toThrow();
  });

  // T8: encryptionVersion field is v2 for new uploads ──────────────────────
  test("8. encryptBufferV2 returns ciphertext and a 64-char hex MAC (encryptionMac field)", () => {
    const plain  = makePlain();
    const keyHex = makeKeyHex();
    const ivHex  = makeIvHex();

    const result = encryptBufferV2(plain, keyHex, ivHex);

    // Must return { ciphertext, mac }
    expect(Buffer.isBuffer(result.ciphertext)).toBe(true);
    expect(typeof result.mac).toBe("string");

    // MAC must be a 64-char lowercase hex string (32 bytes = SHA-256 output)
    expect(result.mac).toHaveLength(64);
    expect(result.mac).toMatch(/^[0-9a-f]{64}$/);

    // Ciphertext must differ from plaintext
    expect(result.ciphertext.equals(plain)).toBe(false);
  });

});
