import test from "node:test";
import assert from "node:assert/strict";
import {
  AuditInputError,
  auditOpenApiSecurity,
  auditOpenApiSecurityReferences,
  validateOpenApiSecurityAuditInput
} from "../audit.mjs";

const json = (doc) => JSON.stringify(doc);

test("inherits root security and honors an explicit empty operation override", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.0", info: { title: "Example" },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths: { "/private": { get: { operationId: "readPrivate" } },
      "/public": { post: { security: [], summary: "Public webhook" } } }
  }));
  assert.equal(result.operation_count, 2);
  assert.equal(result.counts.protected, 1);
  assert.equal(result.counts.explicitly_public, 1);
  assert.deepEqual(result.operations.map((x) => x.security_mode), ["required", "allows_anonymous"]);
  assert.equal(result.operations[0].security_source, "root_inherited");
  assert.equal(result.operations[1].security_source, "operation_override");
  assert.ok(result.findings.some((x) => x.code === "operation_explicitly_allows_anonymous"));
});

test("reports OR alternatives that include anonymous access", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.0.3", info: {},
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    paths: { "/either": { get: { security: [{}, { key: [] }] } } }
  }));
  assert.equal(result.counts.allows_anonymous, 1);
  assert.equal(result.operations[0].requirements.length, 2);
  assert.ok(result.findings.some((x) => x.code === "security_has_anonymous_alternative"));
});

test("finds unknown schemes and scopes attached to non-OAuth schemes", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.1", info: {},
    components: { securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-Key" } } },
    paths: { "/unknown": { get: { security: [{ missing: [] }] } },
      "/bad-scope": { post: { security: [{ apiKey: ["write"] }] } } }
  }));
  assert.equal(result.counts.unresolved_scheme_references, 1);
  assert.ok(result.findings.some((x) => x.code === "unknown_security_scheme"));
  assert.ok(result.findings.some((x) => x.code === "scopes_on_non_oauth_scheme"));
  assert.equal(result.counts.invalid_security, 2);
});

test("reports no effective security and unused schemes", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.0", info: {},
    components: { securitySchemes: { unused: { type: "http", scheme: "bearer" } } },
    paths: { "/health": { get: {} } }
  }));
  assert.equal(result.counts.allows_anonymous, 1);
  assert.deepEqual(result.unused_security_schemes, ["unused"]);
  assert.ok(result.findings.some((x) => x.code === "operation_has_no_security"));
});

test("rejects empty, malformed, unsupported, oversized, and excessive-path inputs", () => {
  const invalid = [
    ["", "invalid_input"], ["{", "invalid_json"],
    [json({ openapi: "2.0", paths: {} }), "unsupported_version"],
    [json({ openapi: "3.1.0", paths: [] }), "invalid_paths"],
    [" ".repeat(262145), "spec_too_large"],
    [json({ openapi: "3.1.0", paths: Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => ["/p" + i, {}])) }), "too_many_paths"]
  ];
  for (const [input, code] of invalid)
    assert.throws(() => auditOpenApiSecurity(input),
      (error) => error instanceof AuditInputError && error.code === code);
});

test("bounds operation details while preserving counts", () => {
  const paths = Object.fromEntries(Array.from({ length: 251 }, (_, i) => ["/p" + i, { get: {} }]));
  const result = auditOpenApiSecurity(json({ openapi: "3.1.0", info: {}, paths }));
  assert.equal(result.operation_count, 251);
  assert.equal(result.returned_operations, 250);
  assert.equal(result.truncated, true);
});

test("ignores path-item metadata and non-HTTP extension keys", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.0", info: {},
    paths: { "/x": { parameters: [], "x-private": {}, get: {} } }
  }));
  assert.equal(result.operation_count, 1);
});


test("does not misclassify unresolved referenced security schemes as non-OAuth", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.0", info: {},
    components: { securitySchemes: { delegated: { "$ref": "#/components/securitySchemes/base" } } },
    paths: { "/delegated": { get: { security: [{ delegated: ["read"] }] } } }
  }));
  assert.equal(result.counts.invalid_security, 0);
  assert.equal(result.operations[0].security_mode, "required");
  assert.ok(!result.findings.some((x) => x.code === "scopes_on_non_oauth_scheme"));
});


test("reports declared x402 payment separately from OpenAPI security", () => {
  const result = auditOpenApiSecurity(json({
    openapi: "3.1.0", info: {},
    paths: { "/paid": { post: { "x-payment-info": { protocols: ["x402"] } } } }
  }));
  assert.equal(result.counts.payment_extension_declared, 1);
  assert.equal(result.operations[0].security_mode, "allows_anonymous");
  assert.deepEqual(result.operations[0].declared_payment_protocols, ["x402"]);
  assert.match(result.note, /not proof that the live endpoint accepts anonymous calls/);
});


test("validates the route body strictly and marks size failures as 413", () => {
  const body = { openapi_json: "{\"openapi\":\"3.1.0\",\"paths\":{}}" };
  assert.deepEqual(validateOpenApiSecurityAuditInput(body), body);
  assert.throws(() => validateOpenApiSecurityAuditInput({ ...body, extra: true }),
    (error) => error instanceof AuditInputError && error.code === "invalid_input" && error.status === 400);
  assert.throws(() => validateOpenApiSecurityAuditInput({ openapi_json: " ".repeat(262145) }),
    (error) => error instanceof AuditInputError && error.code === "spec_too_large" && error.status === 413);
});

test("reference-check output excludes posture/explanation findings", () => {
  const result = auditOpenApiSecurityReferences(json({
    openapi: "3.1.0", info: { title: "Reference fixture" },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths: {
      "/private": { get: { security: [{ missing: [] }] } },
      "/public": { get: { security: [] } }
    }
  }));
  assert.equal(result.operation_count, 2);
  assert.equal(result.reference_issue_count, 1);
  assert.deepEqual(result.findings.map((finding) => finding.code), ["unknown_security_scheme"]);
  assert.ok(!Object.hasOwn(result, "operations"));
  assert.ok(!Object.hasOwn(result, "counts"));
  assert.match(result.note, /does not summarize effective security/);
});

test("reference-check reports malformed containers, scope values, and incompatible scopes", () => {
  const result = auditOpenApiSecurityReferences(json({
    openapi: "3.0.3", info: {},
    components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-Key" } } },
    paths: {
      "/array": { get: { security: { key: [] } } },
      "/requirement": { get: { security: [null] } },
      "/scope-list": { get: { security: [{ key: "read" }] } },
      "/scope-type": { get: { security: [{ key: ["read"] }] } },
      "/dangling": { get: { security: [{ missing: [] }] } },
      "/public": { get: { security: [] } }
    }
  }));
  assert.equal(result.operation_count, 6);
  assert.equal(result.reference_issue_count, 5);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.code)), new Set([
    "invalid_security_array",
    "invalid_security_requirement",
    "invalid_security_scopes",
    "scopes_on_non_oauth_scheme",
    "unknown_security_scheme"
  ]));
  assert.ok(result.findings.every((finding) => finding.severity === "error"));
  assert.ok(!result.findings.some((finding) => finding.code.includes("anonymous")));
});
