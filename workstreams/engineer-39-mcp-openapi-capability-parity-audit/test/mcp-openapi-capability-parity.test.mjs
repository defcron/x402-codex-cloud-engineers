import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCapabilityParity,
  ParityAuditError,
} from "../src/mcp-openapi-capability-parity.mjs";

const api = {
  openapi: "3.1.0",
  paths: {
    "/v1/report": {
      post: {
        operationId: "createReport",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  source: { type: "string" },
                  limit: { type: "integer" },
                },
                required: ["source"],
              },
            },
          },
        },
      },
    },
  },
};

const matchingTool = {
  name: "createReport",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["source"],
  },
};

test("matching operation and MCP input schema have no findings", () => {
  assert.equal(
    auditCapabilityParity({ openapi: api, tools: [matchingTool] }).finding_count,
    0
  );
});

test("compares requiredness and types", () => {
  const result = auditCapabilityParity({
    openapi: api,
    tools: [{
      ...matchingTool,
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "number" },
          limit: { type: "string" },
        },
        required: [],
      },
    }],
  });

  assert.deepEqual(
    new Set(result.findings.map(({ code }) => code)),
    new Set(["input_type_mismatch", "input_requiredness_mismatch"])
  );
});

test("reports duplicate operationIds without requiring a matching tool", () => {
  const duplicateApi = structuredClone(api);
  duplicateApi.paths["/v2/report"] = {
    get: { operationId: "createReport" },
  };

  const result = auditCapabilityParity({ openapi: duplicateApi, tools: [] });
  assert.ok(result.findings.some(({ code }) => code === "duplicate_operation_id"));
});

test("marks a mapping to duplicate operationIds ambiguous", () => {
  const duplicateApi = structuredClone(api);
  duplicateApi.paths["/v2/report"] = {
    get: { operationId: "createReport" },
  };

  const result = auditCapabilityParity({
    openapi: duplicateApi,
    tools: [{ name: "createReport" }],
  });
  assert.ok(result.findings.some(({ code }) => code === "ambiguous_operation_mapping"));
});

test("reports multiple MCP tools mapped to one operation", () => {
  const result = auditCapabilityParity({
    openapi: api,
    tools: [
      matchingTool,
      {
        name: "report",
        _meta: { "openapi.operationId": "createReport" },
        inputSchema: matchingTool.inputSchema,
      },
    ],
  });

  assert.ok(result.findings.some(({ code }) => code === "mapping_collision"));
});

test("does not infer mapping from approximate names or descriptions", () => {
  const result = auditCapabilityParity({
    openapi: api,
    tools: [{
      name: "create-report",
      description: "Calls POST /v1/report",
    }],
  });

  assert.ok(result.findings.some(({ code }) => code === "unmapped_tool"));
  assert.ok(result.findings.some(({ code }) => code === "uncovered_operation"));
});

test("enforces operation and tool limits", () => {
  assert.throws(
    () => auditCapabilityParity({
      openapi: api,
      tools: Array(501).fill(matchingTool),
    }),
    (error) => error instanceof ParityAuditError && error.code === "too_many_tools"
  );

  const manyOperations = {
    openapi: "3.1.0",
    paths: Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => [
        "/p" + i,
        { get: { operationId: "op" + i } },
      ])
    ),
  };
  assert.throws(
    () => auditCapabilityParity({ openapi: manyOperations, tools: [] }),
    (error) =>
      error instanceof ParityAuditError &&
      error.code === "too_many_operations"
  );
});

test("rejects missing operationIds and excessive nesting", () => {
  assert.throws(
    () => auditCapabilityParity({
      openapi: {
        openapi: "3.1.0",
        paths: { "/missing": { get: {} } },
      },
      tools: [],
    }),
    (error) =>
      error instanceof ParityAuditError &&
      error.code === "missing_operation_id"
  );

  const deeplyNested = { openapi: "3.1.0", paths: {}, extra: {} };
  let cursor = deeplyNested;
  for (let i = 0; i < 65; i++) {
    cursor.extra = {};
    cursor = cursor.extra;
  }
  assert.throws(
    () => auditCapabilityParity({ openapi: deeplyNested, tools: [] }),
    (error) => error instanceof ParityAuditError && error.code === "input_too_deep"
  );
});
