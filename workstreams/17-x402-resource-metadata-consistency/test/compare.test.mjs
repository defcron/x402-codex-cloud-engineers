import test from "node:test";
import assert from "node:assert/strict";
import {
  compareChallengeToManifest,
  MAX_OFFERS,
  MAX_NESTING_DEPTH,
  X402MetadataInputError,
} from "../src/compare.mjs";

const payment = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x" + "1".repeat(40),
  amount: "5000",
  payTo: "0x" + "2".repeat(40),
  maxTimeoutSeconds: 60,
  extra: { memo: "report" },
};

function fixture() {
  const resource = {
    url: "https://merchant.example/v1/report",
    description: "Build a report",
    mimeType: "application/json",
  };
  return {
    challenge: { x402Version: 2, resource: structuredClone(resource), accepts: [structuredClone(payment)] },
    manifest: { x402Version: 2, resource: structuredClone(resource), accepts: [structuredClone(payment)] },
  };
}

test("matching challenge and manifest are consistent", () => {
  const result = compareChallengeToManifest(fixture());
  assert.equal(result.consistent, true);
  assert.deepEqual(result.mismatches, []);
});

test("resource URL and MIME mismatches are reported by field", () => {
  const input = fixture();
  input.challenge.resource.url = "https://merchant.example/v1/other";
  input.challenge.resource.mimeType = "text/plain";
  const result = compareChallengeToManifest(input);
  assert.deepEqual(result.mismatches.map(({ path }) => path), ["resource.url", "resource.mimeType"]);
});

test("offer order and object key order do not affect equality", () => {
  const input = fixture();
  const second = { ...payment, amount: "6000", extra: { z: 1, a: 2 } };
  const first = { ...payment, amount: "5000", extra: { a: 2, z: 1 } };
  input.manifest.accepts = [first, second];
  input.challenge.accepts = [
    { ...second, extra: { a: 2, z: 1 } },
    { ...first, extra: { z: 1, a: 2 } },
  ];
  assert.equal(compareChallengeToManifest(input).consistent, true);
});

test("offer amount changes and duplicate counts are reported", () => {
  const input = fixture();
  input.manifest.accepts = [payment, payment];
  input.challenge.accepts = [{ ...payment, amount: "5001" }];
  const mismatch = compareChallengeToManifest(input).mismatches[0];
  assert.deepEqual(mismatch, {
    code: "offer_set_mismatch",
    path: "challenge.accepts",
    missing_offer_indices: [0, 1],
    unexpected_offer_indices: [0],
  });
});

test("v1/v2 version disagreement is reported, not treated as malformed", () => {
  const input = fixture();
  input.manifest.x402Version = 1;
  assert.equal(compareChallengeToManifest(input).mismatches[0].code, "version_mismatch");
});

test("missing challenge resource is a consistency mismatch", () => {
  const input = fixture();
  delete input.challenge.resource;
  assert.deepEqual(compareChallengeToManifest(input).mismatches[0], {
    code: "resource_missing",
    path: "challenge.resource",
  });
});

test("20 offers are accepted and 21 are rejected", () => {
  const input = fixture();
  input.challenge.accepts = Array.from({ length: MAX_OFFERS }, () => structuredClone(payment));
  input.manifest.accepts = Array.from({ length: MAX_OFFERS }, () => structuredClone(payment));
  assert.equal(compareChallengeToManifest(input).consistent, true);
  input.challenge.accepts.push(structuredClone(payment));
  assert.throws(() => compareChallengeToManifest(input), (error) =>
    error instanceof X402MetadataInputError && error.code === "invalid_offers");
});

test("nesting at depth 64 passes and depth 65 is rejected", () => {
  const input = fixture();
  let extra = { leaf: true };
  for (let index = 0; index < MAX_NESTING_DEPTH - 5; index += 1) {
    extra = { child: extra };
  }
  input.manifest.accepts[0].extra = structuredClone(extra);
  input.challenge.accepts[0].extra = structuredClone(extra);
  assert.equal(compareChallengeToManifest(input).consistent, true);

  extra = { child: extra };
  input.manifest.accepts[0].extra = structuredClone(extra);
  input.challenge.accepts[0].extra = structuredClone(extra);
  assert.throws(() => compareChallengeToManifest(input), { code: "input_too_deep" });
});

test("empty offers and invalid versions produce input errors", () => {
  const input = fixture();
  input.challenge.accepts = [];
  assert.throws(() => compareChallengeToManifest(input), { code: "invalid_offers" });
  const badVersion = fixture();
  badVersion.challenge.x402Version = 3;
  assert.throws(() => compareChallengeToManifest(badVersion), { code: "invalid_version" });
});

test("oversized serialized input is rejected", () => {
  const input = fixture();
  input.manifest.resource.description = "x".repeat(66_000);
  assert.throws(() => compareChallengeToManifest(input), { code: "input_too_large" });
});
