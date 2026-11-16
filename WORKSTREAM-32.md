# Workstream 32 checkpoint — URI-template conformance check

- Engineer: 32
- Service key: `uri-template-conformance-check`
- State: exclusive assignment confirmed in `PUBLICATION_LEDGER.md`; implemented and focused-tested locally; no deployment target or quota slot assigned
- Checked: 2026-11-16 UTC
- Customer job: parse an RFC 6570 URI template, report malformed expressions and referenced variables, then expand it against bounded caller-supplied values.
- Distinctness: live OpenAPI v0.8.206 has query-string parse/serialize routes, JSON Schema validation and OpenAPI indexing, but no URI-template parser, RFC 6570 expansion, or template-variable validation. Roster concepts include safe URL normalization and OpenAPI operation/diff/version checks; these don't parse or expand RFC 6570 expressions.
- Contract candidate: POST `/v1/uri-template`; JSON request <= 65,536 bytes; template <= 4096 chars, <= 100 expressions, 50 variables and 256 chars per variable name; values <= 4096 combined scalar/key chars and expanded output <= 262,144 chars. Return validity, parsed variable/operator metadata, missing/unused variables, and expansion when valid.
- Example: template `/users/{id}{?fields*}` with `{ "id": "a/b", "fields": ["name", "email"] }` expands to `/users/a%2Fb?fields=name&fields=email`.
- Conformance hardening: percent-encoded variable names are preserved in query expansion; request validation builds a null-prototype value map to safely handle names such as `__proto__`; tests exercise exact configured input/output maxima as well as over-limit failures.
- Worker handoff: `handleUriTemplateWorkerRequest(Request)` enforces POST, JSON media type, strict UTF-8/JSON parsing, a streaming 65,536-byte request cap, and JSON 400/405/413/415/500 responses. It runs the deterministic conformance/expansion path with no network or model calls.
- No runtime model or external API calls. No URL fetching.
- Blocker: this checkout contains no production Worker source or writable integration branch. The shared `PUBLICATION_LEDGER.md` confirms the exclusive Engineer 32 assignment but allocates no production target or PayAPI slot. The implementation remains isolated in the engineer workspace.

## Live catalog evidence

Source: `https://agent-evidence-extractor.defcronyke.workers.dev/openapi.json`, fetched 2026-11-16 UTC. Catalog version `0.8.206`. Related routes: `/v1/url-query-parse`, `/v1/url-query-serialize`, `/v1/openapi-index`, `/v1/json-schema-validate`, `/v1/json-schema-compatibility`. None accepts a URI template or implements RFC 6570 operators.

Other currently assigned concepts inspected from the durable roster include safe URL normalization (03), OpenAPI operation checks (14), OpenAPI diffs (29), JSON Schema work (35), request/response fixture synthesis (37), MCP catalog (39), API-version checks (42), and HTTP header validation (27). Engineer 29's finished artifact compares full OpenAPI API contracts; engineer 37's assigned function synthesizes fixtures. Those customer jobs differ from RFC 6570 template parsing/expansion. Engineers 03 and 14 were still working without a surfaced contract/checkpoint at comparison time, so their final reserved scope remains unconfirmed.

## Integration control evidence

The private `defcron/agent-evidence-utility` GitHub repo is on `main` version `0.8.206`; the connector reports push permission, but this isolated checkout is the separate engineer repo and has no production source tree or assigned integration branch. Cloudflare API access can list the existing Worker and confirmed read access to script `agent-evidence-extractor`; `cloudflare_search` documents that script uploads require `Workers Scripts Write` (or Admin/Editor), which this turn did not establish. No production write, secret access, or deployment was attempted. Existing source integration requires a paid-route entry in `src/worker.ts`, a Hono handler with a zero-model-cost call record, the OpenAPI path/example docs, and the free MCP catalog registration. The TypeScript module and OpenAPI fragment are prepared for that integration.

## Saved environment identity check

`codex_app__list_cloud_environments` returned a runnable saved configuration named `x402-codex-cloud-engineers`, with repository ID `github-1459329038`, ref `main`, and mount path `x402-codex-cloud-engineers`. `github_get_repo(defcron/x402-codex-cloud-engineers)` returned GitHub repository ID `1459329038`; the active filesystem at `/workspace/x402-codex-cloud-engineers` has remote `https://github.com/defcron/x402-codex-cloud-engineers.git`. This confirms the saved configuration's repository mapping and the current checkout's repository identity. `cloud_environment_environment_status` confirms the current runtime is cloud/running, but returns a different opaque `source_config_id` and does not expose the saved `environmentConfigId`; there is no direct linkage in the available evidence proving this exact chat was instantiated from that named saved configuration. Therefore environment attachment is a strong repository match, not conclusively verified.

## Delivery state

Files added: `WORKSTREAM-32.md`, `uri_template.py`, `test_uri_template.py`, `uri-template.ts` (including Worker adapter), `test-uri-template.mjs`, `openapi-uri-template-fragment.json`, and `README-uri-template.md` (including Hono handler and example).

- `node --experimental-strip-types --test test-uri-template.mjs` — 12 tests passed.
- `python -m unittest -v test_uri_template.py` — 13 tests passed.
- `python -m json.tool openapi-uri-template-fragment.json` — valid JSON.

No production tests or build were run because this checkout is the engineer repository; `defcron/agent-evidence-utility` was inspected through read-only GitHub access. The current saved-environment linkage remains inconclusive as recorded above.

The ledger assigns Engineer 32 the key but no deployment target or PayAPI quota slot. No production changes, deployment, payment, or submission made. The in-flight `html-forms` submission remains uncertain and was not retried.
