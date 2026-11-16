import test from "node:test";
import assert from "node:assert/strict";
import { auditForwardingPolicy, handleRequest, limits } from "./http-forwarding-audit.mjs";

const clean = {
  policy: {
    allowed_headers: ["content-type", "x-request-id", "x-forwarded-for"],
    required_headers: ["x-request-id"],
    never_forward: ["authorization", "cookie"],
    trusted_proxy_headers: ["x-forwarded-for"],
  },
  hops: [
    {
      name: "edge",
      received: { "x-request-id": ["req-7"], "x-forwarded-for": ["198.51.100.9"] },
      forwarded: { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] },
    },
    {
      name: "gateway",
      received: { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] },
      forwarded: { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] },
    },
  ],
};

test("accepts an allowed chain with required headers and overwritten client proxy claims", () => {
  const result = auditForwardingPolicy(clean);
  assert.equal(result.ok, true);
  assert.equal(result.hop_count, 2);
  assert.equal(result.finding_count, 0);
});

test("reports allowlist, required, and never-forward violations without returning values", () => {
  const input = structuredClone(clean);
  input.hops[0].forwarded.authorization = ["Bearer secret-example"];
  input.hops[0].forwarded["x-debug"] = ["trace-secret"];
  delete input.hops[1].forwarded["x-request-id"];
  const result = auditForwardingPolicy(input);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes("forward_not_allowlisted"));
  assert.ok(codes.includes("never_forward_header_forwarded"));
  assert.ok(codes.includes("required_header_missing"));
  assert.equal(JSON.stringify(result).includes("secret-example"), false);
  assert.equal(JSON.stringify(result).includes("trace-secret"), false);
});

test("flags caller-supplied trusted forwarding values that survive the edge", () => {
  const input = structuredClone(clean);
  input.hops[0].forwarded["x-forwarded-for"] = ["198.51.100.9", "203.0.113.18"];
  const result = auditForwardingPolicy(input);
  assert.ok(result.findings.some((item) => item.code === "client_asserted_proxy_header_forwarded"));
});

test("matches header names case-insensitively", () => {
  const input = structuredClone(clean);
  input.hops[0].forwarded = { "X-Request-ID": ["req-7"], "X-Forwarded-For": ["203.0.113.18"] };
  assert.equal(auditForwardingPolicy(input).ok, true);
});

test("rejects empty, malformed, conflicting, and duplicate-name policies", () => {
  assert.throws(() => auditForwardingPolicy({}), /policy/);
  const malformed = structuredClone(clean);
  malformed.hops[0].forwarded["bad header"] = ["x"];
  assert.throws(() => auditForwardingPolicy(malformed), /valid HTTP field name/);
  const conflict = structuredClone(clean);
  conflict.policy.never_forward.push("x-request-id");
  assert.throws(() => auditForwardingPolicy(conflict), /cannot also be allowed/);
  const duplicate = structuredClone(clean);
  duplicate.hops[0].received["X-Request-Id"] = ["other"];
  assert.throws(() => auditForwardingPolicy(duplicate), /duplicate name/);
});

test("enforces hop, value, and control-character bounds", () => {
  assert.equal(limits.maxHops, 8);
  const tooMany = structuredClone(clean);
  tooMany.hops = Array.from({ length: limits.maxHops + 1 }, (_, i) => ({ name: `hop-${i}`, received: {}, forwarded: {} }));
  assert.throws(() => auditForwardingPolicy(tooMany), /1 to 8/);
  const badValue = structuredClone(clean);
  badValue.hops[0].forwarded["x-request-id"] = ["line1\r\nInjected: yes"];
  assert.throws(() => auditForwardingPolicy(badValue), /control character/);
  const longValue = structuredClone(clean);
  longValue.hops[0].forwarded["x-request-id"] = ["x".repeat(limits.maxHeaderValueLength + 1)];
  assert.throws(() => auditForwardingPolicy(longValue), /up to 2048 characters/);
});

test("caps large finding lists while preserving the total count", () => {
  const allowed = Array.from({ length: 64 }, (_, i) => `x-allowed-${i}`);
  const forbidden = Array.from({ length: 32 }, (_, i) => `x-secret-${i}`);
  const input = {
    policy: { allowed_headers: allowed, required_headers: allowed, never_forward: forbidden },
    hops: Array.from({ length: 8 }, (_, i) => ({
      name: `hop-${i}`,
      received: {},
      forwarded: Object.fromEntries([
        ...forbidden.map((name) => [name, ["hidden"]]),
        ...Array.from({ length: 32 }, (__, j) => [`x-unlisted-${j}`, ["hidden"]]),
      ]),
    })),
  };
  const result = auditForwardingPolicy(input);
  assert.equal(result.findings.length, limits.maxFindings);
  assert.equal(result.finding_count, 8 * (64 + 32 + 64));
  assert.equal(result.findings_truncated, true);
});

test("Worker adapter returns bounded and useful HTTP errors", async () => {
  const method = await handleRequest(new Request("https://local/v1/http-forwarding-audit", { method: "GET" }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");

  const badJson = await handleRequest(new Request("https://local/v1/http-forwarding-audit", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }));
  assert.equal(badJson.status, 400);

  const tooLarge = await handleRequest(new Request("https://local/v1/http-forwarding-audit", {
    method: "POST", headers: { "content-type": "application/json" }, body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(limits.maxBodyBytes + 1));
        controller.close();
      },
    }), duplex: "half",
  }));
  assert.equal(tooLarge.status, 413);

  const ok = await handleRequest(new Request("https://local/v1/http-forwarding-audit", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(clean),
  }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
});
