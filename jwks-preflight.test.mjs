import test from "node:test";
import assert from "node:assert/strict";
import { preflightJwks } from "./jwks-preflight.mjs";

const ec = (overrides = {}) => ({
  kty: "EC", crv: "P-256", x: Buffer.alloc(32, 1).toString("base64url"),
  y: Buffer.alloc(32, 2).toString("base64url"), kid: "key-1", use: "sig", alg: "ES256", ...overrides,
});
const jwks = (keys) => JSON.stringify({ keys });

test("accepts a bounded public EC key set", () => {
  const result = preflightJwks(jwks([ec()]));
  assert.equal(result.ok, true);
  assert.equal(result.key_count, 1);
  assert.deepEqual(result.issues, []);
});

test("accepts structurally valid RSA and Ed25519 public keys", () => {
  const rsa = {
    kty: "RSA", n: Buffer.alloc(64, 4).toString("base64url"), e: "AQAB",
    kid: "rsa-1", use: "sig", alg: "RS256",
  };
  const ed25519 = {
    kty: "OKP", crv: "Ed25519", x: Buffer.alloc(32, 5).toString("base64url"),
    kid: "ed-1", use: "sig", alg: "EdDSA", key_ops: ["verify"],
  };
  const result = preflightJwks(jwks([rsa, ed25519]));
  assert.equal(result.ok, true);
  assert.equal(result.key_count, 2);
  assert.deepEqual(result.issues, []);
});

test("reports duplicate key IDs and never echoes key values", () => {
  const result = preflightJwks(jwks([ec(), ec({ x: Buffer.alloc(32, 3).toString("base64url") })]));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === "duplicate_kid"));
  assert.equal(JSON.stringify(result).includes(Buffer.alloc(32, 1).toString("base64url")), false);
});

test("rejects private members and private operations", () => {
  const result = preflightJwks(jwks([ec({ d: "secret", key_ops: ["sign"] })]));
  assert.ok(result.issues.some((item) => item.code === "private_key_member_present"));
  assert.ok(result.issues.some((item) => item.code === "private_operation_advertised"));
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("catches wrong coordinate size, unsupported curve, and incompatible algorithm", () => {
  const result = preflightJwks(jwks([ec({ crv: "P-384", alg: "ES256" })]));
  assert.ok(result.issues.some((item) => item.code === "coordinate_length_mismatch"));
  assert.ok(result.issues.some((item) => item.code === "alg_incompatible_with_curve"));
  const unsupported = preflightJwks(jwks([ec({ crv: "unknown", alg: undefined })]));
  assert.ok(unsupported.issues.some((item) => item.code === "unsupported_curve"));
});

test("handles malformed JSON, wrong top-level shape, and empty key sets", () => {
  assert.equal(preflightJwks("{").issues[0].code, "invalid_json");
  assert.equal(preflightJwks("[]").issues[0].code, "jwks_must_be_object");
  assert.equal(preflightJwks('{"keys":[]}').issues[0].code, "keys_must_not_be_empty");
});

test("enforces the byte and key-count bounds", () => {
  assert.equal(preflightJwks(" ".repeat(131_073)).issues[0].code, "input_too_large");
  const result = preflightJwks(jwks(Array.from({ length: 51 }, (_, i) => ec({ kid: `key-${i}` }))));
  assert.ok(result.issues.some((item) => item.code === "too_many_keys"));
  assert.equal(result.issues.filter((item) => item.code === "key_must_be_object").length, 0);
});

test("rejects unsupported key types and malformed base64url members", () => {
  const oct = preflightJwks(jwks([{ kty: "oct", k: "abc" }]));
  assert.ok(oct.issues.some((item) => item.code === "private_key_member_present"));
  assert.ok(oct.issues.some((item) => item.code === "unsupported_public_key_type"));
  const invalid = preflightJwks(jwks([ec({ x: "not+base64" })]));
  assert.ok(invalid.issues.some((item) => item.code === "invalid_base64url_member"));
});
