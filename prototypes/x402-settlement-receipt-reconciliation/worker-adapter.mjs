import { ReconcileInputError, reconcileSettlement } from "./x402-settlement-reconciliation.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Adapter for the existing POST /v1/agent-utilities Worker operation.
 * Throws ReconcileInputError with a status property understood by the Worker's
 * shared 400/413 error mapping.
 */
export function reconcileSettlementWorkerAdapter(input) {
  if (!isRecord(input)) throw new ReconcileInputError("Request must be a JSON object.");
  if (!isRecord(input.payment_response) || !isRecord(input.expected) || !isRecord(input.transaction) || !isRecord(input.receipt)) {
    throw new ReconcileInputError("payment_response, expected, transaction, and receipt must be JSON objects.");
  }
  return reconcileSettlement({
    paymentResponse: input.payment_response,
    expected: {
      network: input.expected.network,
      asset: input.expected.asset,
      payTo: input.expected.pay_to,
      amount: input.expected.amount_atomic,
    },
    observedChainId: input.observed_chain_id,
    transaction: input.transaction,
    receipt: input.receipt,
  });
}
