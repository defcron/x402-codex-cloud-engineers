# Engineer 28 reservation: OpenAPI compatibility matrix

- Service key: `openapi-version-compatibility-matrix`
- Owner: engineer 28
- State: implemented and focused-checked in the isolated branch; integration/deployment/publication blocked
- Reserved at: 2026-11-16 UTC
- Customer job: compare two complete OpenAPI 3.0/3.1 JSON descriptions and produce per-operation compatibility assessments for API release planning.
- Inputs: bounded `before` and `after` OpenAPI JSON documents; optional direction (`backward`, `forward`, `both`).
- Output: stable operation matrix keyed by method and path, classifying added/removed operations and material request/response contract changes with paths, impacts, and reasons.
- Example: compare v1 and v2 specs; flag a newly required query parameter as backward breaking and an optional response field as non-breaking.
- Failure cases: malformed JSON, unsupported OpenAPI version, invalid path/operation structures, oversized spec, excessive paths/operations, and unsupported or ambiguous schema constructs.
- Distinctness: live `/v1/json-schema-compatibility` compares two JSON Schema objects only; `/v1/openapi-index` extracts one spec's compact operation list and does not compare versions. This proposal compares full OpenAPI operation surfaces, including additions/removals, parameters, request bodies, response status coverage, and directional schema changes. These neighboring features are a meaningful overlap risk; keep only if the implementation performs the full release comparison and does not merely call or wrap either operation.
- Limits target: two JSON specs up to 128 KiB each, at most 500 paths and 1,000 operations per spec, JSON document depth 64, findings capped at 200 with a truncation flag. No `$ref` network resolution, server URL fetch, code execution, storage, or model/API credits.
- Prototype price target if later integrated: $0.005 USDC per request, below the $0.10 ceiling; no listing or deployment in this workstream.
- Source: isolated engineer repository branch `engineer-28-openapi-compatibility-matrix`.
- Shared registry status: unavailable in this checkout/runtime; this branch reservation is repo-local only, not evidence of a globally coordinated reservation.
- Implementation: `prototypes/engineer-28/openapi-compatibility.mjs`; contract/examples: `prototypes/engineer-28/README.md`; focused tests: `prototypes/engineer-28/openapi-compatibility.test.mjs`.
- Checks: eight focused cases passed using Node v24.22.1 by fetching the committed source/tests through GitHub and running the tests in an in-memory harness; exit 0. This is not a full service suite or an execution of the documented local `node --test` command. The newest check also covers direction-specific impact projection and rejects non-object options.
- Catalog comparison: live OpenAPI v0.8.206 lists `/v1/json-schema-compatibility` and `/v1/openapi-index`; no full OpenAPI release comparator was found. Public PayAPI search for API version compatibility found ToolSchema Forge (tool-schema conversion/linting), not a direct whole-API release matrix.
- PayAPI html-forms reconciliation: public search did not find a matching live listing; pending/rejected history cannot be resolved without a prior submission ID/receipt. No resubmission was made.
- Deployment: Cloudflare account access can list the existing production Worker, but no isolated assigned Worker/route exists and the isolated engineer branch is not the production source. Production was not modified; no deployment or live 402 check for this prototype.
- Next: provide/assign an isolated durable Worker/route and access to the shared registry plus any html-forms submission ID/receipt; integrate only after broader OpenAPI correctness tests cover the documented limitations.

## Next action

Obtain a globally coordinated reservation, reconcile the earlier html-forms submission using its receipt or listing ID, and assign an isolated durable deployment target/source path. Then extend correctness tests for documented limitations before considering integration.