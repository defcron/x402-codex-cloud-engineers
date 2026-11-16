# Engineer 10 integration handoff

## Assignment and distinctness

The current `PUBLICATION_LEDGER.md` at main commit `0ded06c2b08b2677c4d02b324726a7f95d078704` assigns Engineer 10 the exclusive service key `jwks-rotation-cache-policy`. It explicitly distinguishes this work from Engineer 9's one-document `jwks-static-preflight`. Engineer 2's candidate is a general cache TTL audit; this service's central output is the JWKS-specific overlap requirement derived from cache age + stale allowance + token lifetime + safety margin.

The live Worker OpenAPI/llms catalog and PayAPI searches were checked earlier in this workstream. The catalog has JWT inspection and HTTP parsers, but no JWKS rotation lifecycle endpoint. No PayAPI listing was found for JWKS/key-rotation checking. Recheck live catalog and ledger before any submission.

## Artifact

The initial isolated source artifact is commit `3d06a81`; the correctness refinement is commit `5d9c134` on branch `engineer-10/jwks-rotation-cache-policy`, based on current engineer-repository main `0ded06c`.

The branch is pushed and available for review in [draft PR #5](https://github.com/defcron/x402-codex-cloud-engineers/pull/5). It is mergeable; it does not modify or deploy the production Worker.

- `validator.mjs`: bounded, offline implementation; no dependencies, network fetches, model calls, or input retention.
- `validator.test.mjs`: focused `node:test` coverage.
- `example.json`: old/new key snapshots with cache headers and caller policy.
- `README.md`: contract, limits, output, caveats, example and test commands.

## Contract and intended route integration

The pure function `validateJwksCachePolicy(input)` can be imported by the production Worker. A candidate route is `POST /v1/jwks-rotation-cache-policy`; the route name and price still require CTO integration approval. Keep it behind the existing x402 payment middleware and add its request/response schemas, example endpoint, OpenAPI entry, llms entry, and catalog entry in the normal Worker discovery surfaces. No route or payment wiring is included in this isolated artifact.

The runtime must stay deterministic and use zero paid model/API credits. Do not price above USD 0.10; the exact price is unassigned and must be confirmed against the applicable live challenge before publication.

## Exact local verification

From the checkout root:

```sh
node --test workstream-10/validator.test.mjs
node --input-type=module -e 'import fs from "node:fs"; import {validateJwksCachePolicy} from "./workstream-10/validator.mjs"; const r=validateJwksCachePolicy(JSON.parse(fs.readFileSync("workstream-10/example.json", "utf8"))); console.log(JSON.stringify({ok:r.ok,summary:r.summary,rotations:r.rotations,findings:r.findings}, null, 2));'
node --check workstream-10/validator.mjs
node --check workstream-10/validator.test.mjs
```

Latest checks: 6 tests pass. Expected example: `ok:true`; 4 snapshots; one old key removed and one new key added; 1,200 seconds sampled overlap against a derived 1,020-second requirement; no findings. Additional cases cover no replacement keys, `s-maxage` precedence, and non-contiguous co-presence samples.

## Central integration gates

The ledger says there is no Engineer 10 deployment target or PayAPI quota slot. The PayAPI ledger also records an earlier uncertain HTML-forms submission with unknown listing id/status; reconcile that receipt before calculating shared quota availability. The CTO/central integrator must assign the production branch/target and a reserved slot before deployment/publication. Do not deploy or submit this local-only artifact. After an assigned integration, run the production repo test/build/dry-run, deploy through the authorized control, verify health, functionality, discovery, and unpaid HTTP 402, then submit once only after quota reconciliation.
