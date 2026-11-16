# Worker integration handoff

Target repository: `defcron/agent-evidence-utility`, inspected at main commit `f928222b06b0861d0798a7acea018d3a78b6ad87` (package version `0.8.206`). This is a handoff only. No production file was written.

## Added Worker module

Copy `worker/src/csv-schema-ddl.ts` to `src/csv-schema-ddl.ts` and `worker/test/csv-schema-ddl.test.js` to `test/csv-schema-ddl.test.js`. The module accepts a parsed result from existing `csvToJson` in `src/csv.ts`; it does not add a parser dependency or execute SQL.

## Route wiring

Add imports in `src/worker.ts`:

```ts
import {
  createCsvSchemaDdl,
  CSV_SCHEMA_DDL_PRICE_USD,
  CsvSchemaDdlError,
  validateCsvSchemaDdlInput,
} from "./csv-schema-ddl.js";
```

The file already imports `csvToJson` from `./csv.js`. Near the CSV routes, the route handler should follow the existing Hono pattern:

```ts
app.post("/v1/csv-create-table", async (c) => {
  let result;
  try {
    const input = validateCsvSchemaDdlInput(await c.req.json());
    result = createCsvSchemaDdl(csvToJson(input.csv), input.table, input.dialect);
  } catch (error) {
    const status = error instanceof CsvSchemaDdlError ? error.status : 400;
    return c.json({ error: error instanceof Error ? error.message : "Invalid CSV DDL request." }, status);
  }
  const day = new Date().toISOString().slice(0, 10);
  c.set("callRecord", {
    id: crypto.randomUUID(), day, modelCostMicros: 0,
    inputTokens: 0, outputTokens: 0,
    priceUsd: CSV_SCHEMA_DDL_PRICE_USD, itemsProcessed: 1,
  });
  return c.json(result);
});
```

Also add a `POST /v1/csv-create-table` entry to the existing `paymentRoutes` object using `exactEvmAccepts("$0.005", env.PAY_TO)`, a Bazaar discovery extension with the request/response examples, and a path entry to `/openapi.json` using the schema in `openapi.json`. Add the same operation to the agent/MCP discovery catalog if required by the current central integration path. These additions must use the existing facilitator, payout binding, and pricing conventions; do not add secrets or new payment infrastructure.

The read-only source snapshot contains `src/sql-preview.ts`, SQL preview schemas/catalog metadata, and a shared CSV parser. It did not contain a literal `/v1/csv-sql-preview` Hono registration even though the deployed OpenAPI and live catalog document that route. The central integrator should reconcile this main-source/deployed-catalog difference before applying route changes.

## Central checks and deploy sequence

After integration, run from the production repository root:

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

The x402-enabled production deployment and live checks must be performed by the centrally assigned integrator after the source/catalog review and with an explicitly assigned target. Verify health, OpenAPI/Bazaar/MCP discovery, malformed and normal functionality, and unpaid HTTP 402 price/network/asset/payee before any authorized canary verification. Proposed call price is $0.005, under the $0.10 cap; runtime model/API credit cost is $0. No deployment, 402 verification, payment, or PayAPI request was made by Engineer 05.

The current `PUBLICATION_LEDGER.md` says no individual deployment target or quota slot is allocated. The uncertain `html-forms` submission must be reconciled first; preserve its unknown outcome and do not retry it. Obtain shared quota reservation for wallet, contact email, source IP, and pay-to address before one PayAPI submission.
