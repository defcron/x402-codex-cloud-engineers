# x402 Publication Coordination Ledger

Last reconciled: 2026-11-16 02:59 UTC  
Owner: CTO / central production integrator

## Canonical production catalog

The source of truth for live production routes is the deployed OpenAPI document:
https://agent-evidence-extractor.defcronyke.workers.dev/openapi.json

Production source repository: https://github.com/defcron/agent-evidence-utility  
Production Worker: https://agent-evidence-extractor.defcronyke.workers.dev

Check the live OpenAPI document immediately before reserving a feature and again before submission. Compare customer task and behavior, not route names. The 50 existing x402 engineer chats are the current in-flight concept pool; their chat titles are starting concepts, not proof of distinctness. Record a row here before coding. The cloud engineer repository is the shared assignment/checkpoint repository; production integration and deployment remain centralized with the CTO because no individual engineer deployment targets have been assigned.

## Engineer reservation roster

Status at checkpoint: 50 existing chats received the restart prompt; acknowledgements and running state are not yet verified. A concept reservation is not a production deployment or PayAPI submission.

| Engineer | Assigned starting concept | Reservation/state |
|---|---|---|
| 01–42 | Use the concept in each engineer's existing chat title | Awaiting acknowledgement and live-catalog deduplication; no submission quota reserved |
| 43 | `x402-settlement-receipt-reconcile` — reconcile a supplied x402 settlement receipt against expected network, asset, recipient, amount, and transaction reference; structural evidence only until chain verification is implemented | Reserved 2026-11-16 UTC; distinctness checked against live catalog (x402 payment challenge inspection and offer comparison) and visible peer concepts; implementation blocked pending writable isolated workspace and full peer reservation/candidate reconciliation |
| 44–50 | Use the concept in each engineer's existing chat title | Awaiting acknowledgement and live-catalog deduplication; no submission quota reserved |

Before implementation, replace the row with the specific service key and owner. If functionality overlaps another reservation or live route, do not keep both reservations; reassign one to a distinct customer job. Add commit/branch, tests, live URL, deployment version, listing ID/status, and exact checkpoint before progressing state.

## PayAPI submission limit ledger

Source checked from PayAPI Market's live `tools/list` response at 2026-11-16 02:59 UTC: https://payapi.market/mcp

- Up to 20 route URLs in a submission.
- Maximum 10 submissions/hour per wallet.
- Maximum 10 submissions/hour per contact email.
- Maximum 50 submissions/day per source IP.
- Maximum 50 submissions/day per pay-to address.
- The per-route caps still apply when multiple URLs are sent in one array.
- PayAPI says a same-wallet resubmission of the same API returns the existing listing ID; an existing pending listing may be updated with the same wallet/email.
- Listing is free; PayAPI takes 0% per job. PayAPI may perform a paid verification call of up to USD 0.10. That is verification, not organic customer revenue.

A submission attempt is not automatically an available slot. Before any new submission, reconcile accepted, rejected, pending, and uncertain requests for each applicable key and time window. Respect server responses and cooldowns; do not infer unique IPs or independent quota pools from separate chats. Reserve a slot before sending and release it only after the outcome is known.

## In-flight HTML forms submission

Route: https://agent-evidence-extractor.defcronyke.workers.dev/v1/html-forms  
Deployment: version 0.8.206, Cloudflare version 046262b8-00ed-45c4-80a2-28a2f58e18a9  
Price: USD 0.005 per call; caller-supplied HTML only; no runtime model calls.

A first PayAPI attempt was rejected because its placeholder detector treated the HTML sample as a placeholder. One follow-up submission used the public example URL and an expected-output sample. Its tool result was truncated during capture; listing ID and status are unknown. Do not submit this route again until the existing request is reconciled via an authoritative receipt/status. This uncertainty consumes unknown quota until resolved. No wallet top-up or self-funded test is authorized.

## Publication gates

- No paid model/API credits at service runtime; max price USD 0.10.
- A pending or accepted listing is not live/verified, and a verification call is not an organic sale.
- Do not submit placeholders, cloned endpoints, or local-only trivial utilities.
- Do not create identities, wallets, contact addresses, network routes, or accounts to multiply limits.
- No deployment, wallet spend, secret grant, or shared production change without an actually authorized control and a verified assignment.
- If a provider denies, rate-limits, or rejects an operation, record the exact response and honor its stated remedy.
