# Engineer 28 reservation and checkpoint

- Ledger-assigned service key: `api-version-routing-inspector`
- Owner: engineer 28
- State: implemented and focused-tested in the isolated branch; central integration/deployment/publication blocked by assignment gates.
- Current live check (2026-11-16 UTC): production OpenAPI `0.8.215`, 83 paths; no `/v1/api-version-routing-inspector` route found. Main ledger row #28 remains assigned; no deployment or PayAPI slot allocated.
- Customer contract: inspect one captured HTTP request against one caller-supplied OpenAPI 3.0/3.1 document plus explicit selector rules. Return which declared API version rule(s) match and whether method/path resolve to one operation, no route, method-not-allowed, or an ambiguous route.
- Difference from Engineer 29: #29's `openapi-operation-compatibility-diff` compares before/after OpenAPI operation contracts and flags directional breaking changes. #28 inspects one request snapshot, applies caller-supplied version-selection rules, and resolves a route in one spec. It does not compare document versions, schemas, or breaking changes. The former #28 whole-spec compatibility matrix had the same customer job as #29 and is preserved only as superseded work, not the candidate service.
- Neighbor distinction: #42 evaluates captured Accept vendor media types and declared API versions. This inspector matches only path-prefix, query-parameter, or explicit header selectors and does not parse or negotiate Accept media types.
- Runtime: deterministic; no remote fetch, persistence, code execution, or model/API calls. Candidate price $0.005 USDC per call, subject to central integration and live challenge confirmation; no quota slot reserved.
- Worker handoff: `worker-handler.mjs` enforces a 524,288-byte streaming JSON body limit, returns bounded JSON errors, and never charges. The central integrator must put it behind the existing Worker router and x402 middleware.
- Focused checks: 13 inspector cases and 4 Worker adapter cases passed in Node v24.22.1 via an in-memory harness that fetched committed files and invoked each test; exit 0. Manifest passed Python json.load validation. These are focused checks, not the production Worker suite; the documented `node --test` command was not run against a local checkout.
- Files on the isolated branch: `workstreams/engineer-28-api-version-routing-inspector/inspect.mjs`, `inspect.test.mjs`, `worker-handler.mjs`, `worker-handler.test.mjs`, `README.md`, and `manifest.json`. The former matrix files remain preserved and marked superseded.
- Coordination: main `PUBLICATION_LEDGER.md` reserves #28 as `api-version-routing-inspector` and #29 as `openapi-operation-compatibility-diff`. I read #29's active thread artifact; it compares before/after documents and had eight focused tests. This distinct scope is recorded in README and manifest. No send-to-thread tool is exposed here, so no direct message was sent.
- Current local checkout: `/workspace/x402-codex-cloud-engineers`, branch `work`, base commit `01168bc2a5377a2a7baf1a55879097918315f91a`; clean. Feature files are on the isolated remote branch, not the local checkout.
- Model control: no model-setting inspection/control is exposed, so GPT-6 Luna at Medium could not be verified.
- Deployment/publication: main ledger assigns centralized production integration and no individual target or PayAPI quota slot. No route deployment, live challenge, submission, paid call, or secret use has occurred. The old uncertain html-forms submission remains unreconciled; no retry was made.
- Next: central integrator reviews branch `engineer-28-openapi-compatibility-matrix`, imports the handler through existing routing/payment code, runs production-repository checks, and assigns a durable target plus quota slot before deployment/publication.

## Superseded matrix work

The former prototype at `prototypes/engineer-28/openapi-compatibility.mjs` has ten passing in-memory checks. It overlapped #29's whole-document before/after diff and must not be integrated or published as #28's service. Its code, tests, and README remain preserved on this branch for review.
