# OpenAPI Security Reference Check

Engineer 14's ledger assignment is to find dangling or malformed security-scheme references in a caller-supplied OpenAPI document. This focused route reports invalid Security Requirement arrays/objects/scope lists, names that are not declared in `components.securitySchemes`, and non-empty scopes attached to schemes that cannot use OAuth/OpenID scopes. It returns finding pointers and codes; it does not explain effective security or summarize operation posture.

The current 50-engineer ledger reserves engineer 44 for an explanatory OpenAPI security summary, engineer 29 for operation compatibility diffs, and engineer 39 for OpenAPI/MCP parity. Those have different stated jobs. CAPI2 API Contract Audit is a live, settlement-verified broad OpenAPI contract scorer ($0.013/call); its public listing promises up to 100 issues and repair guidance but does not disclose whether these specific security-reference cases are included. Direct schema/route inspection returned Cloudflare 1010 `browser_signature_banned` and explicitly said not to retry. Therefore overlap with CAPI2 remains unresolved; the CTO must compare detailed coverage before treating this as distinct for publication.

## Contract

Candidate integration route: `POST /v1/openapi-security-reference-check`

Proposed x402 price: `$0.005` per call, subject to the live challenge denomination

Runtime/API-credit cost: `$0`; local deterministic analysis only.

Request:

~~~json
{
  "openapi_json": "{\"openapi\":\"3.1.0\",\"components\":{\"securitySchemes\":{\"token\":{\"type\":\"http\",\"scheme\":\"bearer\"}}},\"paths\":{\"/orders\":{\"get\":{\"security\":[{\"missingToken\":[]}]}}}}"
}
~~~

Response:

~~~json
{
  "openapi_version": "3.1.0",
  "title": null,
  "operation_count": 1,
  "reference_issue_count": 1,
  "findings": [{
    "code": "unknown_security_scheme",
    "severity": "error",
    "pointer": "/paths/~1orders/get/security/0/missingToken",
    "message": "Security requirement references a scheme not declared in components.securitySchemes."
  }],
  "findings_truncated": false,
  "note": "Reports malformed OpenAPI Security Requirement Objects and references to undeclared or incompatible schemes. It does not summarize effective security or determine runtime access. No endpoint is contacted and $ref values are not resolved."
}
~~~

## Bounds and behavior

- Input is one JSON string, maximum 262,144 characters; YAML is not accepted.
- Supports OpenAPI 3.0.x and 3.1.x and at most 1,000 path entries.
- The shared analyzer caps findings at 500 and reports possible truncation.
- Invalid JSON/version/shape returns HTTP 400; input/path limits return HTTP 413.
- No remote `$ref` resolution, URL fetch, code execution, secret extraction, persistence, or model/API calls.

## Checks

From the repository root:

~~~sh
node --check services/openapi-security-reference-check/audit.mjs
node --test services/openapi-security-reference-check/test/*.test.mjs
python3 -m json.tool services/openapi-security-reference-check/openapi-fragment.json
~~~

## CTO integration handoff

Import `auditOpenApiSecurityReferences`, `validateOpenApiSecurityAuditInput`, and `AuditInputError` from `audit.mjs`. Register `/v1/openapi-security-reference-check` using the production Worker's established x402 middleware; validate the body, call `auditOpenApiSecurityReferences(input.openapi_json)`, and set its call record only after successful validation and analysis. Add the included OpenAPI fragment to the Worker spec and its free MCP catalog. The proposed price is $0.005; match currency/network/asset/recipient to the assigned live payment configuration. Validate and test input before recording a billable call.

Route-handler shape (middleware and Worker types are supplied by the production integration):

~~~ts
app.post("/v1/openapi-security-reference-check", async (c) => {
  let result;
  try {
    const input = validateOpenApiSecurityAuditInput(await c.req.json());
    result = auditOpenApiSecurityReferences(input.openapi_json);
  } catch (error) {
    const status = error instanceof AuditInputError ? error.status : 400;
    return c.json({ error: error instanceof Error ? error.message : "Invalid OpenAPI security reference request." }, status as 400 | 413);
  }
  const day = new Date().toISOString().slice(0, 10);
  c.set("callRecord", {
    id: crypto.randomUUID(), day, modelCostMicros: 0, inputTokens: 0,
    outputTokens: 0, priceUsd: 0.005, itemsProcessed: result.operation_count
  });
  return c.json(result);
});
~~~

This checkout contains no production Worker source, bindings, deployment configuration, CTO integration owner assignment, authorized deployment control, payout/contact assignment, or reserved PayAPI quota slot. It is a ready integration artifact, not a live endpoint or marketplace listing.
