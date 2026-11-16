# JSON Pointer Path Contract Check

Engineer 07 reservation: `json-pointer-path-contract-check`.

Accept a JSON value and up to 100 RFC 6901 pointers. Report per path whether
syntax is valid, whether the path exists, and the JSON type if present.
Target values are never returned; the input is never modified.

## Distinctness

The live catalog already provides JSONPath query (which returns matched
values), JSON Pointer redaction (which removes targets), JSON Patch, and JSON
Merge Patch (which apply changes). This route answers only whether an exact
caller-selected path exists and what type it contains. It performs no value
query, redaction, or transformation. Peer #40 compares null/absent changes
between records; peer #08 audits duplicate YAML keys.

## Bounds and errors

Request shape is exactly `{"data": <JSON>, "pointers": [<string>, ...]}`.
Bounds: 1 MiB serialized JSON, 10,000 nodes, depth 64, 100 pointers, and
1,024 characters per pointer. Malformed pointer syntax returns an item-level
`invalid_pointer_syntax`; other pointers still run. Missing keys, invalid
array indexes, and traversal through a scalar return `valid: true,
exists: false`. Present null is `exists: true, type: "null"`. The root
pointer is the empty string. Array indexes use canonical decimal notation;
`-` is not a readable location.

Example input:
`{"data":{"user":{"name":"Ada","credential":"private"},"items":[null,4]},"pointers":["/user/name","/user/credential","/items/0","/missing"]}`

Example output (no values echoed):
`{"results":[{"pointer":"/user/name","valid":true,"exists":true,"type":"string","error":null},{"pointer":"/user/credential","valid":true,"exists":true,"type":"string","error":null},{"pointer":"/items/0","valid":true,"exists":true,"type":"null","error":null},{"pointer":"/missing","valid":true,"exists":false,"type":null,"error":null}]}`

`check_paths` is the deterministic core. A production adapter should map
`RequestError` to HTTP 400 and use existing x402 middleware. Suggested price:
$0.005 USDC per successful request, subject to integration and the live
challenge. No deployment or submission is included.

Run focused tests from repository root:
`python3 -m unittest discover -s workstreams/07-json-pointer-path-contract-check -p 'test_*.py' -v`
