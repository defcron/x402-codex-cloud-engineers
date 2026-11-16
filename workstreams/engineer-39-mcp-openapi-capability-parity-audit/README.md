# MCP / OpenAPI capability parity audit

This bounded, deterministic utility compares OpenAPI operations with MCP tool definitions. It finds uncovered operations, unmapped tools, ambiguous or duplicate mappings, and differences in top-level JSON request fields, field types, and requiredness.

The audit is about capability coverage across two catalogs. It does not lint tool-call arguments or tool definitions alone, execute tools, resolve references, or infer equivalence from descriptions or similar names.

## Mapping

A tool maps to an operation when its `name` exactly equals the operation's `operationId`. For differing names, set the explicit MCP metadata key `_meta["openapi.operationId"]`. Duplicate OpenAPI operation IDs are reported and any tool mapped to one is marked ambiguous. Multiple tools mapped to one operation ID are reported as a collision.

## Bounds and limitations

- OpenAPI 3.0.x or 3.1.x; at most 1,000 operations.
- At most 500 MCP tools; maximum nesting depth 64.
- At most 5,000 returned findings.
- Schema comparison checks top-level JSON property presence, primitive/container type labels, and requiredness.
- Reference-based schemas are reported as inconclusive; no remote or local references are resolved.
- Non-JSON request bodies are outside this comparison.

## Example

Given an OpenAPI operation with `operationId: "createReport"` and a tool named `createReport`, matching top-level `inputSchema` properties, types and requiredness yields zero findings. A tool named `create-report` does not match automatically, even if its description contains the route path. Add the explicit metadata mapping if that tool implements the operation.

Run focused tests from this workstream directory with:

    node --test test/mcp-openapi-capability-parity.test.mjs
