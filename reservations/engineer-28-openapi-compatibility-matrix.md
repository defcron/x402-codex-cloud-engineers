# Engineer 28 reservation: OpenAPI compatibility matrix

- Service key: `openapi-version-compatibility-matrix`
- Owner: engineer 28
- State: reserved; prototype pending
- Reserved at: 2026-11-16 UTC
- Customer job: compare two complete OpenAPI 3.0/3.1 JSON descriptions and produce per-operation compatibility assessments for API release planning.
- Inputs: bounded `before` and `after` OpenAPI JSON documents; optional direction (`backward`, `forward`, `both`).
- Output: stable operation matrix keyed by method and path, classifying added/removed operations and material request/response contract changes with paths, impacts, and reasons.
- Example: compare v1 and v2 specs; flag a newly required query parameter as backward breaking and an optional response field as non-breaking.
- Failure cases: malformed JSON, unsupported OpenAPI version, duplicate/invalid operation keys, oversized spec, excessive paths/operations, and unsupported or ambiguous schema constructs.
- Distinctness: live `/v1/json-schema-compatibility` compares two JSON Schema objects only; `/v1/openapi-index` extracts one spec's compact operation list and does not compare versions. This proposal compares full OpenAPI operation surfaces, including additions/removals, parameters, request bodies, response status coverage, and directional schema changes. These neighboring features are a meaningful overlap risk; keep only if the implementation performs the full release comparison and does not merely call or wrap either operation.
- Limits target: two JSON specs up to 128 KiB each, at most 500 paths and 1,000 operations per spec, schema comparison depth 24, findings capped at 200 with a truncation flag. No `$ref` network resolution, server URL fetch, code execution, storage, or model/API credits.
- Prototype price target if later integrated: $0.005 USDC per request, below the $0.10 ceiling; no listing or deployment in this workstream.
- Source: isolated engineer repository branch `engineer-28-openapi-compatibility-matrix`.
- Shared registry status: unavailable in this checkout/runtime; this branch reservation is the available repo-local checkpoint and is not evidence of a globally coordinated reservation.

## Next action

Build a standalone deterministic prototype with focused tests in this isolated branch. Before implementation, recheck the live route inventory; if an equivalent full OpenAPI release comparator exists, retain reusable work only and choose another service.