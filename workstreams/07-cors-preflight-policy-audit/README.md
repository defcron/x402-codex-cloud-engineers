# CORS Preflight Policy Audit

Engineer 07 follow-on reservation: `cors-preflight-policy-audit`.

## Customer job

Given a captured browser preflight request and its response, decide whether
the response permits the requested origin, method, headers, and credential
mode under the CORS preflight checks. No network request or browser execution
is performed.

The production catalog has parsers and HTTP header tools, but no CORS route.
This checks the CORS policy decision across request/response fields; it is
distinct from #13 media-type negotiation, #27 forwarded-header trust, #33
cache-key policy, #47 header duplicate normalization, and #04's CSP policy
audit.

## Contract and limits

The request is exactly:
`{"request":{"origin":"…","method":"POST","headers":["authorization"],"credentials":true},"response":{"status":204,"headers":[["Access-Control-Allow-Origin","…"],["Access-Control-Allow-Methods","POST"],["Access-Control-Allow-Headers","authorization"],["Access-Control-Allow-Credentials","true"]]}}`

Response headers are supplied as ordered `[name,value]` pairs to preserve
duplicates. Output contains only `allowed` and stable issue codes; it never
echoes header values. Header names compare case-insensitively; methods compare
case-sensitively. Credentialed requests require an exact allowed origin and
`Access-Control-Allow-Credentials: true`. Wildcard allowed headers do not
cover `Authorization`.

Bounds: 100 request header names, 100 response header pairs, 8,192 characters
per response field value, 32 KiB combined response header bytes, 2,048
characters for Origin, and 256 characters per field name/method.

Malformed capture shape and invalid header syntax raise `RequestError`.
Policy failures return `allowed: false` with findings such as
`allow_origin_mismatch`, `method_not_allowed`, or
`requested_header_not_allowed`.

## Example

Input:
`{"request":{"origin":"https://agent.example","method":"POST","headers":["authorization","content-type"],"credentials":true},"response":{"status":204,"headers":[["Access-Control-Allow-Origin","https://agent.example"],["Access-Control-Allow-Methods","POST, OPTIONS"],["Access-Control-Allow-Headers","authorization, content-type"],["Access-Control-Allow-Credentials","true"]]}}`

Output:
`{"allowed":true,"issues":[]}`

`analyze_preflight` is the proposed deterministic, no-network core. Suggested
price is $0.005 USDC per successful analysis, subject to central integration
and the live x402 challenge. Not deployed or submitted.

Test command:
`python3 -m unittest discover -s workstreams/07-cors-preflight-policy-audit -p 'test_*.py' -v`
