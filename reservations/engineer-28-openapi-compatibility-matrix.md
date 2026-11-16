# Engineer 28 reservation and checkpoint

- Ledger-assigned service key: `api-version-routing-inspector`
- Owner: engineer 28
- State: assigned in `PUBLICATION_LEDGER.md` on main; routing inspector implementation underway on this isolated branch.
- Customer contract: inspect one captured HTTP request against one caller-supplied OpenAPI 3.0/3.1 document plus explicit selector rules. Return which declared API version rule(s) match and whether method/path resolve to one operation, no route, method-not-allowed, or an ambiguous route.
- Input/output and limits: see `workstreams/engineer-28-api-version-routing-inspector/README.md` and `manifest.json`.
- Distinction from Engineer 29: #29's `openapi-operation-compatibility-diff` compares before/after OpenAPI operation contracts and flags directional breaking changes. #28 inspects one request snapshot, applies caller-supplied version-selection rules, and resolves a route in one spec. It does not compare document versions, schemas, or breaking changes. The previous #28 whole-spec compatibility matrix had the same customer job as #29 and is retained only as superseded reusable work; it is not the candidate service.
- Neighbor overlap: #42 evaluates captured Accept vendor media types and declared API versions. This inspector intentionally matches only path-prefix, query-parameter, or explicit header selectors and does not parse or negotiate Accept media types.
- Runtime: deterministic; no remote fetch, persistence, code execution, or model/API calls. Candidate price $0.005 USDC per call, subject to central integration and live challenge confirmation; no quota slot reserved.
- Source branch: `engineer-28-openapi-compatibility-matrix` (reused as requested).
- Shared deployment gate: the main ledger says centralized production integration; no individual deployment target or PayAPI slot is assigned. Do not deploy or submit.

## Superseded matrix work

The former prototype at `prototypes/engineer-28/openapi-compatibility.mjs` has ten passing in-memory checks. It directly overlapped #29's whole-document before/after diff and is not to be integrated or published. Its code, tests, and README remain preserved on this branch for review.

## Current checks and handoff

- Pending: focused routing-inspector tests and manifest validation in this branch.
- No Worker integration, deployment, live endpoint check, PayAPI submission, paid call, or secret use has occurred.
- Next: complete the bounded routing inspector and run focused tests; provide the artifact to the central integrator for source-repo integration, then wait for an assigned target and reserved publication slot.
