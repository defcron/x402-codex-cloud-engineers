const MAX_BYTES = 131_072;
const MAX_KEYS = 50;
const MAX_KID_LENGTH = 256;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const COMMON = new Set([
  "kty", "kid", "use", "key_ops", "alg", "x5u", "x5c", "x5t", "x5t#S256",
]);

function issue(issues, path, code) {
  issues.push({ path, code });
}

function decodedLength(value) {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.toString("base64url") === value.replace(/=+$/, "") ? bytes.length : null;
  } catch {
    return null;
  }
}

function inspectKey(key, index, issues, seenKids) {
  const path = `/keys/${index}`;
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    issue(issues, path, "key_must_be_object");
    return;
  }

  for (const member of PRIVATE_MEMBERS) {
    if (Object.hasOwn(key, member)) issue(issues, `${path}/${member}`, "private_key_member_present");
  }

  if (typeof key.kid === "string") {
    if (!key.kid.trim() || key.kid.length > MAX_KID_LENGTH) issue(issues, `${path}/kid`, "invalid_kid");
    if (seenKids.has(key.kid)) issue(issues, `${path}/kid`, "duplicate_kid");
    seenKids.add(key.kid);
  } else if (key.kid !== undefined) {
    issue(issues, `${path}/kid`, "kid_must_be_string");
  }

  if (key.use !== undefined && !["sig", "enc"].includes(key.use)) {
    issue(issues, `${path}/use`, "invalid_use");
  }
  if (key.key_ops !== undefined) {
    const allowed = new Set(["sign", "verify", "encrypt", "decrypt", "wrapKey", "unwrapKey", "deriveKey", "deriveBits"]);
    if (!Array.isArray(key.key_ops) || key.key_ops.length === 0 || key.key_ops.some((op) => typeof op !== "string" || !allowed.has(op))) {
      issue(issues, `${path}/key_ops`, "invalid_key_ops");
    } else if (key.key_ops.some((op) => ["sign", "decrypt", "unwrapKey", "deriveKey", "deriveBits"].includes(op))) {
      issue(issues, `${path}/key_ops`, "private_operation_advertised");
    }
  }

  const knownAlgs = {
    RSA: /^(RS(256|384|512)|PS(256|384|512)|RSA-OAEP(-256|-384|-512)?)$/,
    EC: /^ES(256|384|512)$/,
    OKP: /^EdDSA$/,
  };
  if (key.alg !== undefined && (typeof key.alg !== "string" || !knownAlgs[key.kty]?.test(key.alg))) {
    issue(issues, `${path}/alg`, "alg_incompatible_with_kty");
  }

  if (key.kty === "RSA") {
    for (const member of ["n", "e"]) {
      if (decodedLength(key[member]) === null) issue(issues, `${path}/${member}`, "invalid_base64url_member");
    }
  } else if (key.kty === "EC") {
    const sizes = { "P-256": 32, "P-384": 48, "P-521": 66 };
    if (!Object.hasOwn(sizes, key.crv)) issue(issues, `${path}/crv`, "unsupported_curve");
    for (const member of ["x", "y"]) {
      const length = decodedLength(key[member]);
      if (length === null) issue(issues, `${path}/${member}`, "invalid_base64url_member");
      else if (sizes[key.crv] && length !== sizes[key.crv]) issue(issues, `${path}/${member}`, "coordinate_length_mismatch");
    }
    if (key.alg === "ES256" && key.crv !== "P-256" || key.alg === "ES384" && key.crv !== "P-384" || key.alg === "ES512" && key.crv !== "P-521") {
      issue(issues, `${path}/alg`, "alg_incompatible_with_curve");
    }
  } else if (key.kty === "OKP") {
    const sizes = { Ed25519: 32, Ed448: 57, X25519: 32, X448: 56 };
    if (!Object.hasOwn(sizes, key.crv)) issue(issues, `${path}/crv`, "unsupported_curve");
    const length = decodedLength(key.x);
    if (length === null) issue(issues, `${path}/x`, "invalid_base64url_member");
    else if (sizes[key.crv] && length !== sizes[key.crv]) issue(issues, `${path}/x`, "coordinate_length_mismatch");
    if (key.alg === "EdDSA" && !["Ed25519", "Ed448"].includes(key.crv)) issue(issues, `${path}/alg`, "alg_incompatible_with_curve");
  } else {
    issue(issues, `${path}/kty`, "unsupported_public_key_type");
  }

  for (const member of Object.keys(key)) {
    if (!COMMON.has(member) && !["n", "e", "crv", "x", "y"].includes(member)) {
      issue(issues, `${path}/${member}`, "unsupported_member");
    }
  }
}

/** Parse and lint a caller-supplied JWKS JSON string. It never fetches or trusts keys. */
export function preflightJwks(rawJson) {
  if (typeof rawJson !== "string") throw new TypeError("rawJson must be a string");
  if (Buffer.byteLength(rawJson, "utf8") > MAX_BYTES) {
    return { ok: false, key_count: 0, issues: [{ path: "", code: "input_too_large" }], note: "Input limit is 131072 UTF-8 bytes." };
  }

  let jwks;
  try {
    jwks = JSON.parse(rawJson);
  } catch {
    return { ok: false, key_count: 0, issues: [{ path: "", code: "invalid_json" }], note: "No input values are returned." };
  }

  const issues = [];
  if (!jwks || typeof jwks !== "object" || Array.isArray(jwks)) {
    issue(issues, "", "jwks_must_be_object");
    return { ok: false, key_count: 0, issues, note: "No key material is returned." };
  }
  if (!Array.isArray(jwks.keys)) {
    issue(issues, "/keys", "keys_must_be_array");
    return { ok: false, key_count: 0, issues, note: "No key material is returned." };
  }
  if (jwks.keys.length === 0) issue(issues, "/keys", "keys_must_not_be_empty");
  if (jwks.keys.length > MAX_KEYS) issue(issues, "/keys", "too_many_keys");

  const seenKids = new Set();
  jwks.keys.slice(0, MAX_KEYS).forEach((key, index) => inspectKey(key, index, issues, seenKids));
  for (const member of Object.keys(jwks)) {
    if (member !== "keys") issue(issues, `/${member}`, "unsupported_member");
  }

  return {
    ok: issues.length === 0,
    key_count: jwks.keys.length,
    issues,
    note: "Structural preflight only; keys and their provenance are not cryptographically validated or trusted.",
  };
}
