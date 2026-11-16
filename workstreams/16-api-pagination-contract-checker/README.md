# API pagination contract checker (engineer 16)

This deterministic prototype checks a captured sequence of paginated responses before an agent relies on it to implement a client. It supports cursor, offset, and page-number pagination. It does **not** fetch upstream URLs, make model/API calls, or certify an endpoint from a single example.

## Input contract

Send one JSON object with exactly `mode` and `pages`. Use one mode per trace.

For `cursor`, each page has `item_ids` (strings), `has_more` (boolean), optional `request_cursor` and `next_cursor` (string or null), and optional `total_count`:

```json
{
  "mode": "cursor",
  "pages": [
    {"request_cursor": null, "next_cursor": "c1", "has_more": true, "item_ids": ["ord-1", "ord-2"], "total_count": 3},
    {"request_cursor": "c1", "next_cursor": null, "has_more": false, "item_ids": ["ord-3"], "total_count": 3}
  ]
}
```

For `offset`, provide `request_offset` (first page must be 0), `limit` (1–100), optional `next_offset`, `has_more`, and `item_ids`. For `page_number`, provide `request_page` (first page must be 1), `page_size` (1–100), optional `next_page`, `has_more`, and `item_ids`. Each subsequent request value must match the previous page's continuation value.

## Output and checks

The response contains `ok`, `mode`, `pages_checked`, `unique_item_ids`, `findings`, and a scope note. Findings include page numbers and stable issue codes; item IDs and continuation tokens are never returned. Checks cover non-advancing or mismatched continuation, unexpected terminal continuation, pages after a terminal page, empty intermediate pages, item IDs repeated across pages, page-size overflow, and inconsistent totals. A trace ending while `has_more` is true is marked `trace_incomplete`, not passed.

Malformed data returns `ContractInputError`. On a changing upstream collection, duplicates or total-count changes can reflect concurrent writes between captured pages; treat them as evidence to investigate, not proof of a broken server. Limits: 1–10 pages, at most 100 item IDs per page / 1,000 per trace, 256 characters per ID, and 512 characters per cursor. The bounded UTF-8 JSON parser enforces the 64 KiB serialized request cap before decoding. A future HTTP wrapper should map malformed input to a 4xx; no HTTP wrapper is included in this isolated prototype.

## Example run

Save the cursor example above as `request.json`, then run:

```sh
python pagination_contract.py < request.json
```

Expected output:

```json
{"ok":true,"mode":"cursor","pages_checked":2,"unique_item_ids":3,"findings":[],"note":"Checks captured pagination behavior only; it does not fetch or certify the upstream API."}
```

Run focused checks from this directory:

```sh
python -m unittest test_pagination_contract.py -v
```

The implementation uses only the Python standard library. A paid route, if integrated later, must cost no more than $0.10 and require zero paid model/API credits at runtime.

## Known limits and distinction

This validates caller-supplied **cross-page behavior**. It cannot prove that a supplied trace came from the claimed server, detect omissions in an unobserved page, infer an API's intended semantics, or safely fetch arbitrary endpoints. The live Agent Evidence Utility already has an RFC 8288 Link-header parser and JSON Schema compatibility checks; those parse a header or compare schemas, while this prototype checks continuation progress and item/count invariants across multiple captured pages. PayAPI also lists broader OpenAPI contract-audit / endpoint-contract services. The specific observed-trace function appears distinct, but the CTO's shared candidate registry was unavailable during this workstream and must be reconciled before integration or submission.

## Checkpoint

Reservation: `workstreams/16-api-pagination-contract-checker/RESERVATION.md`. Implementation is isolated in the engineer repository branch `engineer-16-api-pagination-contract-checker`; it is not integrated into `defcron/agent-evidence-utility`, deployed, or submitted to PayAPI.
