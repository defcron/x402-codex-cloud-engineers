# x402 resource metadata consistency

Deterministically compare a caller-supplied x402 PaymentRequired challenge with the expected manifest for its resource. This catches stale or misconfigured challenges whose URL, description, MIME type, protocol version, or complete advertised offer set differs from the caller's expected contract.

The live payment-inspect route decodes and summarizes challenge fields. The live offer-compare route filters offers against network, token, and amount allowlists. This utility checks the complete supplied challenge against a separate resource manifest. It does not inspect signatures, payment proofs, or settlement, and does not fetch URLs or make network calls. This pre-payment contract check is distinct from Engineer 43's post-payment settlement-receipt reconciliation.

## Contract

Input is a JSON object containing:
- challenge: x402 PaymentRequired with x402Version (1 or 2), resource, and accepts.
- manifest: expected x402Version, resource, and accepts.
- manifest.resource.url is required. description and mimeType are compared when supplied.
- Each accepts array contains 1–20 offer objects. Object key order and offer list order do not matter; duplicate offers are counted.
- Serialized input is limited to 65,536 UTF-8 bytes.

Output contains consistent, offer counts, and bounded mismatch codes and paths. Values are not echoed. Invalid inputs throw X402MetadataInputError with a stable code; an HTTP adapter should map it to status 400.

## Example

The input has challenge and manifest objects with matching values:

    challenge.x402Version = 2
    challenge.resource = {
      url: "https://merchant.example/v1/report",
      description: "Build a report",
      mimeType: "application/json"
    }
    challenge.accepts = [{
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x1111111111111111111111111111111111111111",
      amount: "5000",
      payTo: "0x2222222222222222222222222222222222222222",
      maxTimeoutSeconds: 60,
      extra: { memo: "report" }
    }]

    manifest = {
      x402Version: 2,
      resource: challenge.resource,
      accepts: challenge.accepts
    }

Matching output:

    {
      "consistent": true,
      "challenge_version": 2,
      "manifest_version": 2,
      "expected_offer_count": 1,
      "actual_offer_count": 1,
      "mismatches": []
    }

A differing challenge URL reports resource_field_mismatch at resource.url. Offer mismatches include zero-based indexes for missing expected offers and unexpected challenge offers.

## Checks and runtime

Focused tests: node --test workstreams/17-x402-resource-metadata-consistency/test/compare.test.mjs

The module uses JavaScript built-ins only and requires no paid model/API credits at runtime. Production routing, pricing, payment middleware, deployment, and PayAPI publication remain with the central integrator.
