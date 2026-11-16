# HTTP forwarding policy audit (prototype)

**Engineer 27 · service key:** `http-forwarded-header-trust-audit`

**State:** isolated, deterministic prototype; not integrated, deployed, or listed.

This utility answers a proxy security review question: given an explicit forwarding policy and caller-supplied observations at each proxy hop, which headers were forwarded outside the allowlist, required headers disappeared, forbidden headers passed through, or client-supplied proxy identity claims survived the edge?

It does not contact a proxy, fetch a URL, validate a live deployment, resolve trusted client IP ranges, or claim that a policy is secure. Findings describe only the supplied observations. Header values are not included in results.

## Example

The first hop is the untrusted ingress boundary; later hops are internal proxies. Values below are illustrative only.

```json
{
  "policy": {
    "allowed_headers": ["content-type", "x-request-id", "x-forwarded-for"],
    "required_headers": ["x-request-id"],
    "never_forward": ["authorization", "cookie"],
    "trusted_proxy_headers": ["x-forwarded-for"]
  },
  "hops": [
    {
      "name": "edge",
      "received": { "x-request-id": ["req-7"], "x-forwarded-for": ["198.51.100.9"] },
      "forwarded": { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] }
    },
    {
      "name": "gateway",
      "received": { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] },
      "forwarded": { "x-request-id": ["req-7"], "x-forwarded-for": ["203.0.113.18"] }
    }
  ]
}
```

Expected result: `ok: true`, two hops checked, four forwarded header names checked, and no findings. If the edge forwards the client's original `x-forwarded-for` value or sends `authorization`, the result identifies the hop and field name without returning the value.

The prototype exports a minimal Worker adapter at `POST /v1/http-forwarding-audit`. It has no payment middleware; do not present it as a live x402 route.

## Contract

Request fields:

- `policy.allowed_headers` (required): case-insensitive header-name allowlist.
- `policy.required_headers` (optional): names that must be forwarded by every observed hop; each must also be allowed.
- `policy.never_forward` (optional): names that must never be forwarded; cannot overlap the allowlist.
- `policy.trusted_proxy_headers` (optional): fields such as `forwarded` or `x-forwarded-for` that the edge must replace rather than trust from the caller.
- `hops` (required): 1–8 ordered observations, each with a name and `received` / `forwarded` maps. Each value is an array of observed strings.

Response fields are `ok`, `hop_count`, `checked_forwarded_header_count`, total `finding_count`, `findings_truncated`, `findings` and `note`. At most 256 findings are returned; the total count remains available if results are truncated. Finding codes are `forward_not_allowlisted`, `required_header_missing`, `never_forward_header_forwarded`, and `client_asserted_proxy_header_forwarded`. Findings contain severity, hop name and normalized header name. The utility never returns sample values.

Bounds: 65,536 request-body bytes; 8 hops; 64 header names per map or policy list; 8 values per field; 2,048 characters per value; 80 characters per hop name; 256 returned findings. Unsupported fields, duplicate case-insensitive names, invalid field names, CR/LF and other prohibited controls are rejected with HTTP 400; oversized bodies return 413.

## Focused check

```sh
node --test prototypes/engineer-27/http-forwarding-audit.test.mjs
```

This is intentionally separate from the existing single-header parsers and from Engineer 47's header normalization / duplicate-detection concept: those inspect or normalize individual header values; this audit compares configured policy with observations across ordered proxy hops.
