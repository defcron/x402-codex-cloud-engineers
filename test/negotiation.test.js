import test from "node:test";
import assert from "node:assert/strict";
import worker, { auditNegotiation, negotiate } from "../src/index.js";
test("chooses the highest quality match", () => {
  assert.equal(negotiate("text/html;q=0.4, application/json;q=0.9", ["text/html", "application/json"]).selected, "application/json");
});
test("a specific zero quality range overrides wildcard acceptance", () => {
  assert.equal(negotiate("text/*;q=0.8, text/html;q=0, */*;q=0.2", ["text/html", "text/plain"]).selected, "text/plain");
});
test("media-type specificity outranks parameter count on broader wildcards", () => {
  const result = auditNegotiation('*/*;a="1";b="2";q=1, text/*;q=0.5, text/plain;q=0.2',
    'text/plain;a="1";b="2"');
  assert.equal(result.quality, 0.2);
  assert.equal(result.matched_range.type, "text");
  assert.equal(result.matched_range.subtype, "plain");
});
test("matches media parameters and applies range specificity", () => {
  assert.equal(negotiate('text/plain;format=flowed;q=0.9, text/plain;q=0.5', ["text/plain", "text/plain;format=flowed"]).selected, "text/plain;format=flowed");
});
test("matches charset case-insensitively and preserves quoted separators", () => {
  assert.equal(negotiate('text/plain;charset="UTF-8";profile="a;b";q=0.7', [
    'text/plain;charset=utf-8;profile="a;b"',
  ]).selected, 'text/plain;charset=utf-8;profile="a;b"');
});
test("missing Accept accepts all and preserves offer order on ties", () => {
  assert.equal(negotiate(undefined, ["application/json", "text/plain"]).selected, "application/json");
});
test("returns no selection when no offered type is acceptable", () => {
  assert.equal(negotiate("image/png", ["application/json"]).selected, null);
});
test("audits an acceptable captured Accept and Content-Type pair", () => {
  assert.deepEqual(auditNegotiation("application/json, text/*;q=0.5", "application/json"), {
    content_type: "application/json",
    acceptable: true,
    quality: 1,
    matched_range: { type: "application", subtype: "json", parameters: {}, specificity: { type: 1, subtype: 1, parameters: 0 } },
    reason: "acceptable",
  });
});
test("a specific q=0 range flags an actual response as unacceptable", () => {
  const result = auditNegotiation("text/*;q=0.8, text/html;q=0, */*;q=0.2", "text/html");
  assert.equal(result.acceptable, false);
  assert.equal(result.quality, 0);
  assert.equal(result.reason, "quality_zero");
  assert.equal(result.matched_range.subtype, "html");
});
test("flags a Content-Type with no matching Accept range", () => {
  const result = auditNegotiation("application/json", "text/html");
  assert.equal(result.acceptable, false);
  assert.equal(result.reason, "no_matching_range");
  assert.equal(result.matched_range, null);
});
test("an absent Accept header permits any Content-Type", () => {
  assert.deepEqual(auditNegotiation(undefined, "application/octet-stream"), {
    content_type: "application/octet-stream",
    acceptable: true,
    quality: 1,
    matched_range: null,
    reason: "accept_header_absent",
  });
});
test("audits parameterized Content-Type using charset case-insensitively", () => {
  const result = auditNegotiation('text/plain;charset="UTF-8";profile="a;b";q=0.7',
    'text/plain;charset=utf-8;profile="a;b"');
  assert.equal(result.acceptable, true);
  assert.equal(result.quality, 0.7);
  assert.deepEqual(result.matched_range.parameters, { charset: "UTF-8", profile: "a;b" });
});
test("recognizes q as weight even when a media parameter follows it", () => {
  const result = auditNegotiation("text/plain;q=0.8;charset=UTF-8", "text/plain;charset=utf-8");
  assert.equal(result.acceptable, true);
  assert.equal(result.quality, 0.8);
  assert.deepEqual(result.matched_range.parameters, { charset: "UTF-8" });
});
test("rejects invalid q values and offered media types", () => {
  assert.throws(() => negotiate("text/plain;q=1.2", ["text/plain"]), TypeError);
  assert.throws(() => negotiate("*/*", ["text"]), TypeError);
  assert.throws(() => negotiate('text/plain;profile="broken"value', ["text/plain"]), TypeError);
});
test("enforces header and offer bounds and rejects control characters", () => {
  assert.throws(() => negotiate("a".repeat(4097), ["text/plain"]), TypeError);
  assert.throws(() => negotiate("text/plain\r\nX-Evil: yes", ["text/plain"]), TypeError);
  assert.throws(() => negotiate("*/*", Array(33).fill("text/plain")), TypeError);
  assert.throws(() => negotiate("*/*", ["text/plain\n"] ), TypeError);
});
test("HTTP endpoint returns JSON pair-audit result", async () => {
  const response = await worker.fetch(new Request("https://example.test/audit", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept: "application/json", content_type: "application/json" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    content_type: "application/json", acceptable: true, quality: 1,
    matched_range: { type: "application", subtype: "json", parameters: {}, specificity: { type: 1, subtype: 1, parameters: 0 } },
    reason: "acceptable",
  });
});
test("HTTP endpoint rejects oversized and malformed bodies", async () => {
  const tooLarge = await worker.fetch(new Request("https://example.test/audit", {
    method: "POST", body: " ".repeat(16_385),
  }));
  assert.equal(tooLarge.status, 413);
  const malformed = await worker.fetch(new Request("https://example.test/audit", {
    method: "POST", body: "{",
  }));
  assert.equal(malformed.status, 400);
});
