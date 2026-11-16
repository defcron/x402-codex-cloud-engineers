export const OPENAPI_SECURITY_AUDIT_MAX_CHARS = 262144;
const MAX_PATHS = 1000;
const MAX_OPERATION_DETAILS = 250;
const MAX_FINDINGS = 500;
const METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export class AuditInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuditInputError";
    this.code = code;
    this.status = code === "spec_too_large" || code === "too_many_paths" ? 413 : 400;
  }
}

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const owns = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const pointer = (v) => String(v).replace(/~/g, "~0").replace(/\//g, "~1");

export function validateOpenApiSecurityAuditInput(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "openapi_json")) {
    throw new AuditInputError("invalid_input", "Request body must contain only openapi_json.");
  }
  const openapiJson = value.openapi_json;
  if (typeof openapiJson !== "string") {
    throw new AuditInputError("invalid_input", "openapi_json must be a non-empty JSON string.");
  }
  if (openapiJson.length > OPENAPI_SECURITY_AUDIT_MAX_CHARS) {
    throw new AuditInputError("spec_too_large", "OpenAPI JSON must be at most 262144 characters.");
  }
  if (openapiJson.trim().length === 0) {
    throw new AuditInputError("invalid_input", "openapi_json must be a non-empty JSON string.");
  }
  return { openapi_json: openapiJson };
}

export function auditOpenApiSecurity(openapiJson) {
  if (typeof openapiJson !== "string" || openapiJson.length === 0)
    throw new AuditInputError("invalid_input", "openapi_json must be a non-empty JSON string.");
  if (openapiJson.length > OPENAPI_SECURITY_AUDIT_MAX_CHARS)
    throw new AuditInputError("spec_too_large", "OpenAPI JSON must be at most 262144 characters.");

  let doc;
  try { doc = JSON.parse(openapiJson); }
  catch { throw new AuditInputError("invalid_json", "openapi_json must contain valid JSON."); }
  if (!isRecord(doc))
    throw new AuditInputError("invalid_document", "The OpenAPI document must be a JSON object.");
  if (typeof doc.openapi !== "string" || !/^3\.(0|1)\.\d+$/.test(doc.openapi))
    throw new AuditInputError("unsupported_version", "Only OpenAPI 3.0.x and 3.1.x JSON documents are supported.");
  if (!isRecord(doc.paths))
    throw new AuditInputError("invalid_paths", "The OpenAPI document must contain a paths object.");

  const paths = Object.entries(doc.paths);
  if (paths.length > MAX_PATHS)
    throw new AuditInputError("too_many_paths", "The document may contain at most 1000 path entries.");

  const schemes = isRecord(doc.components) && isRecord(doc.components.securitySchemes)
    ? doc.components.securitySchemes : {};
  const used = new Set();
  const findings = [];
  const operations = [];
  let findingsTruncated = false;
  const counts = {
    total: 0, protected: 0, allows_anonymous: 0, explicitly_public: 0,
    inherited_security: 0, operation_overrides: 0, invalid_security: 0,
    unresolved_scheme_references: 0,
    payment_extension_declared: 0
  };
  const addFinding = (item) => {
    if (findings.length < MAX_FINDINGS) findings.push(item);
    else findingsTruncated = true;
  };

  for (const [path, item] of paths) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      const m = method.toLowerCase();
      if (!METHODS.has(m) || !isRecord(op)) continue;
      counts.total += 1;
      const opPtr = "/paths/" + pointer(path) + "/" + m;
      const opHasSecurity = owns(op, "security");
      const rootHasSecurity = owns(doc, "security");
      const source = opHasSecurity ? "operation_override" : rootHasSecurity ? "root_inherited" : "none";
      if (opHasSecurity) counts.operation_overrides += 1;
      else if (rootHasSecurity) counts.inherited_security += 1;
      const security = opHasSecurity ? op.security : rootHasSecurity ? doc.security : undefined;
      const groups = [];
      const paymentInfo = isRecord(op["x-payment-info"]) ? op["x-payment-info"] : {};
      const paymentProtocols = Array.isArray(paymentInfo.protocols)
        ? [...new Set(paymentInfo.protocols.filter((item) => typeof item === "string"))] : [];
      if (paymentProtocols.length > 0) counts.payment_extension_declared += 1;
      let invalid = false;
      let anonymous = security === undefined || (Array.isArray(security) && security.length === 0);

      if (security !== undefined && !Array.isArray(security)) {
        invalid = true;
        addFinding({ code: "invalid_security_array", severity: "error", pointer: opPtr + "/security",
          message: "Security must be an array of security requirement objects." });
      } else if (Array.isArray(security)) {
        security.forEach((group, i) => {
          if (!isRecord(group)) {
            invalid = true;
            addFinding({ code: "invalid_security_requirement", severity: "error",
              pointer: opPtr + "/security/" + i, message: "Each security requirement must be an object." });
            return;
          }
          const names = Object.keys(group);
          if (names.length === 0) anonymous = true;
          const normalized = [];
          for (const name of names) {
            used.add(name);
            const ref = opPtr + "/security/" + i + "/" + pointer(name);
            const scopes = group[name];
            if (!Array.isArray(scopes) || scopes.some((s) => typeof s !== "string")) {
              invalid = true;
              addFinding({ code: "invalid_security_scopes", severity: "error", pointer: ref,
                message: "Security requirement values must be arrays of scope strings." });
              continue;
            }
            normalized.push({ scheme: name, scopes });
            if (!owns(schemes, name)) {
              invalid = true;
              counts.unresolved_scheme_references += 1;
              addFinding({ code: "unknown_security_scheme", severity: "error", pointer: ref,
                message: "Security requirement references a scheme not declared in components.securitySchemes." });
              continue;
            }
            const scheme = schemes[name];
            if (scopes.length > 0 && isRecord(scheme) &&
                ["apiKey", "http", "mutualTLS"].includes(scheme.type)) {
              invalid = true;
              addFinding({ code: "scopes_on_non_oauth_scheme", severity: "error", pointer: ref,
                message: "Only oauth2 and openIdConnect schemes can declare scope names in a security requirement." });
            }
          }
          groups.push(normalized);
        });
      }

      if (invalid) counts.invalid_security += 1;
      if (anonymous) {
        counts.allows_anonymous += 1;
        if (opHasSecurity && Array.isArray(op.security) && op.security.length === 0) {
          counts.explicitly_public += 1;
          addFinding({ code: "operation_explicitly_allows_anonymous", severity: "warning",
            pointer: opPtr + "/security",
            message: "This operation overrides inherited security and explicitly allows anonymous access." });
        } else if (security === undefined) {
          addFinding({ code: "operation_has_no_security", severity: "info", pointer: opPtr,
            message: "No effective security requirement applies to this operation." });
        } else if (Array.isArray(security) && security.some((g) => isRecord(g) && Object.keys(g).length === 0)) {
          addFinding({ code: "security_has_anonymous_alternative", severity: "warning",
            pointer: opPtr + "/security",
            message: "At least one security requirement alternative permits anonymous access." });
        }
      } else if (!invalid) counts.protected += 1;

      if (operations.length < MAX_OPERATION_DETAILS) {
        operations.push({
          method: m.toUpperCase(), path: path.slice(0, 512),
          operation_id: typeof op.operationId === "string" ? op.operationId.slice(0, 200) : null,
          summary: typeof op.summary === "string" ? op.summary.slice(0, 200) : null,
          security_source: source,
          security_mode: invalid ? "invalid" : anonymous ? "allows_anonymous" : "required",
          requirements: groups,
          declared_payment_protocols: paymentProtocols.slice(0, 10),
          payment_protocols_truncated: paymentProtocols.length > 10
        });
      }
    }
  }

  const allUnused = Object.keys(schemes).filter((name) => !used.has(name));
  const unused = allUnused.slice(0, 100);
  if (allUnused.length > unused.length) findingsTruncated = true;
  for (const name of unused) addFinding({
    code: "unused_security_scheme", severity: "info",
    pointer: "/components/securitySchemes/" + pointer(name),
    message: "Declared security scheme is not referenced by any operation's effective security requirements."
  });

  return {
    openapi_version: doc.openapi,
    title: isRecord(doc.info) && typeof doc.info.title === "string" ? doc.info.title.slice(0, 200) : null,
    operation_count: counts.total,
    returned_operations: operations.length,
    truncated: counts.total > operations.length,
    counts,
    unused_security_schemes: unused,
    unused_security_schemes_truncated: allUnused.length > unused.length,
    findings,
    findings_truncated: findingsTruncated,
    operations,
    note: "This evaluates OpenAPI Security Requirement Objects only; no OpenAPI security means no security requirement is declared in the document, not proof that the live endpoint accepts anonymous calls. Declared x-payment-info protocols are reported separately and are not treated as authentication. No endpoints are contacted and $ref values are not resolved."
  };
}

const REFERENCE_FINDING_CODES = new Set([
  "invalid_security_array",
  "invalid_security_requirement",
  "invalid_security_scopes",
  "unknown_security_scheme",
  "scopes_on_non_oauth_scheme"
]);

// Engineer 14's reserved service is intentionally narrower than a security
// posture explainer: it reports only malformed or dangling references.
export function auditOpenApiSecurityReferences(openapiJson) {
  const audit = auditOpenApiSecurity(openapiJson);
  const findings = audit.findings.filter((finding) => REFERENCE_FINDING_CODES.has(finding.code));
  return {
    openapi_version: audit.openapi_version,
    title: audit.title,
    operation_count: audit.operation_count,
    reference_issue_count: findings.length,
    findings,
    // The core bounded analyzer caps all findings together. If that cap was
    // hit, some reference findings may have been omitted among other findings.
    findings_truncated: audit.findings_truncated,
    note: "Reports malformed OpenAPI Security Requirement Objects and references to undeclared or incompatible schemes. It does not summarize effective security or determine runtime access. No endpoint is contacted and $ref values are not resolved."
  };
}
