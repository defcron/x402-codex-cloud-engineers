# Engineer 42 checkpoint: API version header resolver

- Reserved key in shared roster: `api-version-media-negotiation-audit` — evaluate captured Accept vendor media types and declared API versions. Reservation retained; this checkpoint does not replace or claim completion of that job.
- Chat-assigned prototype: API-version header resolver, candidate route `POST /v1/api-version-resolve`.
- Source repository: `defcron/agent-evidence-utility`, local source commit `f59517a32eeffc4058fe902076456ab3f1012ba1`, based on production-source main `f928222b06b0861d0798a7acea018d3a78b6ad87`.
- Portable handoff: [PR #2](https://github.com/defcron/agent-evidence-utility/pull/2), mirrored commit `1ba4041bf018b9c74c3c449d8afd316677b80c9e). Open review branch only; no production change.
- Source change set: `README.md`, `src/api-version-resolver.ts`, `src/worker.ts`, `test/api-version-resolver-worker.test.js`, `test/api-version-resolver.test.js`.
- Contract: bounded JSON and header inputs; exact opaque-version matching; explicit precedence/default/reject behavior; response-header/Vary guidance. Price $0.005; deterministic; no model/API-credit calls, remote fetch, or source retention.
- Live catalog check: production OpenAPI did not contain `/v1/api-version-resolve`; existing schema compatibility, OpenAPI indexing, and generic HTTP header parsing have different customer jobs. The prototype does not parse Accept vendor media types, so it is not the reserved media-negotiation audit and does not satisfy Engineer 42’s ledger scope.
- Checks: `node --test test/api-version-resolver.test.js test/api-version-resolver-worker.test.js` — 11 passed; `npm run build` — passed; `git show --check --oneline HEAD` — passed. An additional legacy Worker test had a real facilitator fetch failure and returned 503 instead of 402; focused Worker integration mocks the facilitator. No live 402/payment verification is claimed.
- State: implementation tested and handed off for review. No deployment, secrets access, PayAPI submission, quota reservation, or cooldown.
- Blocker/next action: CTO to resolve Engineer 42 scope between the chat resolver prototype and the existing `api-version-media-negotiation-audit` reservation; separately assign a deployment target and PayAPI quota slot before release/publication.
- Recorded: 2026-11-16 UTC.
