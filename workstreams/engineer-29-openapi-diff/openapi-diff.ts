export const OPENAPI_DIFF_PRICE_USD = 0.005;
export const OPENAPI_DIFF_MAX_DOCUMENT_CHARS = 262_144;
export const OPENAPI_DIFF_MAX_TOTAL_CHARS = 524_288;
export const OPENAPI_DIFF_MAX_PATHS = 1_000;
export const OPENAPI_DIFF_MAX_FINDINGS = 200;
export const OPENAPI_DIFF_MAX_HTTP_BODY_BYTES = 4 * 1024 * 1024;
export const OPENAPI_DIFF_INPUT_SCHEMA = {
  type: "object",
  required: ["before_openapi_json", "after_openapi_json"],
  additionalProperties: false,
  properties: {
    before_openapi_json: { type: "string", minLength: 1, maxLength: OPENAPI_DIFF_MAX_DOCUMENT_CHARS },
    after_openapi_json: { type: "string", minLength: 1, maxLength: OPENAPI_DIFF_MAX_DOCUMENT_CHARS },
  },
} as const;
export const OPENAPI_DIFF_OUTPUT_SCHEMA = {
  type: "object",
  required: ["assessment", "operations_compared", "breaking_change_count", "inconclusive_change_count", "truncated", "changes", "note"],
  additionalProperties: false,
  properties: {
    assessment: { type: "string", enum: ["breaking_changes_detected", "inconclusive", "no_breaking_changes_detected"] },
    operations_compared: { type: "integer", minimum: 0 },
    breaking_change_count: { type: "integer", minimum: 0 },
    inconclusive_change_count: { type: "integer", minimum: 0 },
    truncated: { type: "boolean" },
    changes: { type: "array", maxItems: OPENAPI_DIFF_MAX_FINDINGS, items: {
      type: "object", required: ["direction", "path", "category", "impact", "detail"], additionalProperties: false,
      properties: {
        direction: { type: "string", enum: ["backward", "forward"] }, path: { type: "string" }, category: { type: "string" },
        impact: { type: "string", enum: ["breaking", "inconclusive"] }, detail: { type: "string" },
      },
    } },
    note: { type: "string" },
  },
} as const;
const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
const INCONCLUSIVE_KEYS = new Set(["$ref", "$dynamicRef", "allOf", "anyOf", "oneOf", "not", "pattern", "patternProperties", "format", "nullable", "if", "then", "else", "unevaluatedProperties", "dependentRequired"]);
type Obj = Record<string, any>;
type Finding = { direction: "backward" | "forward"; path: string; category: string; impact: "breaking" | "inconclusive"; detail: string };

export class OpenApiDiffError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "OpenApiDiffError"; this.status = status; }
}
function record(value: unknown): Obj | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : null; }
function parseDoc(source: unknown, label: string): Obj {
  if (typeof source !== "string" || !source.trim() || source.length > OPENAPI_DIFF_MAX_DOCUMENT_CHARS) {
    throw new OpenApiDiffError(`${label} must be non-empty JSON text of at most ${OPENAPI_DIFF_MAX_DOCUMENT_CHARS} characters.`, source && typeof source === "string" && source.length > OPENAPI_DIFF_MAX_DOCUMENT_CHARS ? 413 : 400);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new OpenApiDiffError(`${label} must contain valid JSON.`); }
  const doc = record(parsed);
  if (!doc || typeof doc.openapi !== "string" || !/^3\.(?:0|1)(?:\.|$)/.test(doc.openapi)) throw new OpenApiDiffError(`${label} must be an OpenAPI 3.0 or 3.1 object.`);
  if (!record(doc.info) || !record(doc.paths)) throw new OpenApiDiffError(`${label} must include info and paths objects.`);
  if (Object.keys(doc.paths).length > OPENAPI_DIFF_MAX_PATHS) throw new OpenApiDiffError(`${label} may contain at most ${OPENAPI_DIFF_MAX_PATHS} paths.`, 413);
  return doc;
}
function operations(doc: Obj): Map<string, Obj> {
  const result = new Map<string, Obj>();
  for (const [path, raw] of Object.entries(doc.paths)) {
    const item = record(raw); if (!item) continue;
    for (const [method, value] of Object.entries(item)) {
      const op = record(value); if (!METHODS.has(method.toLowerCase()) || !op) continue;
      const params = new Map<string, Obj>(), parameterRefs: string[] = [];
      for (const p of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const param = record(p); if (!param) continue;
        if (typeof param.$ref === "string") parameterRefs.push(param.$ref);
        if (typeof param.in === "string" && typeof param.name === "string") params.set(`${param.in}/${param.name}`, param);
      }
      result.set(`${method.toLowerCase()} ${path}`, { ...op, parameters: [...params.values()], _parameterRefs: parameterRefs.sort() });
    }
  }
  return result;
}
function finding(out: Finding[], direction: Finding["direction"], path: string, category: string, impact: Finding["impact"], detail: string) {
  out.push({ direction, path, category, impact, detail });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = record(value);
  if (object) return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? String(value);
}
function constraintSet(schema: Obj, key: string): Set<string> | null {
  if (!(key in schema)) return null; // null denotes unconstrained
  const values = key === "enum" ? schema[key] : [schema[key]];
  return new Set((Array.isArray(values) ? values : [values]).map(canonical));
}
function schemaDiff(before: unknown, after: unknown, base: string, direction: Finding["direction"], out: Finding[], response = false, depth = 0) {
  const b = record(before), a = record(after);
  if ((!b || !a) && (before !== after)) {
    finding(out, direction, base, "schema", "inconclusive", "A schema was added, removed, or changed to an unsupported shape.");
    return;
  }
  if (!b || !a) return;
  if (depth > 20) {
    finding(out, direction, base, "schema_depth", "inconclusive", "Nested schema depth exceeds the analysis limit.");
    return;
  }
  const oldSubsetNew = (direction === "backward") !== response;
  for (const key of INCONCLUSIVE_KEYS) if (canonical(b[key]) !== canonical(a[key])) {
    finding(out, direction, base, "schema", "inconclusive", `Changed unsupported schema keyword: ${key}`);
  }
  const compareSetConstraint = (key: string) => {
    const bs = constraintSet(b, key), as = constraintSet(a, key);
    if (bs === null && as === null) return;
    const breaks = bs === null ? oldSubsetNew : as === null ? !oldSubsetNew
      : oldSubsetNew ? [...bs].some(value => !as.has(value)) : [...as].some(value => !bs.has(value));
    if (breaks) finding(out, direction, base, `schema_${key}`, "breaking", `${key} values changed incompatibly for this direction.`);
  };
  compareSetConstraint("type");
  compareSetConstraint("enum");
  compareSetConstraint("const");
  const br = new Set(Array.isArray(b.required) ? b.required : []), ar = new Set(Array.isArray(a.required) ? a.required : []);
  if (oldSubsetNew ? [...ar].some(v => !br.has(v)) : [...br].some(v => !ar.has(v))) {
    finding(out, direction, base, "required_property", "breaking", "Required properties changed incompatibly for this direction.");
  }
  for (const key of ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties", "maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"]) {
    const bv = b[key], av = a[key];
    if (typeof bv !== "number" && typeof av !== "number") continue;
    const min = key.startsWith("min") || key === "minimum" || key === "exclusiveMinimum";
    const stricter = typeof av === "number" && (typeof bv !== "number" || (min ? av > bv : av < bv));
    const looser = typeof bv === "number" && (typeof av !== "number" || (min ? av < bv : av > bv));
    if (oldSubsetNew ? stricter : looser) finding(out, direction, base, "schema_bound", "breaking", `${key} changed incompatibly for this direction.`);
  }
  if (oldSubsetNew && b.additionalProperties !== false && a.additionalProperties === false) {
    finding(out, direction, base, "additional_properties", "breaking", "The proposed schema rejects additional properties.");
  }
  if (!oldSubsetNew && b.additionalProperties === false && a.additionalProperties !== false) {
    finding(out, direction, base, "additional_properties", "breaking", "The prior schema rejects properties accepted only by the proposed schema.");
  }
  if (canonical(b.additionalProperties) !== canonical(a.additionalProperties)
      && typeof b.additionalProperties !== "boolean" && typeof a.additionalProperties !== "boolean") {
    finding(out, direction, base, "additional_properties", "inconclusive", "Changed schema-valued additionalProperties is not evaluated.");
  }
  const bp = record(b.properties) ?? {}, ap = record(a.properties) ?? {};
  for (const name of Object.keys(bp)) {
    const propertyPath = `${base}/properties/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    if (!(name in ap)) {
      if (response && br.has(name)) finding(out, direction, propertyPath, "response_property_removed", "breaking", "A previously required response property was removed.");
      if (!response && oldSubsetNew && a.additionalProperties === false) finding(out, direction, propertyPath, "request_property_removed", "breaking", "A previously defined request property is now rejected.");
      continue;
    }
    schemaDiff(bp[name], ap[name], propertyPath, direction, out, response, depth + 1);
  }
  for (const name of Object.keys(ap)) if (!(name in bp) && !response && !oldSubsetNew && b.additionalProperties === false) {
    finding(out, direction, `${base}/properties/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`, "request_property_added", "breaking", "A new request property is rejected by the earlier schema.");
  }
  if (b.items !== undefined || a.items !== undefined) schemaDiff(b.items, a.items, `${base}/items`, direction, out, response, depth + 1);
}
function paramMap(op: Obj): Map<string, Obj> {
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  return new Map(params.filter(record).filter((p: Obj) => typeof p.name === "string" && typeof p.in === "string").map((p: Obj) => [`${p.in}/${p.name}`, p]));
}
function requestDiff(before: Obj, after: Obj, operation: string, out: Finding[]) {
  if (canonical(before._parameterRefs ?? []) !== canonical(after._parameterRefs ?? [])) {
    finding(out, "backward", `${operation}/parameters`, "parameter_reference", "inconclusive", "A parameter reference changed; referenced parameter contracts are not resolved.");
  }
  const bp = paramMap(before), ap = paramMap(after);
  for (const [key, param] of bp) if (!ap.has(key)) {
    finding(out, "backward", `${operation}/parameters/${key}`, "parameter_removed", "breaking", "A previously supported request parameter was removed.");
    if (param.required === true) finding(out, "forward", `${operation}/parameters/${key}`, "parameter_required", "breaking", "A required parameter was removed; clients using the proposed contract may omit it against the earlier API.");
  }
  for (const [key, p] of ap) if (!bp.has(key) && p.required === true) finding(out, "backward", `${operation}/parameters/${key}`, "parameter_required", "breaking", "A required request parameter was added.");
  for (const [key, b] of bp) if (ap.has(key)) {
    const a = ap.get(key)!, path = `${operation}/parameters/${key}`;
    if (b.required !== true && a.required === true) finding(out, "backward", path, "parameter_required", "breaking", "An optional request parameter became required.");
    if (b.required === true && a.required !== true) finding(out, "forward", path, "parameter_required", "breaking", "A required request parameter became optional.");
    for (const direction of ["backward", "forward"] as const) schemaDiff(b.schema, a.schema, path, direction, out);
  }
  const b = record(before.requestBody), a = record(after.requestBody);
  if (!b && !a) return;
  if (!b && a) {
    finding(out, "forward", `${operation}/requestBody`, "request_body_added", "breaking", "A request body was added and is unavailable to clients using the earlier contract.");
    return;
  }
  if (b && !a) {
    finding(out, "backward", `${operation}/requestBody`, "request_body_removed", "breaking", "A previously documented request body was removed.");
    return;
  }
  if (!b || !a) {
    finding(out, "backward", `${operation}/requestBody`, "request_body", "inconclusive", "The request body changed to an unsupported shape.");
    return;
  }
  if ((typeof b.$ref === "string" || typeof a.$ref === "string") && b.$ref !== a.$ref) {
    finding(out, "backward", `${operation}/requestBody`, "request_body_reference", "inconclusive", "The request-body reference changed; its target is not resolved.");
  }
  if (b.required !== true && a.required === true) finding(out, "backward", `${operation}/requestBody`, "request_required", "breaking", "An optional request body became required.");
  if (b.required === true && a.required !== true) finding(out, "forward", `${operation}/requestBody`, "request_required", "breaking", "A required request body became optional.");
  const bc = record(b.content) ?? {}, ac = record(a.content) ?? {};
  for (const media of Object.keys(bc)) if (!(media in ac)) finding(out, "backward", `${operation}/requestBody/content/${media}`, "request_media_type_removed", "breaking", "A previously accepted request media type was removed.");
  for (const media of Object.keys(ac)) if (!(media in bc)) finding(out, "forward", `${operation}/requestBody/content/${media}`, "request_media_type_added", "breaking", "A new request media type is unavailable to clients using the earlier contract.");
  for (const media of Object.keys(bc).filter(media => media in ac)) for (const direction of ["backward", "forward"] as const) schemaDiff(record(bc[media])?.schema, record(ac[media])?.schema, `${operation}/requestBody/content/${media}/schema`, direction, out);
}
function responseDiff(before: Obj, after: Obj, operation: string, out: Finding[]) {
  const br = record(before.responses) ?? {}, ar = record(after.responses) ?? {};
  for (const status of Object.keys(br)) if (!(status in ar)) finding(out, "backward", `${operation}/responses/${status}`, "response_removed", "breaking", "A previously documented response status was removed.");
  for (const status of Object.keys(ar)) if (!(status in br)) finding(out, "forward", `${operation}/responses/${status}`, "response_added", "breaking", "A new response status is unavailable to clients using the earlier contract.");
  for (const status of Object.keys(br).filter(status => status in ar)) {
    const beforeResponse = record(br[status]), afterResponse = record(ar[status]);
    if ((typeof beforeResponse?.$ref === "string" || typeof afterResponse?.$ref === "string") && beforeResponse?.$ref !== afterResponse?.$ref) {
      finding(out, "backward", `${operation}/responses/${status}`, "response_reference", "inconclusive", "The response reference changed; its target is not resolved.");
    }
    const bc = record(beforeResponse?.content) ?? {}, ac = record(afterResponse?.content) ?? {};
    for (const media of Object.keys(bc)) if (!(media in ac)) finding(out, "backward", `${operation}/responses/${status}/content/${media}`, "response_media_type_removed", "breaking", "A previously documented response media type was removed.");
    for (const media of Object.keys(ac)) if (!(media in bc)) finding(out, "forward", `${operation}/responses/${status}/content/${media}`, "response_media_type_added", "breaking", "A new response media type is unavailable to clients using the earlier contract.");
    for (const media of Object.keys(bc).filter(media => media in ac)) for (const direction of ["backward", "forward"] as const) schemaDiff(record(bc[media])?.schema, record(ac[media])?.schema, `${operation}/responses/${status}/content/${media}/schema`, direction, out, true);
  }
}

export function validateOpenApiDiffInput(value: unknown): { before_openapi_json: string; after_openapi_json: string } {
  const body = record(value);
  if (!body || Object.keys(body).some(key => !["before_openapi_json", "after_openapi_json"].includes(key))) {
    throw new OpenApiDiffError("Request body must contain only before_openapi_json and after_openapi_json.");
  }
  for (const key of ["before_openapi_json", "after_openapi_json"] as const) {
    if (typeof body[key] !== "string") throw new OpenApiDiffError(`${key} must be a non-empty JSON string.`);
    if (body[key].length > OPENAPI_DIFF_MAX_DOCUMENT_CHARS) throw new OpenApiDiffError(`${key} exceeds the ${OPENAPI_DIFF_MAX_DOCUMENT_CHARS} character limit.`, 413);
    if (!body[key].trim()) throw new OpenApiDiffError(`${key} must be a non-empty JSON string.`);
  }
  if (body.before_openapi_json.length + body.after_openapi_json.length > OPENAPI_DIFF_MAX_TOTAL_CHARS) {
    throw new OpenApiDiffError(`Combined OpenAPI documents exceed ${OPENAPI_DIFF_MAX_TOTAL_CHARS} characters.`, 413);
  }
  return { before_openapi_json: body.before_openapi_json, after_openapi_json: body.after_openapi_json };
}

export function compareOpenApi(beforeText: unknown, afterText: unknown) {
  if (typeof beforeText !== "string" || typeof afterText !== "string") throw new OpenApiDiffError("before_openapi_json and after_openapi_json must be strings.");
  if (beforeText.length + afterText.length > OPENAPI_DIFF_MAX_TOTAL_CHARS) throw new OpenApiDiffError(`Combined OpenAPI documents exceed ${OPENAPI_DIFF_MAX_TOTAL_CHARS} characters.`, 413);
  const beforeDoc = parseDoc(beforeText, "before_openapi_json"), afterDoc = parseDoc(afterText, "after_openapi_json");
  const before = operations(beforeDoc), after = operations(afterDoc);
  const out: Finding[] = [];
  for (const section of ["servers", "security", "components"]) {
    if (canonical(beforeDoc[section]) !== canonical(afterDoc[section])) {
      finding(out, "backward", `/${section}`, `document_${section}`, "inconclusive", `The top-level ${section} section changed and is not fully evaluated.`);
    }
  }
  const beforePaths = record(beforeDoc.paths) ?? {}, afterPaths = record(afterDoc.paths) ?? {};
  for (const path of new Set([...Object.keys(beforePaths), ...Object.keys(afterPaths)])) {
    const beforePath = record(beforePaths[path]), afterPath = record(afterPaths[path]);
    if ((typeof beforePath?.$ref === "string" || typeof afterPath?.$ref === "string") && beforePath?.$ref !== afterPath?.$ref) {
      finding(out, "backward", `/paths/${path}`, "path_reference", "inconclusive", "The path-item reference changed; its target is not resolved.");
    }
  }
  for (const key of before.keys()) if (!after.has(key)) finding(out, "backward", key.toUpperCase(), "operation_removed", "breaking", "The operation was removed.");
  for (const key of after.keys()) if (!before.has(key)) finding(out, "forward", key.toUpperCase(), "operation_added", "The operation is unavailable to clients using the earlier contract.");
  for (const [key, b] of before) if (after.has(key)) {
    const a = after.get(key)!;
    if (typeof b.operationId === "string" && typeof a.operationId === "string" && b.operationId !== a.operationId) {
      finding(out, "backward", key.toUpperCase(), "operation_id_changed", "breaking", "The operationId changed and may break generated client method names.");
    }
    for (const section of ["servers", "security"]) {
      if (canonical(b[section]) !== canonical(a[section])) {
        finding(out, "backward", `${key.toUpperCase()}/${section}`, `operation_${section}`, "inconclusive", `The operation-level ${section} section changed and is not fully evaluated.`);
      }
    }
    requestDiff(b, a, key.toUpperCase(), out);
    responseDiff(b, a, key.toUpperCase(), out);
  }
  const breaking = out.filter(item => item.impact === "breaking").length, inconclusive = out.length - breaking;
  return {
    assessment: breaking ? "breaking_changes_detected" : inconclusive ? "inconclusive" : "no_breaking_changes_detected",
    operations_compared: before.size + after.size,
    breaking_change_count: breaking, inconclusive_change_count: inconclusive,
    truncated: out.length > OPENAPI_DIFF_MAX_FINDINGS, changes: out.slice(0, OPENAPI_DIFF_MAX_FINDINGS),
    note: "Deterministic common-change analysis only. References are not resolved; changed components, composition, pattern, format, servers, or security may be inconclusive. Review the full contract before release.",
  };
}


export type OpenApiDiffWorkerResult =
  | { status: 200; body: ReturnType<typeof compareOpenApi>; itemsProcessed: number }
  | { status: 400 | 413; body: { error: string }; itemsProcessed: 0 };

/** Route adapter for a Worker/Hono handler after the shared x402 middleware. */
export function handleOpenApiDiffRequest(value: unknown): OpenApiDiffWorkerResult {
  try {
    const input = validateOpenApiDiffInput(value);
    const body = compareOpenApi(input.before_openapi_json, input.after_openapi_json);
    return { status: 200, body, itemsProcessed: body.operations_compared };
  } catch (error) {
    if (!(error instanceof OpenApiDiffError)) throw error;
    const status = error.status === 413 ? 413 : 400;
    return { status, body: { error: error.message }, itemsProcessed: 0 };
  }
}


/** Read and validate a Worker request stream without buffering beyond the payload cap. */
export async function handleOpenApiDiffRequestStream(stream: ReadableStream<Uint8Array> | null): Promise<OpenApiDiffWorkerResult> {
  if (!stream) return { status: 400, body: { error: "A JSON request body is required." }, itemsProcessed: 0 };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let body: Uint8Array;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > OPENAPI_DIFF_MAX_HTTP_BODY_BYTES) {
        try { await reader.cancel(); } catch { /* Preserve the size-limit result if cancellation fails. */ }
        return { status: 413, body: { error: `Request body exceeds ${OPENAPI_DIFF_MAX_HTTP_BODY_BYTES} bytes.` }, itemsProcessed: 0 };
      }
      chunks.push(value);
    }
    body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  } catch {
    try { await reader.cancel(); } catch { /* Ignore cancellation errors after a stream failure. */ }
    return { status: 400, body: { error: "Could not read the request body." }, itemsProcessed: 0 };
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { return { status: 400, body: { error: "Request body must be valid UTF-8 JSON." }, itemsProcessed: 0 }; }
  return handleOpenApiDiffRequest(value);
}
