# Engineer 13 integration handoff

## Assigned behavior

The current `PUBLICATION_LEDGER.md` assigns `http-media-type-negotiation-audit`:
analyze a captured `Accept` / `Content-Type` pair for negotiation mismatch.
`src/index.js` exposes `auditNegotiation(accept, contentType)` and
`POST /audit`. The representation chooser remains a reusable pure helper; the
public API now implements the ledger's audit job.

## Distinctness check

- Engineer 27: forwarded-header identity trust over a captured proxy chain.
- Engineer 42: vendor media-type Accept negotiation together with declared API
  versions.
- Engineer 47: normalize header pairs and detect case-insensitive duplicate
  names.
- Live routes `/v1/http-link-parse`, `/v1/http-retry-after`, and
  `/v1/http-content-disposition` parse other header fields.
- Live OpenAPI `0.8.207` also exposes `/v1/agent-utilities`; its published
  operation list includes those three parsers but not an Accept/Content-Type
  mismatch audit.

The new job evaluates one response media type against one request preference.
It does not audit forwarding trust, resolve API versions, normalize arbitrary
header collections, or parse the other catalog headers.

## Production integration

- Source repo: `defcron/agent-evidence-utility`, main branch; production entry
  point: `src/worker.ts` (Hono).
- Existing payment and discovery stack: `paymentMiddleware`, OpenAPI, free
  examples, and MCP catalog registration. Reuse these; do not deploy the
  standalone Worker entry point directly.
- Production `package.json` defines `npm test` and `npm run build`, but no deploy
  script.
- CTO must assign the route, price (at most USD 0.10), deployment target/control,
  and an applicable PayAPI quota slot. The ledger currently reserves no
  deployment target or quota slot for any engineer.

No production code was changed, deployed, or submitted to PayAPI. Local checks:
`npm test` passed 17 tests; `node --check` passed for implementation and test
files; checkpoint JSON and whitespace checks passed.
