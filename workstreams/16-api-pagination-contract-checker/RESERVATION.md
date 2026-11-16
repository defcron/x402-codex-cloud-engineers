# Workstream 16 reservation

- **Service key:** `api-pagination-contract-checker`
- **Owner:** Engineer 16
- **State:** Reserved in this isolated branch; shared CTO registry reconciliation is still pending.
- **Customer job:** Check a caller-supplied, bounded sequence of paginated API response snapshots for pagination-specific contract failures before an agent builds a production client.
- **Input:** Declared pagination mode and rules plus 1–10 captured pages (status, selected headers, continuation value, and bounded record identifiers / item counts). No live URL fetch, credentials, or payment execution.
- **Output:** Structured findings with page index and issue codes, including non-advancing/repeated cursors, duplicate continuation links, unexpected empty intermediate pages, invalid item-count/total-count relationships, or a terminal-page inconsistency.
- **Example:** Given two cursor pages where page 1 returns `next=abc` and page 2 again returns `next=abc`, report `cursor_not_advancing` at page 2.
- **Failures:** Reject malformed JSON, unsupported pagination mode, missing required fields, too many pages/items, oversized payloads, duplicate page indexes, or inconsistent field types with a 4xx response. Never echo record values.
- **Bounded prototype target:** At most 10 pages, 100 item identifiers per page, and 64 KiB JSON input; deterministic, no model/API credits, no external fetch, and per-call price at most $0.10 if integrated.
- **Distinctness evidence (live service):** Production OpenAPI v0.8.206 documents `/v1/http-link-parse` as parsing RFC 8288 Link headers without following links and `/v1/json-schema-compatibility` as comparing schema versions. Its `/llms.txt` also describes JSON schema validation and generic HTTP-header operations. Those inspect individual syntax/schema objects; this workstream would inspect cross-page continuation and item-count behavior across an observed trace. PayAPI's live catalog lists generic OpenAPI contract auditing / endpoint contract proof but search found no paginated-response-trace checker.
- **Unresolved overlap check:** The CTO's shared candidate/reservation registry is not present in the mounted repo or accessible Notion search results. This branch reservation does not replace that shared registry; confirm against the roster before integrating or submitting.
- **Last checkpoint:** 2026-11-16 UTC. Repository `defcron/x402-codex-cloud-engineers`, based on current remote `main`; local mounted checkout is stale, read-only, and on branch `work` at `01168bc`.
- **Next action:** Reconcile the service key against the CTO registry/candidate list; then implement and test an isolated pure validator. Integration into `defcron/agent-evidence-utility`, deployment, payment verification, and PayAPI submission are not authorized by this checkpoint.
