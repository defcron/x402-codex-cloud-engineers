const MAX_OPERATIONS = 1000;
const MAX_TOOLS = 500;
const MAX_DEPTH = 64;
const MAX_FINDINGS = 5000;

const METHODS = new Set([
  "get", "put", "post", "delete", "options", "head", "patch", "trace",
]);

export class ParityAuditError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ParityAuditError";
    this.code = code;
  }
}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function checkDepth(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new ParityAuditError("input_too_deep", "Maximum input depth exceeded.");
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) checkDepth(child, depth + 1);
  }
}

function requestSchema(operation) {
  const content = operation.requestBody?.content;
  if (content === undefined) return null;
  if (!isObject(content)) return { unsupported: true };

  const mediaType = Object.keys(content).find((key) =>
    key.toLowerCase() === "application/json" ||
    key.toLowerCase().endsWith("+json")
  );
  if (!mediaType) return null;

  const schema = content[mediaType]?.schema;
  return isObject(schema) ? schema : { unsupported: true };
}

function collectOperations(openapi) {
  if (
    typeof openapi.openapi !== "string" ||
    !/^3\.[01]\./.test(openapi.openapi)
  ) {
    throw new ParityAuditError(
      "unsupported_openapi_version",
      "Expected OpenAPI 3.0.x or 3.1.x."
    );
  }
  if (!isObject(openapi.paths)) {
    throw new ParityAuditError("invalid_paths", "openapi.paths must be an object.");
  }

  const operations = [];
  for (const [path, pathItem] of Object.entries(openapi.paths)) {
    if (!path.startsWith("/") || !isObject(pathItem)) {
      throw new ParityAuditError("invalid_path", "Invalid OpenAPI path item.");
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      if (!isObject(operation)) {
        throw new ParityAuditError("invalid_operation", "Operation must be an object.");
      }
      if (
        typeof operation.operationId !== "string" ||
        !operation.operationId.trim()
      ) {
        throw new ParityAuditError(
          "missing_operation_id",
          method.toUpperCase() + " " + path + " requires operationId."
        );
      }

      operations.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        path,
        schema: requestSchema(operation),
      });
    }
  }

  if (operations.length > MAX_OPERATIONS) {
    throw new ParityAuditError(
      "too_many_operations",
      "At most 1000 operations are allowed."
    );
  }
  return operations;
}

function typeOf(value) {
  if (Array.isArray(value)) return [...value].sort().join("|");
  return typeof value === "string" ? value : null;
}

function compareSchema(operation, tool, add) {
  const apiSchema = operation.schema;
  const toolSchema = tool.inputSchema;

  if (apiSchema === null && toolSchema === undefined) return;
  if (
    !apiSchema ||
    apiSchema.unsupported ||
    !isObject(toolSchema) ||
    apiSchema.$ref ||
    toolSchema.$ref ||
    !isObject(apiSchema.properties) ||
    !isObject(toolSchema.properties)
  ) {
    add({
      code: "schema_comparison_inconclusive",
      operation_id: operation.id,
      tool: tool.name,
      message: "Comparable top-level JSON properties are unavailable or reference-based.",
    });
    return;
  }

  const apiRequired = new Set(
    Array.isArray(apiSchema.required) ? apiSchema.required : []
  );
  const toolRequired = new Set(
    Array.isArray(toolSchema.required) ? toolSchema.required : []
  );

  for (const field of Object.keys(apiSchema.properties)) {
    if (!(field in toolSchema.properties)) {
      add({
        code: "missing_tool_input_field",
        operation_id: operation.id,
        tool: tool.name,
        field,
      });
      continue;
    }

    const apiType = typeOf(apiSchema.properties[field]?.type);
    const toolType = typeOf(toolSchema.properties[field]?.type);
    if (apiType && toolType && apiType !== toolType) {
      add({
        code: "input_type_mismatch",
        operation_id: operation.id,
        tool: tool.name,
        field,
        openapi_type: apiType,
        mcp_type: toolType,
      });
    }

    if (apiRequired.has(field) !== toolRequired.has(field)) {
      add({
        code: "input_requiredness_mismatch",
        operation_id: operation.id,
        tool: tool.name,
        field,
        openapi_required: apiRequired.has(field),
        mcp_required: toolRequired.has(field),
      });
    }
  }

  for (const field of Object.keys(toolSchema.properties)) {
    if (!(field in apiSchema.properties)) {
      add({
        code: "extra_tool_input_field",
        operation_id: operation.id,
        tool: tool.name,
        field,
      });
    }
  }
}

export function auditCapabilityParity({ openapi, tools }) {
  if (!isObject(openapi)) {
    throw new ParityAuditError("invalid_openapi", "openapi must be an object.");
  }
  if (!Array.isArray(tools)) {
    throw new ParityAuditError("invalid_tools", "tools must be an array.");
  }
  if (tools.length > MAX_TOOLS) {
    throw new ParityAuditError("too_many_tools", "At most 500 tools are allowed.");
  }

  checkDepth(openapi);
  checkDepth(tools);

  const operations = collectOperations(openapi);
  const findings = [];
  const add = (finding) => {
    if (findings.length < MAX_FINDINGS) findings.push(finding);
  };

  const operationsById = new Map();
  for (const operation of operations) {
    const group = operationsById.get(operation.id) || [];
    group.push(operation);
    operationsById.set(operation.id, group);
  }

  // Report duplicate IDs even when no MCP tool references them.
  for (const [id, group] of operationsById) {
    if (group.length > 1) {
      add({
        code: "duplicate_operation_id",
        operation_id: id,
        operations: group.map(({ method, path }) => ({ method, path })),
        message: "OpenAPI operationId must be unique.",
      });
    }
  }

  const toolsByMapping = new Map();
  const matchedOperations = new Map();

  for (const [index, tool] of tools.entries()) {
    if (!isObject(tool) || typeof tool.name !== "string" || !tool.name.trim()) {
      throw new ParityAuditError(
        "invalid_tool_name",
        "tools[" + index + "].name must be non-empty."
      );
    }

    // Exact operationId match by default; metadata supports tools with other names.
    const operationId = tool._meta?.["openapi.operationId"] ?? tool.name;
    if (typeof operationId !== "string" || !operationId.trim()) {
      throw new ParityAuditError("invalid_tool_mapping", "Invalid operationId mapping.");
    }

    const mappedGroup = toolsByMapping.get(operationId) || [];
    mappedGroup.push(tool);
    toolsByMapping.set(operationId, mappedGroup);

    const candidates = operationsById.get(operationId) || [];
    if (candidates.length > 1) {
      add({
        code: "ambiguous_operation_mapping",
        operation_id: operationId,
        tool: tool.name,
        message: "Mapping targets duplicate OpenAPI operationIds.",
      });
      continue;
    }
    if (candidates.length === 0) {
      add({
        code: "unmapped_tool",
        tool: tool.name,
        operation_id: operationId,
        message: "No OpenAPI operation matches this mapping.",
      });
      continue;
    }

    const operation = candidates[0];
    const matched = matchedOperations.get(operationId) || [];
    matched.push(tool);
    matchedOperations.set(operationId, matched);
    compareSchema(operation, tool, add);
  }

  // Report collisions independently of whether the target ID is itself duplicated.
  for (const [operationId, group] of toolsByMapping) {
    if (group.length > 1) {
      add({
        code: "mapping_collision",
        operation_id: operationId,
        tools: group.map((tool) => tool.name),
        message: "Multiple MCP tools map to one operationId.",
      });
    }
  }

  for (const operation of operations) {
    if (!(matchedOperations.get(operation.id) || []).length) {
      add({
        code: "uncovered_operation",
        operation_id: operation.id,
        method: operation.method,
        path: operation.path,
        message: "No MCP tool maps to this operation.",
      });
    }
  }

  return {
    operation_count: operations.length,
    tool_count: tools.length,
    finding_count: findings.length,
    findings,
    truncated: findings.length >= MAX_FINDINGS,
    note: "Mapping requires exact operationId equality or _meta[openapi.operationId]. Names and descriptions are not used to infer equivalence. Schema comparison is top-level; refs are not resolved.",
  };
}
