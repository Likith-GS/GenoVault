/**
 * identity.test.js
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 1 (R3.1) — Researcher identity versioning tests.
 *
 * Tests:
 *   1.  Same ORCID + same secret    → same HMAC identifier (determinism)
 *   2.  Different ORCID             → different identifier
 *   3.  Same ORCID + different secret → different identifier
 *   4.  Identifier is valid bytes32  (0x + 64 lowercase hex, 66 chars total)
 *   5.  RESEARCHER_ID_HMAC_SECRET missing → throws immediately (fail-safe)
 *   6.  Raw ORCID is not a substring of the returned identifier
 *   7.  V1 (keccak256) and V2 (HMAC) produce different values for the same ORCID
 *
 * Run with: npx jest tests/identity.test.js
 */

"use strict";

const TEST_SECRET_HEX =
  "6af6b2ebc32e0c65b3e76678c4f8fa69c8b76d6181cc8200e92478221f1d8b8f";

const ALT_SECRET_HEX =
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

const SAMPLE_ORCID  = "0000-0002-1825-0097";
const SAMPLE_ORCID2 = "0000-0003-4567-8901";

process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
const { orcidToBytes32, orcidToBytes32Hmac } = require("../services/blockchainService");

describe("Phase 1 — Identity Versioning (R3.1)", () => {

  test("1. Same ORCID + same secret → same identifier (HMAC determinism)", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const id1 = orcidToBytes32Hmac(SAMPLE_ORCID);
    const id2 = orcidToBytes32Hmac(SAMPLE_ORCID);
    expect(id1).toBe(id2);
  });

  test("2. Different ORCID → different identifier", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const id1 = orcidToBytes32Hmac(SAMPLE_ORCID);
    const id2 = orcidToBytes32Hmac(SAMPLE_ORCID2);
    expect(id1).not.toBe(id2);
  });

  test("3. Same ORCID + different secret → different identifier", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const id1 = orcidToBytes32Hmac(SAMPLE_ORCID);
    process.env.RESEARCHER_ID_HMAC_SECRET = ALT_SECRET_HEX;
    const id2 = orcidToBytes32Hmac(SAMPLE_ORCID);
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    expect(id1).not.toBe(id2);
  });

  test("4. Identifier is a valid bytes32 (0x-prefixed, 66 chars, lowercase hex)", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const id = orcidToBytes32Hmac(SAMPLE_ORCID);
    expect(id.startsWith("0x")).toBe(true);
    expect(id).toHaveLength(66);
    expect(id.slice(2)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("5. Missing RESEARCHER_ID_HMAC_SECRET → throws (fail-safe)", () => {
    const original = process.env.RESEARCHER_ID_HMAC_SECRET;
    delete process.env.RESEARCHER_ID_HMAC_SECRET;
    expect(() => orcidToBytes32Hmac(SAMPLE_ORCID)).toThrow(/RESEARCHER_ID_HMAC_SECRET/);
    process.env.RESEARCHER_ID_HMAC_SECRET = original;
  });

  test("6. Raw ORCID string is not present in the returned identifier", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const id = orcidToBytes32Hmac(SAMPLE_ORCID);
    expect(id).not.toContain(SAMPLE_ORCID);
    expect(id).not.toContain(SAMPLE_ORCID.replace(/-/g, ""));
  });

  test("7. V1 keccak256 and V2 HMAC produce different identifiers for the same ORCID", () => {
    process.env.RESEARCHER_ID_HMAC_SECRET = TEST_SECRET_HEX;
    const idV1 = orcidToBytes32(SAMPLE_ORCID);
    const idV2 = orcidToBytes32Hmac(SAMPLE_ORCID);
    expect(idV1).not.toBe(idV2);
    expect(idV1).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(idV2).toMatch(/^0x[0-9a-f]{64}$/);
    console.log("[T7] V1 (keccak256):", idV1);
    console.log("[T7] V2 (HMAC-SHA256):", idV2);
  });

});
