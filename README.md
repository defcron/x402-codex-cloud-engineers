# x402-codex-cloud-engineers

## HTTP media-type negotiation audit

This isolated Worker artifact audits whether a captured response `Content-Type`
is acceptable under the request's captured `Accept` value. It reports the
governing media range, its effective quality, and whether it explicitly excludes
the returned representation.

```http
POST /audit
Content-Type: application/json

{
  "accept": "application/json, text/*;q=0.5",
  "content_type": "text/plain;charset=UTF-8"
}
```

Example response:

```json
{
  "content_type": "text/plain;charset=UTF-8",
  "acceptable": true,
  "quality": 0.5,
  "matched_range": {
    "type": "text",
    "subtype": "*",
    "parameters": {},
    "specificity": { "type": 1, "subtype": 0, "parameters": 0 }
  },
  "reason": "acceptable"
}
```

If `Accept` is absent, the representation is treated as acceptable. A
specific `q=0` range governs over a less-specific wildcard and reports
`reason: "quality_zero"`. A response type with no matching range reports
`reason: "no_matching_range"`. The utility does not fetch or replay a
request, inspect a body, or infer API versions.

Range precedence follows RFC 9110: exact type, exact subtype, then matching
media parameters. A broader wildcard cannot override a more specific range by
carrying more parameters.

Inputs are bounded to a 16 KiB JSON body, a 4 KiB Accept value, and a
256-character Content-Type. Control characters and malformed quoted parameters
are rejected. The parser supports `*/*`, `type/*`, media parameters, quoted
values, and q values with up to three decimal places. Charset parameter values
are matched case-insensitively. A `q` parameter is treated as the weight even
when it appears before another media parameter.

The current publication ledger assigns engineer 13
`http-media-type-negotiation-audit`. It is distinct from engineer 27's
forwarded-header trust audit, engineer 42's vendor media/API-version audit, and
engineer 47's duplicate header normalization check: this operation examines
whether one recorded response media type satisfies one recorded request
preference. The live catalog has adjacent Link, Retry-After, and
Content-Disposition parsers, with different customer jobs.

This is a tested isolated implementation. It has no x402 payment middleware,
assigned route or price, production deployment configuration, or marketplace
metadata. The ledger allocates no deployment target or PayAPI quota slot.

### Local checks

Run with Node.js 20 or later:

```sh
npm test
```
