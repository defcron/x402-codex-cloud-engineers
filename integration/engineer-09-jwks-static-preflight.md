# Engineer 09 — JWKS static preflight integration guide

This is a central-integration handoff for the isolated prototype. It does not change production. It is based on production repository `defcron/agent-evidence-utility` main snapshot `f928222b06b0861d0798a7acea018d3a78b6ad87` (2026-11-16), which has Worker entry `src/worker.ts`, module `src/jwt-inspect.ts`, test `test/jwt-inspect.test.js`, `npm test` = `node --test`, and an esbuild `npm run build` script.

## Customer job and trust boundary

`jwks-static-preflight` checks one caller-supplied JWKS document for structural and metadata issues before an agent configures an OIDC/API client. It is a static parser/linter. A passing result does **not** prove that keys are authentic, trusted, strong, current, or controlled by a particular issuer. It performs no network fetch and no signature verification. It is distinct from live `POST /v1/jwt-inspect` (decodes JWT header/claims with `verified:false`) and Engineer 10's reserved `jwks-rotation-cache-policy` (compares two snapshots and caller-supplied cache freshness).

## Suggested public route contract

- `POST /v1/jwks-preflight`, JSON body `{ "jwks_json": "<raw JSON JWKS text>" }`.
- Limit `jwks_json` to 131,072 UTF-8 bytes and 50 JWKs; cap the complete JSON request body at a clearly documented bound just above that raw value limit.
- Return `{ ok, key_count, issues: [{ path, code }], note }`. Do not return keys or submitted values. Use 400 for malformed JSON/request shape, 413 for size/count overflow, and normal 200 reports for syntactically valid JWKS documents that contain lint findings.
- Fixed price suggestion: USD 0.005 USDC on the same supported networks used by the existing Worker. The runtime calls no paid model/API. This is a proposal only; the ledger assigns no quota slot.
- Set `Cache-Control: no-store`; never retain the JWKS body.
- Use explicit wording that the check is structural and makes no cryptographic authenticity/trust claim.

## Worker wiring

At the inspected production snapshot, `src/worker.ts` imports JWT helpers near its top, constructs Bazaar discovery extensions around the `jwtSample`/`jwtInspectBazaar` block, declares x402 `paymentRoutes` around the `POST /v1/jwt-inspect` entry, builds `/openapi.json` in its Hono handler, and implements the JWT Hono route near the end of the route registrations. Use those as patterns:

1. Port `jwks-preflight.mjs` to `src/jwks-preflight.ts`; preserve its deterministic bounds and stable issue codes. The prototype currently calls Node's global `Buffer`. For Cloudflare Worker compatibility, either import `Buffer` explicitly from the already-declared `buffer` package or replace that conversion with Worker-supported base64url primitives. Do not enable new Node compatibility flags just for this helper.
2. Add a focused `test/jwks-preflight.test.js` using `node:test` and import the TypeScript module the same way `test/jwt-inspect.test.js` does. Include all eleven current cases, then run `npm test` and `npm run build`.
3. In `src/worker.ts`, import the helper and its limits/error type. Define bounded input/output schemas, a normal public-JWK example, and a `declareDiscoveryExtension` beside `jwtInspectBazaar`.
4. Add a `POST /v1/jwks-preflight` entry to the existing x402 `paymentRoutes` map beside the JWT entry. Use `exactEvmAccepts(0.005, env.PAY_TO)`, JSON content type, a truthful description, `no-model`/`jwks` tags, and the discovery extension. Do not create another payment flow.
5. Add the Hono handler near `app.post("/v1/jwt-inspect", ...)`. Check declared and actual request-body byte length before parsing; parse the outer JSON body; validate exactly the documented `jwks_json` field; call the pure helper; use consistent JSON errors and `no-store`; record `modelCostMicros: 0`, zero token counts, and the fixed route price through the existing `callRecord` mechanism. If duplicate JSON member names inside the raw `jwks_json` value must be rejected, use the existing `detectJsonDuplicateKeys` helper before parsing and test that behavior; the current isolated prototype documents that `JSON.parse` itself does not detect repeated member names.
6. Confirm the existing OpenAPI and `/examples` generation reflects the new registered route and Bazaar input/output sample. Add the concise `/v1/jwks-preflight` entry beside `/v1/jwt-inspect` in the generated `/llms.txt` Paid API text. Check the free MCP catalog/discovery output as well as OpenAPI; do not assume the x402 payment route alone makes a route discoverable.
7. Run focused tests, `npm test`, `npm run build`, and the repository's established Wrangler dry-run. After an assigned deployment, verify a valid sample, malformed JSON, size limit, private-key marker, duplicate `kid`, route discovery/example, and unpaid 402 price/network/asset/payee. Do not make a paid canary without an explicit authorized quota allocation.

## Files in this handoff

- `jwks-preflight.mjs` — isolated helper; no Worker routing/payment code.
- `jwks-preflight.test.mjs` — eight focused Node tests.
- `examples/jwks-preflight.md` — prototype contract, example, command, and limitations.
- `checkpoints/engineer-09.md` — assignment, duplicate comparison, test evidence, and status.

No production integration, deployment, live route verification, PayAPI submission, or paid call has been performed by Engineer 09.
