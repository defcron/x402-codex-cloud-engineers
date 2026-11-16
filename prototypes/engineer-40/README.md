# JSON Null/Missing Batch Audit

A deterministic batch-level audit for JSON data pipelines. It compares how often selected fields are absent, explicitly `null`, or non-null in two sets of records. This is for catching cohort-level ETL/API contract drift; it does not match rows or produce a per-record diff.

## Example

```js
import { auditJsonNullMissingChanges } from './json-null-missing-audit.mjs';

const result = auditJsonNullMissingChanges({
  before_records: [
    { email: null },
    { email: 'a@example.test' },
    {},
  ],
  after_records: [
    { email: null },
    { email: null },
    { email: 'b@example.test' },
  ],
  fields: ['/email'],
});
console.log(result.fields[0]);
```

For each JSON Pointer, each cohort reports record, missing, null, and non-null counts plus rates in basis points (10,000 bps = 100%). The delta is `after - before`. `changed` reflects a difference in the reported distribution rates, so a different cohort size alone does not count as distribution drift. The result contains no record values or identifiers.

## Why this differs from existing services

The live catalog (OpenAPI 0.8.206) includes `/v1/json-diff`, which compares two JSON documents and reports individual JSON Pointer additions, removals, replacements, and type changes; it already detects a single field changing between absent and `null`. The catalog also includes JSON preflight/schema validation. Engineer 07's ledger reservation checks path presence/type. This audit does not duplicate those jobs: it aggregates missing/null/value distributions for selected paths across two independent cohorts, without matching records or requiring a schema. That supports drift questions such as “did the missing rate rise from 5% to 25%?” with one bounded call rather than a series of pairwise diffs.

## Contract and limits

- `before_records` and `after_records`: 1–500 JSON objects each.
- `fields`: 1–100 unique non-root RFC 6901 JSON Pointers, each at most 256 characters. Missing/unreachable paths count as missing; array indexes must use canonical non-negative syntax (for example, `/items/0`, not `/items/00`).
- Total input: at most 20,000 JSON nodes, depth 32, and 256 KiB serialized UTF-8. Output is capped at 256 KiB.
- Invalid pointers, duplicate paths, non-object records, cycles, non-JSON values, empty batches, and exceeded limits return `JsonNullMissingAuditError` with a stable `code` and HTTP-style `status`.
- Rows are not matched, so results show distribution changes, not per-row transitions. Null and missing are separate states; non-null scalars and containers count as `value`.
- No network fetch, model calls, storage, credential values, or customer values in output. Intended integration price: $0.005 USDC/request; not deployed or listed.

## Worker route adapter

`json-null-missing-audit-route.mjs` exports `handleJsonNullMissingAuditRequest(request)` for `POST /v1/json-null-missing-audit`. It validates JSON content type, enforces a 256 KiB request-body limit, returns stable client errors, and sends no-store responses. Central integration must wrap this handler in the production x402 payment middleware, set the authorized network/asset/recipient, and add the route to OpenAPI and discovery. The prototype adapter itself is unpaid and is not a live paid endpoint.

## Focused checks

```sh
node --test prototypes/engineer-40/json-null-missing-audit.test.mjs
node --test prototypes/engineer-40/json-null-missing-audit-route.test.mjs
```
