# Superseded prototype: OpenAPI compatibility matrix

> This former concept overlaps the ledger-assigned Engineer 29 whole-OpenAPI compatibility diff. It is preserved for review only and must not be integrated or published as Engineer 28's service. The current #28 service is documented in workstreams/engineer-28-api-version-routing-inspector/README.md.

A deterministic, standalone prototype for comparing complete OpenAPI 3.0/3.1 JSON documents. It returns one matrix row per HTTP method and path and reports likely direction-specific breakages. It has no HTTP server or payment middleware and is not deployed.

## Contract

- Inputs: beforeJson and afterJson strings containing OpenAPI 3.0 or 3.1 JSON; optional direction is backward, forward, or both.
- Output: operation counts and a sorted matrix. Each finding includes the operation key, change, and explanation. Direction both includes backward and forward impacts; selecting one direction also adds impact for that direction. Findings are capped at 200 and expose truncated.
- Direction: backward means an older client using the old contract against the newer API; forward means a newer client contract against the older API.
- Checks: operation additions/removals, newly required operation parameters or request bodies, required request properties, inline parameter/body schema type or enum changes, removed response statuses, removed inline response properties, and unresolved schema references.
- Bounds: each document at most 131,072 characters, 500 paths, 1,000 operations, 20,000 JSON nodes, and depth 64.
- Failures: TypeError for malformed JSON, unsupported versions, invalid operation structures, or direction; RangeError for limits.
- No remote $ref or server URL fetch, persistence, markup/code execution, or model/API calls.

## Example

    import { compareOpenApiVersions } from "./openapi-compatibility.mjs";

    const before = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Inventory", version: "1.0" },
      paths: { "/items": { get: { parameters: [{ in: "query", name: "limit", required: false }], responses: { "200": { description: "OK" } } } } }
    });
    const after = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Inventory", version: "2.0" },
      paths: { "/items": { get: { parameters: [{ in: "query", name: "limit", required: true }], responses: { "200": { description: "OK" } } } } }
    });
    console.log(compareOpenApiVersions(before, after));

The /items row contains parameter:query:limit with backward impact breaking.

## Focused checks

From the repository root:

    node --test prototypes/engineer-28/openapi-compatibility.test.mjs

## Distinctness and limitations

Live catalog inspection found /v1/json-schema-compatibility, which compares two JSON Schema objects, and /v1/openapi-index, which indexes operations in one OpenAPI document. This prototype instead emits a release-level matrix across all operations, including endpoint additions/removals and cross-operation method/path contract changes; it does not wrap either route. The functions still overlap in schema-change analysis, so this is only worth integrating if the end-to-end API preserves the whole-spec release workflow.

This is not a complete OpenAPI compatibility oracle. It does not resolve references or compare component definitions, path-level inherited parameters, security/auth changes, media-type additions/removals, array-item changes, schema composition, formats, bounds, or response-property type changes comprehensively. Results are likely-change indicators, not a guarantee. Do not use for automated release approval without broader conformance tests and explicit inconclusive handling.

## Integration checkpoint

Reservation key: openapi-version-compatibility-matrix; owner: engineer 28. Shared registry was not available in this workspace, so the reservation is recorded branch-locally at reservations/engineer-28-openapi-compatibility-matrix.md. No listing, production edit, deployment, or PayAPI submission has been made.
