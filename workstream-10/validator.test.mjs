import test from "node:test";
import assert from "node:assert/strict";
import {validateJwksCachePolicy} from "./validator.mjs";

const policy = {max_age_seconds: 300, max_stale_seconds: 60, maximum_token_lifetime_seconds: 600, safety_margin_seconds: 60};
const at = minutes => `2026-01-01T00:${String(minutes).padStart(2, "0")}:00Z`;
const observation = (minute, kids, cacheControl = "public, max-age=300, stale-while-revalidate=30") => ({
  observed_at: at(minute),
  age_seconds: 0,
  cache_control: cacheControl,
  jwks: {keys: kids.map(kid => ({kid, kty: "RSA", use: "sig"}))}
});

test("accepts bounded cache headers and a sampled old/new key overlap", () => {
  const result = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"], 'public, max-age=300, foo="a,b", stale-while-revalidate=30'), observation(5, ["old", "new"]),
    observation(25, ["old", "new"]), observation(30, ["new"])
  ]});
  assert.equal(result.ok, true);
  assert.deepEqual(result.rotations, [{old_kid: "old", new_kid: "new", sampled_overlap_seconds: 1200, required_sampled_overlap_seconds: 1020, passes: true}]);
  assert.equal(result.rotation_policy.required_sampled_overlap_seconds, 1020);
  assert.equal(result.summary.errors, 0);
});

test("rejects cache lifetime and stale windows above policy", () => {
  const result = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"], "public, max-age=301, stale-if-error=61"),
    observation(5, ["old"], "public, max-age=301")
  ]});
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(f => f.code), ["max_age_exceeded", "stale_window_exceeded", "max_age_exceeded"]);
});

test("reports missing cache lifetime and a no-store policy", () => {
  const result = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"], "no-store"), observation(5, ["old"], "public")
  ]});
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.code === "no_store"));
  assert.ok(result.findings.some(f => f.code === "missing_max_age"));
});

test("uses s-maxage for shared caches and warns when Age exceeds it", () => {
  const result = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"], "public, max-age=900, s-maxage=300"),
    {...observation(5, ["old"], "public, max-age=900, s-maxage=300"), age_seconds: 301}
  ]});
  assert.equal(result.ok, true);
  assert.equal(result.cache_policy[0].advertised_max_age_seconds, 300);
  assert.equal(result.summary.warnings, 1);
  assert.ok(result.findings.some(f => f.code === "stale_snapshot"));
  assert.ok(!result.findings.some(f => f.code === "max_age_exceeded"));
});

test("flags insufficient sampled key overlap and rejects ambiguous snapshots", () => {
  const result = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"]), observation(5, ["old", "new"]), observation(10, ["old", "new"]), observation(15, ["new"])
  ]});
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(f => f.code === "insufficient_sampled_overlap"));

  const intermittent = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"]), observation(5, ["old", "new"]), observation(10, ["old"]),
    observation(15, ["old", "new"]), observation(20, ["new"])
  ]});
  assert.ok(intermittent.findings.some(f => f.code === "insufficient_sampled_overlap"));

  const noReplacement = validateJwksCachePolicy({policy, snapshots: [
    observation(0, ["old"]), observation(5, []), observation(10, [])
  ]});
  assert.ok(noReplacement.findings.some(f => f.code === "removed_keys_without_replacement"));

  const duplicate = observation(0, ["same"]);
  duplicate.jwks.keys.push({kid: "same"});
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [duplicate, observation(5, ["same"])]}), /duplicate kid values/);
});

test("rejects empty, overlarge, invalid, and unordered input", () => {
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: []}), /2 to 20/);
  const many = Array.from({length: 21}, (_, i) => observation(i, ["key"]));
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: many}), /2 to 20/);
  assert.throws(() => validateJwksCachePolicy({policy: {...policy, max_age_seconds: -1}, snapshots: [observation(0, ["a"]), observation(1, ["a"])]}), /policy.max_age_seconds/);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(1, ["a"]), observation(0, ["a"])]}), /strictly increasing/);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(0, ["a"]), {...observation(1, ["a"]), observed_at: "January 2, 2026"}]}), /ISO timestamp/);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(0, ["a"]), {...observation(1, ["a"]), observed_at: "2026-02-30T00:00:00Z"}]}), /valid ISO timestamp/);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(0, [""]), observation(1, ["a"])]}), /kid must be/);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(0, ["a"]), observation(1, ["a"])], unused: "x".repeat(262_145)}), /262144 characters/);
  const hundredKeys = Array.from({length: 100}, (_, i) => `key-${i}`);
  assert.equal(validateJwksCachePolicy({policy, snapshots: [observation(0, hundredKeys), observation(1, hundredKeys)]}).ok, true);
  assert.throws(() => validateJwksCachePolicy({policy, snapshots: [observation(0, [...hundredKeys, "key-100"]), observation(1, ["key"])]}), /at most 100 keys/);
});
