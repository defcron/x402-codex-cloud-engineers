const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const MAX_SPEC_CHARS = 131072;
const MAX_PATHS = 500;
const MAX_OPERATIONS = 1000;
const MAX_JSON_NODES = 20000;
const MAX_JSON_DEPTH = 64;
const MAX_FINDINGS = 200;

function parseSpec(text, label) {
  if (typeof text !== "string" || text.length === 0) throw new TypeError(label + " must be a non-empty JSON string");
  if (text.length > MAX_SPEC_CHARS) throw new RangeError(label + " exceeds 131072 characters");
  let spec;
  try { spec = JSON.parse(text); } catch { throw new TypeError(label + " is not valid JSON"); }
  const version = spec?.openapi;
  if (!spec || typeof spec !== "object" || Array.isArray(spec) || typeof version !== "string" || !(version.startsWith("3.0.") || version.startsWith("3.1."))) {
    throw new TypeError(label + " must be an OpenAPI 3.0 or 3.1 document");
  }
  const stack = [[spec, 0]];
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (++nodes > MAX_JSON_NODES) throw new RangeError(label + " exceeds 20000 JSON nodes");
    if (depth > MAX_JSON_DEPTH) throw new RangeError(label + " exceeds JSON depth 64");
    for (const child of Object.values(value)) if (child && typeof child === "object") stack.push([child, depth + 1]);
  }
  if (!spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) throw new TypeError(label + ".paths must be an object");
  const paths = Object.entries(spec.paths);
  if (paths.length > MAX_PATHS) throw new RangeError(label + " exceeds 500 paths");
  const operations = new Map();
  for (const [path, item] of paths) {
    if (!path.startsWith("/") || !item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(label + " contains an invalid path item");
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      if (!op || typeof op !== "object" || Array.isArray(op)) throw new TypeError(label + " contains an invalid operation");
      const key = method.toUpperCase() + " " + path;
      operations.set(key, { path, method: method.toUpperCase(), op });
      if (operations.size > MAX_OPERATIONS) throw new RangeError(label + " exceeds 1000 operations");
    }
  }
  return operations;
}

function addFinding(findings, operation, change, backward, forward, detail) {
  findings.push({ operation, change, backward, forward, detail });
}

function compareInlineSchema(oldSchema, newSchema, pointer, context, findings, operation) {
  if (!oldSchema || !newSchema || typeof oldSchema !== "object" || typeof newSchema !== "object") return;
  if (oldSchema.$ref || newSchema.$ref) {
    addFinding(findings, operation, pointer, "inconclusive", "inconclusive", "Changed $ref is not resolved.");
    return;
  }
  if (oldSchema.type && newSchema.type && oldSchema.type !== newSchema.type) {
    addFinding(findings, operation, pointer + "/type", "breaking", "breaking", "Inline schema type changed.");
  }
  if (Array.isArray(oldSchema.enum) && Array.isArray(newSchema.enum)) {
    const removed = oldSchema.enum.filter(v => !newSchema.enum.some(n => JSON.stringify(n) === JSON.stringify(v)));
    if (removed.length) {
      const impact = context === "request" ? ["breaking", "compatible"] : ["compatible", "breaking"];
      addFinding(findings, operation, pointer + "/enum", impact[0], impact[1], "Allowed enum values were removed.");
    }
  }
  const oldProps = oldSchema.properties && typeof oldSchema.properties === "object" ? oldSchema.properties : {};
  const newProps = newSchema.properties && typeof newSchema.properties === "object" ? newSchema.properties : {};
  const newReq = new Set(Array.isArray(newSchema.required) ? newSchema.required : []);
  for (const key of Object.keys(newProps)) {
    if (!oldProps[key] && newReq.has(key) && context === "request") {
      addFinding(findings, operation, pointer + "/required/" + key, "breaking", "compatible", "A new required request property may reject old clients.");
    }
  }
  for (const key of Object.keys(oldProps)) {
    if (!newProps[key] && context === "response") {
      addFinding(findings, operation, pointer + "/properties/" + key, "breaking", "compatible", "A previously documented response property was removed.");
    }
  }
  for (const key of Object.keys(oldProps)) {
    if (newProps[key]) compareInlineSchema(oldProps[key], newProps[key], pointer + "/properties/" + key, context, findings, operation);
  }
}

function assess(before, after, direction = "both") {
  if (!["backward", "forward", "both"].includes(direction)) throw new TypeError("direction must be backward, forward, or both");
  const oldOps = parseSpec(before, "before");
  const newOps = parseSpec(after, "after");
  const keys = [...new Set([...oldOps.keys(), ...newOps.keys()])].sort();
  const matrix = [];
  let totalFindings = 0;
  for (const key of keys) {
    const oldEntry = oldOps.get(key), newEntry = newOps.get(key), findings = [];
    if (!oldEntry) addFinding(findings, key, "operation_added", "compatible", "breaking", "Operation is absent from the earlier API.");
    else if (!newEntry) addFinding(findings, key, "operation_removed", "breaking", "compatible", "Operation is absent from the proposed API.");
    else {
      const oldParameters = new Map((oldEntry.op.parameters ?? []).filter(p => p && p.name && p.in).map(p => [p.in + ":" + p.name, p]));
      const newParameters = new Map((newEntry.op.parameters ?? []).filter(p => p && p.name && p.in).map(p => [p.in + ":" + p.name, p]));
      for (const [id, p] of newParameters) {
        const prior = oldParameters.get(id);
        if (p.required && (!prior || !prior.required)) addFinding(findings, key, "parameter:" + id, "breaking", "compatible", "A request parameter became newly required.");
        if (prior?.schema && p.schema) compareInlineSchema(prior.schema, p.schema, "parameters/" + id + "/schema", "request", findings, key);
      }
      if (!oldEntry.op.requestBody?.required && newEntry.op.requestBody?.required) {
        addFinding(findings, key, "requestBody/required", "breaking", "compatible", "The request body became required.");
      }
      const oldContent = oldEntry.op.requestBody?.content ?? {}, newContent = newEntry.op.requestBody?.content ?? {};
      for (const media of Object.keys(oldContent)) if (newContent[media]) compareInlineSchema(oldContent[media].schema, newContent[media].schema, "requestBody/content/" + media + "/schema", "request", findings, key);
      const oldResponses = oldEntry.op.responses ?? {}, newResponses = newEntry.op.responses ?? {};
      for (const status of Object.keys(oldResponses)) {
        if (!newResponses[status]) addFinding(findings, key, "responses/" + status, "breaking", "compatible", "A documented response status was removed.");
        else {
          const oc = oldResponses[status]?.content ?? {}, nc = newResponses[status]?.content ?? {};
          for (const media of Object.keys(oc)) if (nc[media]) compareInlineSchema(oc[media].schema, nc[media].schema, "responses/" + status + "/content/" + media + "/schema", "response", findings, key);
        }
      }
    }
    totalFindings += findings.length;
    matrix.push({ operation: key, status: !oldEntry ? "added" : !newEntry ? "removed" : findings.length ? "changed" : "unchanged", findings });
  }
  const truncated = totalFindings > MAX_FINDINGS;
  let remaining = MAX_FINDINGS;
  for (const row of matrix) {
    row.findings = row.findings.slice(0, remaining);
    remaining -= row.findings.length;
  }
  return { direction, before_operations: oldOps.size, after_operations: newOps.size, compared_operations: matrix.length, findings: Math.min(totalFindings, MAX_FINDINGS), truncated, operations: matrix };
}

export function compareOpenApiVersions(beforeJson, afterJson, options = {}) {
  return assess(beforeJson, afterJson, options.direction ?? "both");
}
