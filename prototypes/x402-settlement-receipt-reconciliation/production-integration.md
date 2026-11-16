# Production Worker integration handoff

This artifact is a tested local prototype and integration recipe for `defcron/agent-evidence-utility`; it is not a production patch or deployment. The current Worker generates dedicated routes from `utilityDefinitions`. Integrate this as `POST /v1/x402-settlement-receipt-reconciliation` at the existing low-price tier (`$0.005`), which generates the route's OpenAPI, x402 offer, public example, and discovery entry. Do not add this as a generic operation unless the product owner intentionally chooses that API surface.

## Source files

Copy these two files into the production source tree:

```sh
cp prototypes/x402-settlement-receipt-reconciliation/x402-settlement-reconciliation.mjs src/x402-settlement-reconciliation.mjs
cp prototypes/x402-settlement-receipt-reconciliation/worker-adapter.mjs src/x402-settlement-receipt-reconciliation-worker-adapter.mjs
```

In `src/agent-utilities.ts`, import `reconcileSettlementWorkerAdapter` and add this case to `runAgentUtility`:

```ts
case "x402-settlement-receipt-reconciliation":
  return reconcileSettlementWorkerAdapter(input);
```

In `src/worker.ts`, import the adapter and the following exports from `./x402-settlement-reconciliation.mjs`:
`X402_SETTLEMENT_RECONCILIATION_INPUT_SCHEMA`,
`X402_SETTLEMENT_RECONCILIATION_OUTPUT_SCHEMA`, and
`X402_SETTLEMENT_RECONCILIATION_MAX_INPUT_BYTES`.

Add a `utilityDefinitions` record with these fields (the exact surrounding type may require the repo's local style):

```ts
{
  id: "x402-settlement-receipt-reconciliation",
  name: "x402 settlement receipt reconciliation",
  description: "Checks caller-supplied x402 settlement and EVM receipt fields for consistency; does not authenticate RPC data or prove settlement.",
  inputSchema: X402_SETTLEMENT_RECONCILIATION_INPUT_SCHEMA,
  outputSchema: X402_SETTLEMENT_RECONCILIATION_OUTPUT_SCHEMA,
  maxBodyBytes: X402_SETTLEMENT_RECONCILIATION_MAX_INPUT_BYTES,
  price: "0.005",
  input: { /* route input schema reference, per existing utility definitions */ },
  example: {
    payment_response: { success: true, transaction: `0x${"ab".repeat(32)}`, network: "eip155:8453" },
    expected: { network: "eip155:8453", asset: "0x1111111111111111111111111111111111111111", pay_to: "0x2222222222222222222222222222222222222222", amount_atomic: "1250000" },
    observed_chain_id: "0x2105",
    transaction: { hash: `0x${"ab".repeat(32)}` },
    receipt: { transactionHash: `0x${"ab".repeat(32)}`, status: "0x1", logs: [/* use the matching Transfer log in README's core example */] }
  }
}
```

Follow adjacent definitions for `input`, example wrapper shape, and description conventions; the source repository is not part of this isolated workspace, so a context-accurate production patch cannot be generated here. Add the new ID to `test/worker.test.js`'s `newUtilityRoutes` inventory. Add a direct `runAgentUtility` adapter test in the existing agent utility test file if the repository's test setup supports the `.mjs` import. Keep the focused prototype tests in this directory as the source-level contract checks.

## Request and trust boundary

The input contract is documented in [README.md](README.md). Input is limited to 128 KiB and 256 receipt logs; transfer amounts use `BigInt`. The utility makes no RPC, model, or other network calls. A `match` means only that the caller-supplied x402 response, expected payment, observed chain ID, transaction, and receipt agree. The service does not authenticate the RPC source, establish inclusion or finality, or prove that a payment occurred. Every result includes `verifiedOnChain: false` and this limitation. Never present a `match` as proof of payment.

## Integration verification

From the production repository, adapt and run its focused tests, then build:

```sh
node --test test/agent-utilities.test.js test/worker.test.js
npm run build
```

Also verify the generated OpenAPI schema and example, and that an unpaid POST to the dedicated path returns HTTP 402. The production repo is not checked out in this workspace, so these integration checks, deployment, live discovery/health/function checks, PayAPI submission, and receipt reconciliation have not been performed here.
