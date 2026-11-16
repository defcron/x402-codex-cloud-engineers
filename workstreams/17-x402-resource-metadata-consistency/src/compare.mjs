export const MAX_INPUT_BYTES = 65_536;
export const MAX_OFFERS = 20;

const RESOURCE_FIELDS = ["url", "description", "mimeType"];

export class X402MetadataInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "X402MetadataInputError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inputError(code, message) {
  throw new X402MetadataInputError(code, message);
}

function validateVersion(value, label) {
  if (!Number.isInteger(value) || (value !== 1 && value !== 2)) {
    inputError("invalid_version", label + " must be integer 1 or 2");
  }
}

function validateOffers(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OFFERS) {
    inputError("invalid_offers", label + " must contain 1 to " + MAX_OFFERS + " offers");
  }
  if (value.some((offer) => !isRecord(offer))) {
    inputError("invalid_offer", label + " entries must be objects");
  }
}

function stableJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) inputError("invalid_json_value", "Input contains a non-JSON value");
    return encoded;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  }
  return "{" + Object.keys(value)
    .sort()
    .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
    .join(",") + "}";
}

function offerSetMismatch(expectedOffers, actualOffers) {
  const expectedIndicesByKey = new Map();
  expectedOffers.forEach((offer, index) => {
    const key = stableJson(offer);
    const indices = expectedIndicesByKey.get(key) ?? [];
    indices.push(index);
    expectedIndicesByKey.set(key, indices);
  });

  const matchedExpected = new Set();
  const unexpectedOfferIndices = [];
  actualOffers.forEach((offer, index) => {
    const indices = expectedIndicesByKey.get(stableJson(offer));
    const expectedIndex = indices?.shift();
    if (expectedIndex === undefined) unexpectedOfferIndices.push(index);
    else matchedExpected.add(expectedIndex);
  });

  const missingOfferIndices = expectedOffers
    .map((_, index) => index)
    .filter((index) => !matchedExpected.has(index));

  if (missingOfferIndices.length === 0 && unexpectedOfferIndices.length === 0) return null;
  return {
    code: "offer_set_mismatch",
    path: "challenge.accepts",
    missing_offer_indices: missingOfferIndices,
    unexpected_offer_indices: unexpectedOfferIndices,
  };
}

/**
 * Compare a caller-supplied x402 PaymentRequired object with its expected
 * resource manifest. This is a structural consistency check only: it does
 * not fetch resources, verify signatures, inspect payment proofs, or establish
 * payment or settlement.
 */
export function compareChallengeToManifest(input) {
  if (!isRecord(input) || !isRecord(input.challenge) || !isRecord(input.manifest)) {
    inputError("invalid_envelope", "Input must contain challenge and manifest objects");
  }

  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    inputError("invalid_json", "Input must be JSON-serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_INPUT_BYTES) {
    inputError("input_too_large", "Serialized input must not exceed " + MAX_INPUT_BYTES + " UTF-8 bytes");
  }

  const { challenge, manifest } = input;
  validateVersion(challenge.x402Version, "challenge.x402Version");
  validateVersion(manifest.x402Version, "manifest.x402Version");
  validateOffers(challenge.accepts, "challenge.accepts");
  validateOffers(manifest.accepts, "manifest.accepts");

  if (!isRecord(manifest.resource) || typeof manifest.resource.url !== "string" || manifest.resource.url.length === 0) {
    inputError("invalid_manifest_resource", "manifest.resource.url must be a non-empty string");
  }
  for (const field of ["description", "mimeType"]) {
    if (Object.hasOwn(manifest.resource, field) && typeof manifest.resource[field] !== "string") {
      inputError("invalid_manifest_resource", "manifest.resource." + field + " must be a string when supplied");
    }
  }

  const mismatches = [];
  if (challenge.x402Version !== manifest.x402Version) {
    mismatches.push({ code: "version_mismatch", path: "x402Version" });
  }

  if (!isRecord(challenge.resource)) {
    mismatches.push({ code: "resource_missing", path: "challenge.resource" });
  } else {
    for (const field of RESOURCE_FIELDS) {
      if (Object.hasOwn(manifest.resource, field) && challenge.resource[field] !== manifest.resource[field]) {
        mismatches.push({ code: "resource_field_mismatch", path: "resource." + field });
      }
    }
  }

  const offersMismatch = offerSetMismatch(manifest.accepts, challenge.accepts);
  if (offersMismatch) mismatches.push(offersMismatch);

  return {
    consistent: mismatches.length === 0,
    challenge_version: challenge.x402Version,
    manifest_version: manifest.x402Version,
    expected_offer_count: manifest.accepts.length,
    actual_offer_count: challenge.accepts.length,
    mismatches,
  };
}
