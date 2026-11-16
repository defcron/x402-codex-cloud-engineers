const MAX_INPUT_BYTES = 128 * 1024;
export const X402_SETTLEMENT_RECONCILIATION_MAX_INPUT_BYTES = MAX_INPUT_BYTES;
const MAX_LOGS = 256;
const MAX_UINT256 = (1n << 256n) - 1n;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRUST_NOTE = "Caller-supplied RPC evidence was checked for consistency only; it was not authenticated or independently verified.";

export const X402_SETTLEMENT_RECONCILIATION_INPUT_SCHEMA = {
  type: "object",
  required: ["payment_response", "expected", "observed_chain_id", "transaction", "receipt"],
  additionalProperties: false,
  properties: {
    payment_response: {
      type: "object", required: ["success", "transaction", "network"], additionalProperties: false,
      properties: {
        success: { type: "boolean" },
        transaction: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        network: { type: "string", pattern: "^eip155:[1-9][0-9]{0,77}$" },
        payer: { type: "string", maxLength: 128 },
      },
    },
    expected: {
      type: "object", required: ["network", "asset", "pay_to", "amount_atomic"], additionalProperties: false,
      properties: {
        network: { type: "string", pattern: "^eip155:[1-9][0-9]{0,77}$" },
        asset: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        pay_to: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        amount_atomic: { type: "string", minLength: 1, maxLength: 78, pattern: "^[1-9][0-9]{0,77}$" },
      },
    },
    observed_chain_id: { type: "string", pattern: "^0x[0-9a-fA-F]{1,64}$" },
    transaction: { type: "object", required: ["hash"], properties: { hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } } },
    receipt: {
      type: "object", required: ["transactionHash", "status", "logs"],
      properties: {
        transactionHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        status: { oneOf: [{ type: "string", enum: ["0x1", "0x01", "0x0", "0x00"] }, { type: "integer", enum: [0, 1] }] },
        logs: {
          type: "array", maxItems: MAX_LOGS,
          items: { type: "object", required: ["address", "topics", "data"], properties: {
            address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            topics: { type: "array", maxItems: 4, items: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } },
            data: { type: "string", maxLength: 8194, pattern: "^0x(?:[0-9a-fA-F]{2})*$" },
          } },
        },
      },
    },
  },
};

export const X402_SETTLEMENT_RECONCILIATION_OUTPUT_SCHEMA = {
  type: "object", required: ["status", "reason", "verifiedOnChain", "note"],
  properties: {
    status: { type: "string", enum: ["match", "mismatch", "insufficient_evidence"] },
    reason: { type: "string" },
    verifiedOnChain: { type: "boolean", const: false },
    note: { type: "string" },
    network: { type: "string" }, asset: { type: "string" }, payTo: { type: "string" },
    amount: { type: "string" }, expectedAmount: { type: "string" }, observedAmount: { type: "string" },
    transaction: { type: "string" }, matchingTransfers: { type: "integer" },
  },
};

export class ReconcileInputError extends Error {
  constructor(message, status = 400) { super(message); this.name = "ReconcileInputError"; this.status = status; }
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isHash = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const isAddress = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const norm = (value) => value.toLowerCase();

function inputShape(input) {
  if (!isRecord(input)) throw new ReconcileInputError("Input must be a JSON object.");
  let serialized;
  try { serialized = JSON.stringify(input); }
  catch { throw new ReconcileInputError("Input must be JSON-serializable."); }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_INPUT_BYTES) {
    throw new ReconcileInputError(`Input exceeds the ${MAX_INPUT_BYTES}-byte limit.`, 413);
  }
  const { paymentResponse, expected, observedChainId, transaction, receipt } = input;
  if (![paymentResponse, expected, transaction, receipt].every(isRecord)) {
    throw new ReconcileInputError("paymentResponse, expected, transaction, and receipt must be JSON objects.");
  }
  if (!Array.isArray(receipt.logs) || receipt.logs.length > MAX_LOGS) {
    throw new ReconcileInputError(`receipt.logs must be an array with at most ${MAX_LOGS} entries.`, 413);
  }
  return { paymentResponse, expected, observedChainId, transaction, receipt };
}

function result(status, reason, details = {}) {
  return { status, reason, ...details, verifiedOnChain: false, note: TRUST_NOTE };
}

function addressTopic(topic) {
  if (typeof topic !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(topic)) return null;
  return `0x${topic.slice(-40)}`;
}

/** Consistency-checks caller-supplied x402 and EVM settlement evidence. */
export function reconcileSettlement(input) {
  const { paymentResponse, expected, observedChainId, transaction, receipt } = inputShape(input);
  if (typeof expected.network !== "string" || !/^eip155:[1-9][0-9]{0,77}$/.test(expected.network)) {
    throw new ReconcileInputError("expected.network must use the eip155:<chainId> format.");
  }
  const expectedChainId = BigInt(expected.network.slice("eip155:".length));
  if (!isAddress(expected.asset) || !isAddress(expected.payTo)) {
    throw new ReconcileInputError("expected.asset and expected.payTo must be 20-byte EVM addresses.");
  }
  if (typeof expected.amount !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(expected.amount)) {
    throw new ReconcileInputError("expected.amount must be a positive atomic-unit integer string.");
  }
  if (BigInt(expected.amount) === 0n) {
    throw new ReconcileInputError("expected.amount must be greater than zero for a paid settlement.");
  }
  if (BigInt(expected.amount) > MAX_UINT256) {
    throw new ReconcileInputError("expected.amount must fit in an unsigned 256-bit integer.");
  }
  if (!isHash(paymentResponse.transaction) || !isHash(transaction.hash) || !isHash(receipt.transactionHash)) {
    throw new ReconcileInputError("paymentResponse.transaction, transaction.hash, and receipt.transactionHash must be 32-byte hashes.");
  }
  if (typeof observedChainId !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(observedChainId)) {
    throw new ReconcileInputError("observedChainId must be a hexadecimal JSON-RPC quantity from the receipt's RPC source.");
  }

  if (paymentResponse.success !== true) return result("mismatch", "payment_response_not_successful");
  if (paymentResponse.network !== expected.network) return result("mismatch", "payment_network_mismatch");
  const hashes = [paymentResponse.transaction, transaction.hash, receipt.transactionHash].map(norm);
  if (!hashes.every((hash) => hash === hashes[0])) return result("mismatch", "transaction_hash_mismatch");

  const actualChainId = BigInt(observedChainId);
  if (actualChainId !== expectedChainId) return result("mismatch", "chain_id_mismatch", { expectedChainId: expectedChainId.toString(), actualChainId: actualChainId.toString() });
  if (receipt.status !== "0x1" && receipt.status !== "0x01" && receipt.status !== 1) {
    return result("mismatch", "transaction_not_successful");
  }

  let received = 0n;
  let matchingTransfers = 0;
  for (const log of receipt.logs) {
    if (!isRecord(log) || !Array.isArray(log.topics) || log.topics.length < 3) continue;
    if (!isAddress(log.address) || norm(log.address) !== norm(expected.asset)) continue;
    if (typeof log.topics[0] !== "string" || norm(log.topics[0]) !== TRANSFER_TOPIC) continue;
    const to = addressTopic(log.topics[2]);
    if (!to || norm(to) !== norm(expected.payTo)) continue;
    if (typeof log.data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) {
      return result("insufficient_evidence", "matching_transfer_has_invalid_amount_data");
    }
    received += BigInt(log.data);
    matchingTransfers += 1;
  }

  const expectedAmount = BigInt(expected.amount);
  if (received !== expectedAmount) {
    return result("mismatch", matchingTransfers ? "received_amount_mismatch" : "no_matching_transfer", {
      expectedAmount: expectedAmount.toString(), observedAmount: received.toString(), matchingTransfers,
    });
  }
  return result("match", "settlement_fields_reconcile", {
    network: expected.network, asset: expected.asset, payTo: expected.payTo,
    amount: received.toString(), transaction: transaction.hash, matchingTransfers,
  });
}

export { MAX_INPUT_BYTES, MAX_LOGS };
