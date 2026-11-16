import test from "node:test";
import assert from "node:assert/strict";
import { ReconcileInputError } from "./x402-settlement-reconciliation.mjs";
import { reconcileSettlementWorkerAdapter } from "./worker-adapter.mjs";

const transactionHash = `0x${"ab".repeat(32)}`;
const asset = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;

function workerPayload() {
  return {
    payment_response: { success: true, transaction: transactionHash, network: "eip155:8453" },
    expected: { network: "eip155:8453", asset, pay_to: payTo, amount_atomic: "1250000" },
    observed_chain_id: "0x2105",
    transaction: { hash: transactionHash },
    receipt: {
      transactionHash,
      status: "0x1",
      logs: [{ address: asset, topics: [transferTopic, topic("0x3333333333333333333333333333333333333333"), topic(payTo)], data: `0x${1250000n.toString(16).padStart(64, "0")}` }],
    },
  };
}

test("Worker adapter maps the public snake_case contract to the reconciler", () => {
  const result = reconcileSettlementWorkerAdapter(workerPayload());
  assert.equal(result.status, "match");
  assert.equal(result.payTo, payTo);
  assert.equal(result.amount, "1250000");
  assert.equal(result.verifiedOnChain, false);
});

test("Worker adapter preserves 400 validation and 413 input-limit statuses", () => {
  assert.throws(() => reconcileSettlementWorkerAdapter({}), (error) => error instanceof ReconcileInputError && error.status === 400);
  const oversized = workerPayload();
  oversized.payment_response.metadata = "x".repeat(128 * 1024);
  assert.throws(() => reconcileSettlementWorkerAdapter(oversized), (error) => error instanceof ReconcileInputError && error.status === 413);
});
