# Engineer 28 reservation and checkpoint

- Ledger-assigned service key: `api-version-routing-inspector`
- Owner: engineer 28
- State: implemented and focused-tested in the isolated branch; central integration/deployment/publication blocked by assignment gates.
- Customer contract: inspect one captured HTTP request against one caller-supplied OpenAPI 3.0/3.1 document plus explicit selector rules. Return which declared API version rule(s) match and whether method/path resolve to one operation, no route, method-not-allowed, or an ambiguous route.
- Difference from Engineer 29: #29's `openapi-operation-compatibility-diff` compares before/after OpenAPI operation contracts and flags directional breaking changes. #28 inspects one request snapshot, applies caller-supplied version-selection rules, and resolves a route in one spec. It does not compare document versions, schemas, or breaking changes. The former #28 whole-spec compatibility matrix had the same customer job as #29 and is preserved only as superseded work, not the candidate service.
- Neighbor distinction: #42 evaluates captured Accept vendor media types and declared API versions. This inspector matches only path-prefix, query-parameter, or explicit header selectors and does not parse or negotiate Accept media types.
- Runtime: deterministic; no remote fetch, persistence, code execution, or model/API calls. Candidate price $0.005 USDC per call, subject to central integration and live challenge confirmation; no quota slot reserved.
- Source branch: `engineer-28-openapi-compatibility-matrix` (reused; no replacement branch).
- Branch artifact: `workstreams/engineer-28-api-version-routing-inspector/`.
- Worker handoff: `worker-handler.mjs` implements bounded JSON HTTP handling only. The central integrator must place it behind the existing Worker router and x402 payment middleware; it does not create a payment flow.
- Focused checks: 12 inspector cases and 4 Worker adapter cases passed in Node v24.22.1 via an in-memory harness that fetched the committed branch files and invoked each test; exit 0. `manifest.json` parsed successfully with Python json.load. These are focused checks, not a full Worker suite, and the documented `node --test` command was not run against a local checkout.
- Coordination: main `PUBLICATION_LEDGER.md` reserves #28 as `api-version-routing-inspector` and #29 as `openapi-operation-compatibility-diff`. I read #29's current thread artifact, which compares before/after documents and had eight focused tests. This distinct scope is recorded above and in the README/manifest. No send-to-thread tool is exposed here, so I could not send #29 a direct message.
- Current local checkout: `/workspace/x402-codex-cloud-engineers`, branch `work`, base commit `01168bc2a5377a2a7baf1a55879097918315f91a`; clean. The feature files are on the isolated remote branch, not in that local checkout.
- Saved environment evidence from the prior status check: a saved config named `x402-codex-cloud-engineers` exists, but this chat's current task status did not map its opaque source configuration ID to that saved config. This task has not been retargeted.
- Model control: no setting/inspection tool is exposed here, so GPT-6 Luna at Medium could not be verified.
- Deployment/publication: ledger assigns centralized production integration and no individual target or PayAPI quota slot. No route deployment, live challenge, submission, paid call, or secret use has occurred. The old uncertain html-forms submission remains unreconciled; no retry was made.
- Next: central integrator reviews branch artifact, imports handler through existing routing/payment code, runs production-repo checks, and assigns a durable target plus quota slot before deployment/publication.

## Superseded matrix work

The former prototype at `prototypes/engineer-28/openapi-compatibility.mjs` has ten passing in-memory checks. It overlapped #29's whole-document before/after diff and must not be integrated or published as #28's service. Its code, tests, and README remain preserved on this branch for review.
