# OpenAPI operation compatibility diff

**Customer job:** compare an earlier OpenAPI 3.0/3.1 JSON document with a proposed version and get a compact report of likely breaking operation, parameter, request-body, and response-contract changes.

**Distinctness against the live catalog:** `/v1/openapi-index` indexes one document; `/v1/json-schema-compatibility` compares isolated JSON Schema objects; `/v1/json-diff` compares arbitrary JSON values. This artifact compares operations and request/response contracts across two full OpenAPI documents. Ledger distinction: Engineer 28 inspects a captured request to identify version selection and route match; Engineer 29 compares API contract revisions. Engineers 14/44 inspect security references/requirements, Engineer 39 checks OpenAPI-to-MCP parity, Engineer 36 audits reference graphs, Engineer 35 validates declared data formats, and Engineer 22 compares GraphQL SDL. Those jobs do not compare OpenAPI operation revisions for caller compatibility. The live catalog has adjacent single-document indexing and isolated JSON Schema compatibility routes; none of those performs this full-document operation comparison. Other reservations still require reconciliation before integration/publication.

## Contract

- Suggested route: `POST /v1/openapi-operation-compatibility-diff`; proposed price: `$0.005 USDC`, matching neighboring deterministic catalog services. Runtime model/API credit cost: `$0`.
- Request: exact fields `before_openapi_json`, `after_openapi_json`, each a non-empty string. The validator rejects extra properties.

Request JSON Schema (the combined length and raw-body caps are enforced by code):

```json
{
  "type": "object",
  "required": ["before_openapi_json", "after_openapi_json"],
  "additionalProperties": false,
  "properties": {
    "before_openapi_json": { "type": "string", "minLength": 1, "maxLength": 262144 },
    "after_openapi_json": { "type": "string", "minLength": 1, "maxLength": 262144 }
  }
}
```
- Bounds: raw HTTP body at most 4 MiB (streamed with cancellation on overflow); each document at most 262,144 UTF-16 code units, combined at most 524,288 UTF-16 code units, at most 1,000 paths per document, findings capped at 200. Accepts OpenAPI 3.0/3.1 documents that include `info` and `paths`.
- Output: `assessment`, `operations_compared`, `breaking_change_count`, `inconclusive_change_count`, `truncated`, structured changes (`direction`, `path`, `category`, `impact`, `detail`), and a caveat note.
- Error cases: malformed or invalid-UTF-8 JSON, non-OpenAPI-3.0/3.1 input, missing `info`/`paths`, unknown request fields, raw bodies over 4 MiB, and document/path bounds return HTTP 400 or 413.
- Limits: no network fetches, external `$ref` resolution, execution of input, or source retention. Changed composition, pattern, format, reference, top-level/operation server or security sections, and over-depth constructs are marked inconclusive; this is a deterministic heuristic, not a complete compatibility proof. API gateway/path templating or security-scheme semantic changes are not currently analyzed.

### Example

The two request fields contain serialized OpenAPI documents:

```json
{
  "before_openapi_json": "{\"openapi\":\"3.1.0\",\"info\":{\"title\":\"Orders\",\"version\":\"1\"},\"paths\":{\"/orders\":{\"post\":{\"responses\":{\"201\":{\"description\":\"created\"}}}}}}",
  "after_openapi_json": "{\"openapi\":\"3.1.0\",\"info\":{\"title\":\"Orders\",\"version\":\"2\"},\"paths\":{}}"
}
```

Example response:

```json
{
  "assessment": "breaking_changes_detected",
  "operations_compared": 1,
  "breaking_change_count": 1,
  "inconclusive_change_count": 0,
  "truncated": false,
  "changes": [
    {
      "direction": "backward",
      "path": "POST /orders",
      "category": "operation_removed",
      "impact": "breaking",
      "detail": "The operation was removed."
    }
  ],
  "note": "Deterministic common-change analysis only. References are not resolved; changed composition, pattern, format, servers, or security may be inconclusive. Review the full contract before release."
}
```

## Focused check

From this directory:

```sh
node --experimental-strip-types --test openapi-diff.test.mjs
```

## Integration handoff

`openapi-diff.ts` exports `handleOpenApiDiffRequestStream`, a bounded Worker adapter returning `{ status, body, itemsProcessed }`; it also exports the parsed-request adapter, pure comparator, validator, `OPENAPI_DIFF_INPUT_SCHEMA`, and `OPENAPI_DIFF_OUTPUT_SCHEMA`. In the existing Hono Worker route (after the shared x402 payment middleware), the route handler is:

```ts
import {
  handleOpenApiDiffRequest, handleOpenApiDiffRequestStream, OPENAPI_DIFF_INPUT_SCHEMA,
  OPENAPI_DIFF_OUTPUT_SCHEMA, OPENAPI_DIFF_PRICE_USD,
} from "./openapi-diff.js";

app.post("/v1/openapi-operation-compatibility-diff", async (c) => {
  const result = await handleOpenApiDiffRequestStream(c.req.raw.body);
  if (result.status === 200) {
    const day = new Date().toISOString().slice(0, 10);
    c.set("callRecord", {
      id: crypto.randomUUID(), day, modelCostMicros: 0, inputTokens: 0, outputTokens: 0,
      priceUsd: OPENAPI_DIFF_PRICE_USD, itemsProcessed: result.itemsProcessed,
    });
  }
  return c.json(result.body, result.status);
});
```

Declare the discovery sample with the existing utility:

```ts
const openApiOperationCompatibilityDiffSample = {
  before_openapi_json: JSON.stringify({
    openapi: "3.1.0", info: { title: "Orders", version: "1" },
    paths: { "/orders": { post: { responses: { "201": { description: "created" } } } } },
  }),
  after_openapi_json: JSON.stringify({ openapi: "3.1.0", info: { title: "Orders", version: "2" }, paths: {} }),
};
const openApiOperationCompatibilityDiffBazaar = declareDiscoveryExtension({
  bodyType: "json",
  inputSchema: OPENAPI_DIFF_INPUT_SCHEMA,
  input: openApiOperationCompatibilityDiffSample,
  output: { example: handleOpenApiDiffRequest(openApiOperationCompatibilityDiffSample).body },
});
```

In the existing paid-service registry, use the project's established shape:

```ts
"POST /v1/openapi-operation-compatibility-diff": {
  accepts: exactEvmAccepts(OPENAPI_DIFF_PRICE_USD.toFixed(3), env.PAY_TO),
  description: "Compare two bounded OpenAPI 3.0/3.1 documents for likely backward and forward breaking operation-contract changes. No external references or model calls.",
  mimeType: "application/json",
  serviceName: "OpenAPI Operation Compatibility Diff",
  tags: ["openapi", "api-compatibility", "breaking-changes", "no-model"],
  extensions: openApiOperationCompatibilityDiffBazaar,
}
```

For generated OpenAPI, use `jsonBody(OPENAPI_DIFF_INPUT_SCHEMA)` and the `OPENAPI_DIFF_OUTPUT_SCHEMA` for the 200 response, with 400/402/413 descriptions. The corresponding offer metadata should use `method: "POST"`, `endpoint: "/v1/openapi-operation-compatibility-diff"`, `price_usdc: OPENAPI_DIFF_PRICE_USD`, `deterministic: true`, `model_calls: 0`, and `networks: EVM_PAYMENT_NETWORKS`. Add the request/response schema and public example to the generated discovery/OpenAPI documents. This reuses the current payment flow and authorized `PAY_TO`; the integration owner must implement and verify the live route, discovery, example, and unpaid 402 challenge before any PayAPI submission. No shared Worker files, secrets, deployment, or marketplace submissions were changed by this workstream.
