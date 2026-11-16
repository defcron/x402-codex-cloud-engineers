# Engineer 05 — CSV schema to SQL DDL

**Service key:** `csv-ddl-schema-inference`

**Proposed route:** `POST /v1/csv-create-table`

**State:** tested branch artifact and Worker integration handoff; not deployed or submitted.

## Customer contract

A developer or agent has a CSV export and needs a first-pass database table definition before loading it. The service accepts a CSV string, one table identifier, and an optional SQL dialect. It returns only a `CREATE TABLE` statement, selected dialect, and review note. It never executes SQL or returns input cell values.

Example request:

```json
{"csv":"id,name\n1,Ada\n2,Bob","table":"people","dialect":"sqlite"}
```

Example response:

```json
{"statement":"CREATE TABLE \"people\" (\n  \"id\" INTEGER,\n  \"name\" TEXT\n);\n","dialect":"sqlite","note":"DDL draft inferred from supplied CSV values; review before use. SQL is not executed and no cell values are returned."}
```

Accepted dialects are PostgreSQL, SQLite, and MySQL. Inputs are bounded at 262,144 characters, 1,000 data records, 50 columns, and 128 characters per identifier. Integer inference is limited to signed 64-bit values; finite decimal values infer a numeric family. Boolean columns are inferred only when every non-empty cell is `true` or `false`. Empty or ambiguous columns become text. Leading-zero identifiers such as postal codes remain text. Malformed CSV, duplicate/blank headers, invalid identifiers, unsupported dialects, or inconsistent rows fail with an error; bound violations return 413 in the Worker adapter.

The inferred schema does not establish future ranges, nullability, keys, relationships, indexes, defaults, or business constraints. Consumers must review the DDL.

## Distinctness

The live catalog and current ledger identify `/v1/csv-sql-preview` as parameterized `INSERT` generation with a caller-supplied column/type map ($0.010). `/v1/csv-profile` returns column metrics and a draft JSON Schema. This candidate's customer job is database schema provisioning: infer SQL types from the supplied CSV and produce `CREATE TABLE` only, without values or insert statements. Engineer 05's original `csv-to-sql-preview` key overlapped the live route; the current CTO instruction reaffirms this DDL-only pivot. Ledger row 05 is updated on this branch only; peer rows are unchanged.

## Runtime and price

The implementation is deterministic, makes no paid model/API calls, does not fetch URLs, and keeps no input. Proposed fixed price is USD $0.005 per successful call (USDC through the existing x402 middleware). No live challenge or settlement has been tested.

## Files and checks

- `csv_schema_sql.py`: dependency-free reference CLI and JSON adapter.
- `tests/test_csv_schema_sql.py`: Python reference tests.
- `openapi.json`: proposed route contract.
- `worker/src/csv-schema-ddl.ts`: Worker-compatible implementation using the production CSV parser's parsed output.
- `worker/test/csv-schema-ddl.test.js`: Node tests for the Worker module.
- `WORKER-HANDOFF.md`: integration points and exact central verification/deployment commands.
- `CHECKPOINT.md`: assignment, ledger, status, evidence, and next step.

From this directory, run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`. From `worker/`, run `npm test`.

## Publication status

The current ledger allocates no individual deployment target and no PayAPI quota slot. The production source repository is private and was inspected read-only at `f928222b06b0861d0798a7acea018d3a78b6ad87`; this branch does not modify it. Before deployment, the CTO must assign an integration owner/target and current main must be reconciled with the deployed route catalog. Before any PayAPI request, resolve the uncertain `html-forms` submission through its receipt/status and reserve capacity for wallet, contact email, source IP, and pay-to address. Do not retry it or treat this branch as a live service.
