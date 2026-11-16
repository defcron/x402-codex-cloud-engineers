/** RFC 6570 URI-template parser and expander for Worker integration. */

export const URI_TEMPLATE_LIMITS = {
  templateChars: 4096,
  expressions: 100,
  variables: 50,
  variableNameChars: 256,
  valueChars: 4096,
  collectionEntries: 100,
  nestingDepth: 4,
  outputChars: 262144,
  requestBytes: 65536,
} as const;

export class UriTemplateError extends Error {
  readonly status: 400 | 413;
  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "UriTemplateError";
    this.status = status;
  }
}

export type TemplateValue = string | number | boolean | null | TemplateValue[] | { [key: string]: TemplateValue };
export type TemplateValues = Record<string, TemplateValue>;

type VarSpec = { name: string; explode: boolean; prefix: number | null };
type Expression = { operator: string; variables: VarSpec[] };
type Part = { literal?: string; expression?: Expression };

const VAR_NAME = /^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+$/;
const OPERATORS = "+#./;?&";
const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const RESERVED = ":/?#[]@!$&'()*+,;=";

function fail(message: string, status: 400 | 413 = 400): never {
  throw new UriTemplateError(message, status);
}

function checkLiteral(literal: string, offset: number): void {
  const allowed = new Set(UNRESERVED + RESERVED);
  for (let i = 0; i < literal.length;) {
    const ch = literal[i];
    if (ch === "%") {
      if (!/^[0-9A-Fa-f]{2}$/.test(literal.slice(i + 1, i + 3))) fail(`invalid percent escape at character ${offset + i}`);
      i += 3;
      continue;
    }
    if (!allowed.has(ch)) fail(`invalid literal character at character ${offset + i}`);
    i++;
  }
}

function parseExpression(body: string, offset: number): Expression {
  if (!body) fail(`empty expression at character ${offset}`);
  const operator = OPERATORS.includes(body[0]) ? body[0] : "";
  const text = operator ? body.slice(1) : body;
  if (!text) fail(`expression at character ${offset} has no variable`);
  const variables = text.split(",").map((raw): VarSpec => {
    if (!raw) fail(`empty variable at character ${offset}`);
    const explode = raw.endsWith("*");
    let name = explode ? raw.slice(0, -1) : raw;
    let prefix: number | null = null;
    if (name.includes(":")) {
      if (explode) fail(`prefix and explode modifiers cannot be combined at character ${offset}`);
      const colon = name.lastIndexOf(":");
      const digits = name.slice(colon + 1);
      name = name.slice(0, colon);
      if (!/^\d+$/.test(digits) || Number(digits) < 1 || Number(digits) > 9999) fail(`invalid prefix modifier at character ${offset}`);
      prefix = Number(digits);
    }
    if (!VAR_NAME.test(name)) fail(`invalid variable name at character ${offset}`);
    if (name.length > URI_TEMPLATE_LIMITS.variableNameChars) fail(`variable name exceeds ${URI_TEMPLATE_LIMITS.variableNameChars} characters`, 413);
    return { name, explode, prefix };
  });
  return { operator, variables };
}

function parse(template: string): Part[] {
  if (typeof template !== "string" || !template) fail("template must be a non-empty string");
  if (template.length > URI_TEMPLATE_LIMITS.templateChars) fail(`template exceeds ${URI_TEMPLATE_LIMITS.templateChars} characters`, 413);
  const parts: Part[] = [];
  let pos = 0;
  let expressionCount = 0;
  while (pos < template.length) {
    const open = template.indexOf("{", pos);
    const strayClose = template.indexOf("}", pos);
    if (strayClose !== -1 && (open === -1 || strayClose < open)) fail(`unmatched closing brace at character ${strayClose}`);
    if (open === -1) {
      const literal = template.slice(pos);
      checkLiteral(literal, pos);
      parts.push({ literal });
      break;
    }
    if (open > pos) {
      const literal = template.slice(pos, open);
      checkLiteral(literal, pos);
      parts.push({ literal });
    }
    const close = template.indexOf("}", open + 1);
    const nested = template.indexOf("{", open + 1);
    if (close === -1 || (nested !== -1 && nested < close)) fail(`unmatched or nested opening brace at character ${open}`);
    expressionCount++;
    if (expressionCount > URI_TEMPLATE_LIMITS.expressions) fail(`template exceeds ${URI_TEMPLATE_LIMITS.expressions} expressions`, 413);
    parts.push({ expression: parseExpression(template.slice(open + 1, close), open) });
    pos = close + 1;
  }
  if (parts.length === 0) parts.push({ literal: "" });
  const names = parts.flatMap((p) => p.expression?.variables.map((v) => v.name) ?? []);
  if (new Set(names).size > URI_TEMPLATE_LIMITS.variables) fail(`template references more than ${URI_TEMPLATE_LIMITS.variables} unique variables`, 413);
  return parts;
}

function stringify(value: TemplateValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && !Number.isFinite(value)) fail("numbers must be finite");
  if (typeof value !== "string" && typeof value !== "number") fail("values must be JSON-compatible scalars, arrays, or objects");
  if (typeof value === "object") fail("nested arrays and objects are not valid scalar values");
  return String(value);
}

function valueSize(value: TemplateValue, depth: number): number {
  if (depth > URI_TEMPLATE_LIMITS.nestingDepth) fail(`values exceed nesting depth ${URI_TEMPLATE_LIMITS.nestingDepth}`);
  if (value === null || typeof value !== "object") return stringify(value).length;
  if (depth > 0) fail("arrays and objects may contain only scalar values");
  if (Array.isArray(value)) {
    if (value.length > URI_TEMPLATE_LIMITS.collectionEntries) fail(`arrays may contain at most ${URI_TEMPLATE_LIMITS.collectionEntries} values`, 413);
    return value.reduce((sum, item) => sum + valueSize(item, depth + 1), 0);
  }
  const entries = Object.entries(value);
  if (entries.length > URI_TEMPLATE_LIMITS.collectionEntries) fail(`objects may contain at most ${URI_TEMPLATE_LIMITS.collectionEntries} entries`, 413);
  return entries.reduce((sum, [key, item]) => sum + key.length + valueSize(item, depth + 1), 0);
}

function validateValues(values: TemplateValues): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) fail("values must be an object");
  const entries = Object.entries(values);
  if (entries.length > URI_TEMPLATE_LIMITS.variables) fail(`values exceeds ${URI_TEMPLATE_LIMITS.variables} variables`, 413);
  let size = 0;
  for (const [name, value] of entries) {
    if (!VAR_NAME.test(name)) fail("values contain an invalid variable name");
    if (name.length > URI_TEMPLATE_LIMITS.variableNameChars) fail(`variable name exceeds ${URI_TEMPLATE_LIMITS.variableNameChars} characters`, 413);
    size += valueSize(value, 0);
    if (size > URI_TEMPLATE_LIMITS.valueChars) fail(`combined values exceed ${URI_TEMPLATE_LIMITS.valueChars} characters`, 413);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function isTemplateValue(value: unknown): value is TemplateValue {
  if (isScalar(value)) return true;
  if (Array.isArray(value)) return value.every(isScalar);
  if (isRecord(value)) return Object.values(value).every(isScalar);
  return false;
}

export type UriTemplateRequest = { template: string; values: TemplateValues };

/** Validate an untrusted HTTP JSON body before passing it to an endpoint handler. */
export function validateUriTemplateInput(value: unknown): UriTemplateRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "template" && key !== "values") || !Object.hasOwn(value, "template") || !Object.hasOwn(value, "values")) {
    fail("request must contain only template and values fields");
  }
  if (typeof value.template !== "string") fail("template must be a string");
  if (!isRecord(value.values)) fail("values must be an object");
  const values = Object.create(null) as TemplateValues;
  for (const [name, item] of Object.entries(value.values)) {
    if (!isTemplateValue(item)) fail(`value for ${name} must be a scalar, scalar array, or flat scalar object`);
    values[name] = item;
  }
  parse(value.template);
  validateValues(values);
  return { template: value.template, values };
}

function encode(value: string, allowReserved: boolean): string {
  let result: string;
  try {
    result = encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    fail("values must contain valid Unicode text");
  }
  if (allowReserved) {
    const codes: Record<string, string> = { "%3A": ":", "%2F": "/", "%3F": "?", "%23": "#", "%5B": "[", "%5D": "]", "%40": "@", "%21": "!", "%24": "$", "%26": "&", "%27": "'", "%28": "(", "%29": ")", "%2A": "*", "%2B": "+", "%2C": ",", "%3B": ";", "%3D": "=" };
    result = result.replace(/%3A|%2F|%3F|%23|%5B|%5D|%40|%21|%24|%26|%27|%28|%29|%2A|%2B|%2C|%3B|%3D/gi, (code) => codes[code.toUpperCase()]);
  }
  return result;
}

function named(name: string, value: string, omitEmpty: boolean): string {
  if (value === "" && omitEmpty) return name;
  return `${name}=${value}`;
}

function expandExpression(expression: Expression, values: TemplateValues): string {
  const config: Record<string, [string, string, boolean, boolean]> = {
    "": ["", ",", false, false], "+": ["", ",", false, true], "#": ["#", ",", false, true],
    ".": [".", ".", false, false], "/": ["/", "/", false, false],
    ";": [";", ";", true, false], "?": ["?", "&", true, false], "&": ["&", "&", true, false],
  };
  const [prefix, separator, isNamed, allowReserved] = config[expression.operator];
  const omitEmpty = expression.operator === ";";
  const items: string[] = [];
  for (const spec of expression.variables) {
    if (!Object.hasOwn(values, spec.name)) continue;
    const value = values[spec.name];
    if (spec.prefix !== null && (Array.isArray(value) || (value !== null && typeof value === "object"))) fail(`prefix modifier requires a scalar value for ${spec.name}`);
    if (value === null || value === "") {
      if (omitEmpty) {
        if (isNamed) items.push(spec.name);
        continue;
      }
    }
    // varnames already use RFC 6570's encoded form; encoding '%' again would
    // change a legal name such as {foo%20bar} into the wrong URI parameter.
    const name = spec.name;
    if (Array.isArray(value)) {
      const strings = value.map(stringify);
      if (spec.explode) {
        if (isNamed) items.push(...strings.map((v) => named(name, encode(v, allowReserved), omitEmpty)));
        else items.push(...strings.map((v) => encode(v, allowReserved)));
      } else {
        const joined = strings.map((v) => encode(v, allowReserved)).join(",");
        items.push(isNamed ? named(name, joined, omitEmpty) : joined);
      }
    } else if (value !== null && typeof value === "object") {
      const pairs = Object.entries(value).map(([k, v]) => [encode(k, false), encode(stringify(v), allowReserved)] as const);
      if (spec.explode) items.push(...pairs.map(([k, v]) => named(k, v, omitEmpty)));
      else {
        const joined = pairs.flatMap(([k, v]) => [k, v]).join(",");
        items.push(isNamed ? named(name, joined, omitEmpty) : joined);
      }
    } else {
      let scalar = stringify(value);
      if (spec.prefix !== null) scalar = Array.from(scalar).slice(0, spec.prefix).join("");
      const encoded = encode(scalar, allowReserved);
      items.push(isNamed ? named(name, encoded, omitEmpty) : encoded);
    }
  }
  return items.length ? prefix + items.join(separator) : "";
}

export function inspectUriTemplate(template: string) {
  const parts = parse(template);
  const variables = [...new Set(parts.flatMap((p) => p.expression?.variables.map((v) => v.name) ?? []))];
  const expressions = parts.flatMap((part) => part.expression ? [{
    operator: part.expression.operator || "simple",
    variables: part.expression.variables.map(({ name, explode, prefix }) => ({ name, explode, prefix })),
  }] : []);
  return { valid: true as const, variables, expressions };
}

export function expandUriTemplate(template: string, values: TemplateValues) {
  const parts = parse(template);
  validateValues(values);
  const variables = [...new Set(parts.flatMap((p) => p.expression?.variables.map((v) => v.name) ?? []))];
  const missing_variables = variables.filter((name) => !Object.hasOwn(values, name));
  const unused_variables = Object.keys(values).filter((name) => !variables.includes(name));
  const expanded = parts.map((part) => part.literal ?? expandExpression(part.expression!, values)).join("");
  if (expanded.length > URI_TEMPLATE_LIMITS.outputChars) fail(`expanded result exceeds ${URI_TEMPLATE_LIMITS.outputChars} characters`, 413);
  return { valid: true as const, variables, missing_variables, unused_variables, expanded };
}

export type UriTemplateWorkerResult = {
  status: 200 | 400 | 405 | 413 | 415 | 500;
  body: Record<string, unknown>;
};

/** Bounded Web Request adapter. Call behind the existing x402 payment middleware. */
export async function handleUriTemplateWorkerRequest(request: Request): Promise<UriTemplateWorkerResult> {
  if (request.method !== "POST") return { status: 405, body: { error: "Method not allowed." } };
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return { status: 415, body: { error: "Content-Type must be application/json." } };

  if (!request.body) return { status: 400, body: { error: "Request body must contain a JSON object." } };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > URI_TEMPLATE_LIMITS.requestBytes) {
        try { await reader.cancel(); } catch { /* stream is already closed */ }
        return { status: 413, body: { error: `JSON request exceeds ${URI_TEMPLATE_LIMITS.requestBytes} bytes.` } };
      }
      chunks.push(value);
    }
  } catch {
    try { await reader.cancel(); } catch { /* stream is already errored */ }
    return { status: 400, body: { error: "Request body could not be read." } };
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { status: 400, body: { error: "Request body must be valid UTF-8 JSON." } };
  }
  let body: unknown;
  try {
    body = JSON.parse(decoded);
  } catch {
    return { status: 400, body: { error: "Request body must be valid JSON." } };
  }

  try {
    const input = validateUriTemplateInput(body);
    return { status: 200, body: expandUriTemplate(input.template, input.values) };
  } catch (error) {
    if (error instanceof UriTemplateError) return { status: error.status, body: { error: error.message } };
    return { status: 500, body: { error: "Internal URI-template processing error." } };
  }
}
