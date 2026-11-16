# x402 Settlement Receipt Reconciliation

Service key: `x402-settlement-receipt-reconciliation`.

This deterministic, dependency-free prototype checks whether an x402 settlement response is consistent with caller-supplied EVM transaction and receipt data. It reconciles the transaction hash and network, requires a successful receipt, and sums ERC-20 `Transfer` events for the expected token and recipient with integer arithmetic. `worker-adapter.mjs` maps the dedicated Worker route's snake_case contract into the core checker and preserves its 400/413 status codes.

## Distinct customer job

The live catalog exposes `/v1/x402-payment-inspect` for decoding and inspecting a payment challenge and `/v1/x402-offer-compare` for comparing offers with an allowlist. This prototype consumes **post-settlement** evidence and reconciles it against an expected payment. It does not decode a challenge or select an offer. The closest visible peer task is #17's payment-challenge utility; other peer titles concern HTTP, API, schema, calendar, CSV, XML, and webhook utilities, with no settlement-receipt task.

The prototype accepts transaction and receipt JSON and makes no network calls. `status: "match"` means the supplied evidence is internally consistent; it does **not** authenticate the RPC source, prove chain inclusion/finality, or independently verify the chain. A production route should preserve this caveat or fetch transaction data from a fixed allowlist of chain RPCs with timeout and response-size limits. It must not accept arbitrary RPC URLs.

## Core input

```json
{
  "paymentResponse": {
    "success": true,
    "transaction": "0xabababababababababababababababababababababababababababababababab",
    "network": "eip155:8453"
  },
  "expected": {
    "network": "eip155:8453",
    "asset": "0x1111111111111111111111111111111111111111",
    "payTo": "0x2222222222222222222222222222222222222222",
    "amount": "1250000"
  },
  "transaction": {
    "hash": "0xabababababababababababababababababababababababababababababababab"
  },
  "observedChainId": "0x2105",
  "receipt": {
    "transactionHash": "0xabababababababababababababababababababababababababababababababab",
    "status": "0x1",
    "logs": [{
      "address": "0x1111111111111111111111111111111111111111",
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000003333333333333333333333333333333333333333",
        "0x0000000000000000000000002222222222222222222222222222222222222222"
      ],
      "data": "0x00000000000000000000000000000000000000000000000000000000001312d0"
    }]
  }
}
```

`expected.amount` is a positive integer token amount in the asset's smallest unit, represented as a decimal string. This prototype supports ERC-20 transfers only. Network identifiers must use `eip155:<chainId>`.

`observedChainId` should come from the same RPC source used to obtain the transaction and receipt. As with the receipt itself, the prototype cannot authenticate that source.

## Worker operation contract

The portable adapter accepts these fields for the proposed dedicated `POST /v1/x402-settlement-receipt-reconciliation` route:

```json
{
  "operation": "x402-settlement-receipt-reconciliation",
  "payment_response": { "success": true, "transaction": "0x...64 hex digits...", "network": "eip155:8453" },
  "expected": { "network": "eip155:8453", "asset": "0x1111111111111111111111111111111111111111", "pay_to": "0x2222222222222222222222222222222222222222", "amount_atomic": "1250000" },
  "observed_chain_id": "0x2105",
  "transaction": { "hash": "0x...64 hex digits..." },
  "receipt": { "transactionHash": "0x...64 hex digits...", "status": "0x1", "logs": [] }
}
```

For real receipts, include the complete JSON-RPC logs array; the schema and adapter permit extra transaction/receipt fields but the checker ignores them. `payment_response` uses the x402 settlement response fields. The Worker wrapper should map `ReconcileInputError.status` to HTTP 400 or 413 using the existing direct utility route error handling.

## Output

```json
{
  "status": "match",
  "reason": "settlement_fields_reconcile",
  "network": "eip155:8453",
  "asset": "0x1111111111111111111111111111111111111111",
  "payTo": "0x2222222222222222222222222222222222222222",
  "amount": "1250000",
  "transaction": "0xabababababababababababababababababababababababababababababababab",
  "matchingTransfers": 1,
  "verifiedOnChain": false,
  "note": "Caller-supplied RPC evidence was checked for consistency only; it was not authenticated or independently verified."
}
```

Mismatch and incomplete evidence return `status: "mismatch"` or `"insufficient_evidence"` with stable reason codes. Invalid input throws `ReconcileInputError`; malformed or failed cases never return a successful match.

## Bounds and focused checks

- Maximum serialized input: 128 KiB.
- Maximum receipt logs: 256.
- Token quantities use `BigInt`, with no floating-point conversion.
- No model/API credits, network calls, arbitrary URLs, or secrets.
- Run the focused prototype and Worker-adapter checks from this directory:

```sh
node --test x402-settlement-reconciliation.test.mjs worker-adapter.test.mjs
```

Tests cover a successful settlement, split transfers, transaction/chain/network/amount mismatches, failed responses, unrelated logs, malformed inputs, and size/count bounds. The adapter test covers snake_case Worker payload mapping and 400/413 error status preservation.

See [production-integration.md](production-integration.md) for the Worker integration handoff and source layout for `defcron/agent-evidence-utility`.
