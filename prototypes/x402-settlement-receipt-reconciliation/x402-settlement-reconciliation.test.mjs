import test from "node:test";
import assert from "node:assert/strict";
import { MAX_INPUT_BYTES, MAX_LOGS, ReconcileInputError, reconcileSettlement } from "./x402-settlement-reconciliation.mjs";

const txHash = `0x${"ab".repeat(32)}`;
const asset = "0x1111111111111111111111111111111111111111";
const payTo = "0x2222222222222222222222222222222222222222";
const payer = "0x3333333333333333333333333333333333333333";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicAddress = (address) => `0x${address.slice(2).padStart(64, "0")}`;

function fixture(overrides = {}) {
  return {
    paymentResponse: { success: true, transaction: txHash, network: "eip155:8453", payer },
    expected: { network: "eip155:8453", asset, payTo, amount: "1250000" },
    observedChainId: "0x2105",
    transaction: { hash: txHash, from: payer, to: asset },
    receipt: { transactionHash: txHash, status: "0x1", logs: [{
      address: asset, topics: [transferTopic, topicAddress(payer), topicAddress(payTo)],
      data: `0x${1250000n.toString(16).padStart(64, "0")}`,
    }] },
    ...overrides,
  };
}

test("reconciles a successful ERC-20 settlement receipt", () => {
  const output = reconcileSettlement(fixture());
  assert.equal(output.status, "match");
  assert.equal(output.reason, "settlement_fields_reconcile");
  assert.equal(output.verifiedOnChain, false);
  assert.match(output.note, /not authenticated or independently verified/);
  assert.equal(output.amount, "1250000");
});

test("sums multiple matching Transfer logs with integer arithmetic", () => {
  const input = fixture();
  input.receipt.logs.push({ address: asset, topics: [transferTopic, topicAddress(payer), topicAddress(payTo)], data: `0x${500000n.toString(16).padStart(64, "0")}` });
  input.expected.amount = "1750000";
  const output = reconcileSettlement(input);
  assert.equal(output.status, "match");
  assert.equal(output.matchingTransfers, 2);
});

test("accepts the maximum log count and the maximum uint256 transfer amount", () => {
  const maxUint256 = (1n << 256n) - 1n;
  const input = fixture();
  input.expected.amount = maxUint256.toString();
  input.receipt.logs = Array.from({ length: MAX_LOGS }, (_, index) => ({
    address: asset,
    topics: [transferTopic, topicAddress(payer), topicAddress(payTo)],
    data: `0x${(index === 0 ? maxUint256 : 0n).toString(16).padStart(64, "0")}`,
  }));
  const output = reconcileSettlement(input);
  assert.equal(output.status, "match");
  assert.equal(output.matchingTransfers, MAX_LOGS);
  assert.equal(output.amount, maxUint256.toString());
});

test("reports transaction, chain, amount, and network mismatches", () => {
  const differentHash = fixture();
  differentHash.receipt.transactionHash = `0x${"cd".repeat(32)}`;
  assert.equal(reconcileSettlement(differentHash).reason, "transaction_hash_mismatch");
  const differentChain = fixture();
  differentChain.observedChainId = "0x1";
  assert.equal(reconcileSettlement(differentChain).reason, "chain_id_mismatch");
  const differentAmount = fixture();
  differentAmount.expected.amount = "1";
  assert.equal(reconcileSettlement(differentAmount).reason, "received_amount_mismatch");
  const differentNetwork = fixture();
  differentNetwork.paymentResponse.network = "eip155:1";
  assert.equal(reconcileSettlement(differentNetwork).reason, "payment_network_mismatch");
});

test("rejects failed payment responses and failed receipts", () => {
  assert.equal(reconcileSettlement(fixture({ paymentResponse: { success: false, transaction: txHash, network: "eip155:8453" } })).reason, "payment_response_not_successful");
  const failed = fixture();
  failed.receipt.status = "0x0";
  assert.equal(reconcileSettlement(failed).reason, "transaction_not_successful");
});

test("ignores nonmatching assets, recipients, and event signatures", () => {
  const input = fixture();
  input.receipt.logs = [
    { address: "0x4444444444444444444444444444444444444444", topics: [transferTopic, topicAddress(payer), topicAddress(payTo)], data: `0x${1250000n.toString(16).padStart(64, "0")}` },
    { address: asset, topics: [`0x${"00".repeat(32)}`, topicAddress(payer), topicAddress(payTo)], data: `0x${1250000n.toString(16).padStart(64, "0")}` },
    { address: asset, topics: [transferTopic, topicAddress(payer), topicAddress("0x5555555555555555555555555555555555555555")], data: `0x${1250000n.toString(16).padStart(64, "0")}` },
    { address: asset, topics: [transferTopic, topicAddress(payer), `0x${"1".repeat(64)}`], data: `0x${1250000n.toString(16).padStart(64, "0")}` },
  ];
  assert.equal(reconcileSettlement(input).reason, "no_matching_transfer");
});

test("rejects malformed objects, quantities, addresses, and hashes", () => {
  assert.throws(() => reconcileSettlement(null), ReconcileInputError);
  const badAddress = fixture();
  badAddress.expected.payTo = "0x1234";
  assert.throws(() => reconcileSettlement(badAddress), /20-byte EVM addresses/);
  const badAmount = fixture();
  badAmount.expected.amount = "01";
  assert.throws(() => reconcileSettlement(badAmount), /atomic-unit integer/);
  const zeroAmount = fixture();
  zeroAmount.expected.amount = "0";
  assert.throws(() => reconcileSettlement(zeroAmount), /greater than zero/);
  const oversizedAmount = fixture();
  oversizedAmount.expected.amount = (1n << 256n).toString();
  assert.throws(() => reconcileSettlement(oversizedAmount), /unsigned 256-bit integer/);
  const badHash = fixture();
  badHash.transaction.hash = "not-a-hash";
  assert.throws(() => reconcileSettlement(badHash), /32-byte hashes/);
});

test("bounds log count and serialized input size", () => {
  const atLogLimit = fixture();
  atLogLimit.receipt.logs = Array(MAX_LOGS).fill({});
  assert.equal(reconcileSettlement(atLogLimit).reason, "no_matching_transfer");
  const tooManyLogs = fixture();
  tooManyLogs.receipt.logs = Array(MAX_LOGS + 1).fill({});
  assert.throws(() => reconcileSettlement(tooManyLogs), new RegExp(`at most ${MAX_LOGS}`));
  const tooLarge = fixture();
  tooLarge.note = "x".repeat(MAX_INPUT_BYTES);
  assert.throws(() => reconcileSettlement(tooLarge), new RegExp(`${MAX_INPUT_BYTES}-byte limit`));
});

test("returns insufficient evidence for malformed data on a matching transfer", () => {
  const input = fixture();
  input.receipt.logs[0].data = "0x01";
  assert.equal(reconcileSettlement(input).status, "insufficient_evidence");
});
