const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const SOURCES = new Set(["path_prefix", "query", "header"]);
export const MAX_OPENAPI_CHARS = 262144;
export const MAX_PATHS = 1000;
export const MAX_OPERATIONS = 2000;
export const MAX_SELECTORS = 32;
export const MAX_PAIRS = 64;

export class RoutingInspectorError extends Error {
  constructor(message, status = 400) { super(message); this.name = "RoutingInspectorError"; this.status = status; }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function boundedString(value, label, max, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new RoutingInspectorError(label + " must be a non-empty string.");
  if (value.length > max) throw new RoutingInspectorError(label + " exceeds " + max + " characters.", 413);
  return value;
}
function validateDocument(text) {
  boundedString(text, "openapi_json", MAX_OPENAPI_CHARS);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new RoutingInspectorError("openapi_json must contain valid JSON."); }
  if (!isRecord(doc) || typeof doc.openapi !== "string" || !(doc.openapi.startsWith("3.0.") || doc.openapi.startsWith("3.1."))) {
    throw new RoutingInspectorError("openapi_json must be an OpenAPI 3.0 or 3.1 document.");
  }
  if (!isRecord(doc.info) || !isRecord(doc.paths)) throw new RoutingInspectorError("OpenAPI info and paths objects are required.");
  const stack = [[doc, 0]];
  let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (!isRecord(value) && !Array.isArray(value)) continue;
    if (++nodes > 30000) throw new RoutingInspectorError("OpenAPI document exceeds 30000 JSON nodes.", 413);
    if (depth > 64) throw new RoutingInspectorError("OpenAPI document exceeds depth 64.", 413);
    for (const child of Object.values(value)) if (child && typeof child === "object") stack.push([child, depth + 1]);
  }
  const paths = Object.entries(doc.paths);
  if (paths.length > MAX_PATHS) throw new RoutingInspectorError("OpenAPI document exceeds 1000 paths.", 413);
  let operationCount = 0;
  for (const [path, item] of paths) {
    boundedString(path, "OpenAPI path", 512);
    if (!path.startsWith("/") || !isRecord(item)) throw new RoutingInspectorError("OpenAPI paths must map absolute paths to objects.");
    pathSegments(path);
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      if (!isRecord(operation)) throw new RoutingInspectorError("OpenAPI operation must be an object.");
      if (++operationCount > MAX_OPERATIONS) throw new RoutingInspectorError("OpenAPI document exceeds 2000 operations.", 413);
    }
  }
  return { doc, paths, operationCount };
}
function pathSegments(path) {
  return path.split("/").slice(1).map(segment => {
    if (segment.startsWith("{") && segment.endsWith("}") && segment.length > 2 && !/[{}]/.test(segment.slice(1, -1))) {
      return { parameter: true };
    }
    if (/[{}]/.test(segment)) throw new RoutingInspectorError("OpenAPI path contains a malformed template segment.");
    return { literal: segment };
  });
}
function matchTemplate(template, requestPath) {
  const expected = pathSegments(template), actual = requestPath.split("/").slice(1);
  return expected.length === actual.length && expected.every((part, i) => part.parameter || part.literal === actual[i]);
}
function validatePairs(value, label, { header = false } = {}) {
  if (!Array.isArray(value ?? [])) throw new RoutingInspectorError(label + " must be an array.");
  const pairs = value ?? [];
  if (pairs.length > MAX_PAIRS) throw new RoutingInspectorError(label + " exceeds 64 entries.", 413);
  return pairs.map(pair => {
    if (!isRecord(pair)) throw new RoutingInspectorError(label + " entries must be objects.");
    const name = boundedString(pair.name, label + " name", 128);
    const itemValue = boundedString(pair.value, label + " value", 1024, true);
    if (/[\r\n]/.test(name) || /[\r\n]/.test(itemValue)) throw new RoutingInspectorError(label + " cannot contain CR or LF.");
    return { name: header ? name.toLowerCase() : name, value: itemValue };
  });
}
function validateSelectors(value) {
  if (!Array.isArray(value) || value.length === 0) throw new RoutingInspectorError("selectors must be a non-empty array.");
  if (value.length > MAX_SELECTORS) throw new RoutingInspectorError("selectors exceeds 32 entries.", 413);
  return value.map((selector, index) => {
    if (!isRecord(selector) || !SOURCES.has(selector.source)) throw new RoutingInspectorError("selectors[" + index + "] has an unsupported source.");
    const version = boundedString(selector.version, "selector version", 64);
    if (selector.source === "path_prefix") {
      const prefix = boundedString(selector.value, "path_prefix value", 512);
      if (!prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#")) throw new RoutingInspectorError("path_prefix value must be an absolute path prefix.");
      return { source: selector.source, version, value: prefix };
    }
    const name = boundedString(selector.name, "selector name", 128);
    const value = boundedString(selector.value, "selector value", 256);
    return { source: selector.source, version, name: selector.source === "header" ? name.toLowerCase() : name, value };
  });
}
function resolveSelectors(request, rules) {
  const matches = [];
  for (const rule of rules) {
    let matched = false;
    if (rule.source === "path_prefix") {
      matched = request.path === rule.value || request.path.startsWith(rule.value.endsWith("/") ? rule.value : rule.value + "/");
    } else {
      const pairs = rule.source === "query" ? request.query : request.headers;
      matched = pairs.some(pair => pair.name === rule.name && pair.value === rule.value);
    }
    if (matched) matches.push({ source: rule.source, version: rule.version, ...(rule.name ? { name: rule.name } : {}) });
  }
  const versions = [...new Set(matches.map(match => match.version))];
  return { status: versions.length === 0 ? "unmatched" : versions.length === 1 ? "selected" : "ambiguous", selected_version: versions.length === 1 ? versions[0] : null, matches };
}
function resolveRoute(paths, method, requestPath) {
  const exact = paths.find(([path]) => path === requestPath);
  let candidates;
  if (exact) candidates = [exact];
  else candidates = paths.filter(([path]) => path.includes("{") && matchTemplate(path, requestPath));
  if (candidates.length === 0) return { status: "not_found", matched_operation: null, allowed_methods: [] };
  if (candidates.length > 1) return { status: "ambiguous", matched_operation: null, allowed_methods: [] };
  const [path, item] = candidates[0];
  const allowed = Object.keys(item).filter(key => METHODS.has(key.toLowerCase())).map(key => key.toUpperCase()).sort();
  const op = Object.entries(item).find(([key]) => key.toLowerCase() === method.toLowerCase());
  if (!op) return { status: "method_not_allowed", matched_operation: null, allowed_methods: allowed };
  return { status: "matched", matched_operation: { method: method.toUpperCase(), path, operation_id: typeof op[1].operationId === "string" ? op[1].operationId : null, summary: typeof op[1].summary === "string" ? op[1].summary : null }, allowed_methods: allowed };
}

export function inspectApiVersionRouting(input) {
  if (!isRecord(input)) throw new RoutingInspectorError("Request body must be an object.");
  const { doc, paths, operationCount } = validateDocument(input.openapi_json);
  if (!isRecord(input.request)) throw new RoutingInspectorError("request must be an object.");
  const method = boundedString(input.request.method, "request.method", 16).toUpperCase();
  if (!METHODS.has(method.toLowerCase())) throw new RoutingInspectorError("request.method is not a supported HTTP method.");
  const path = boundedString(input.request.path, "request.path", 2048);
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) throw new RoutingInspectorError("request.path must be an absolute path without query or fragment.");
  const request = {
    method,
    path,
    query: validatePairs(input.request.query, "request.query"),
    headers: validatePairs(input.request.headers, "request.headers", { header: true })
  };
  const selectors = validateSelectors(input.selectors);
  return {
    openapi_version: doc.openapi,
    api_version: typeof doc.info.version === "string" ? doc.info.version : null,
    path_count: paths.length,
    operation_count: operationCount,
    selector: resolveSelectors(request, selectors),
    route: resolveRoute(paths, method, path)
  };
}
