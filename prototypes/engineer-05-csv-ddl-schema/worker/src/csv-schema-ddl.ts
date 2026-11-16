export const CSV_SCHEMA_DDL_MAX_INPUT_CHARS = 262_144;
export const CSV_SCHEMA_DDL_MAX_COLUMNS = 50;
export const CSV_SCHEMA_DDL_MAX_ROWS = 1_000;
export const CSV_SCHEMA_DDL_MAX_IDENTIFIER_CHARS = 128;
export const CSV_SCHEMA_DDL_PRICE_USD = 0.005;

export type CsvSchemaDdlDialect = "postgres" | "sqlite" | "mysql";
export type CsvSchemaDdlRequest = { csv: string; table: string; dialect: CsvSchemaDdlDialect };
export type CsvSchemaDdlParsedCsv = { columns: string[]; rows: Array<Record<string, string>> };
export type CsvSchemaDdlResponse = { statement: string; dialect: CsvSchemaDdlDialect; note: string };

const DIALECT_TYPES: Record<CsvSchemaDdlDialect, Record<"integer" | "number" | "boolean" | "text", string>> = {
  postgres: { integer: "BIGINT", number: "NUMERIC", boolean: "BOOLEAN", text: "TEXT" },
  sqlite: { integer: "INTEGER", number: "REAL", boolean: "INTEGER", text: "TEXT" },
  mysql: { integer: "BIGINT", number: "DOUBLE", boolean: "BOOLEAN", text: "TEXT" },
};
const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

export class CsvSchemaDdlError extends Error {
  status: 400 | 413;
  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "CsvSchemaDdlError";
    this.status = status;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > CSV_SCHEMA_DDL_MAX_IDENTIFIER_CHARS) {
    throw new CsvSchemaDdlError(`${label} must be a non-empty identifier of at most ${CSV_SCHEMA_DDL_MAX_IDENTIFIER_CHARS} characters.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new CsvSchemaDdlError(`${label} cannot contain control characters.`);
  return value;
}

export function validateCsvSchemaDdlInput(value: unknown): CsvSchemaDdlRequest {
  if (!isPlainObject(value)) throw new CsvSchemaDdlError("Request body must be a JSON object.");
  if (Object.keys(value).some((key) => !["csv", "table", "dialect"].includes(key))) {
    throw new CsvSchemaDdlError("Only csv, table, and dialect are accepted.");
  }
  if (typeof value.csv !== "string" || !value.csv.trim()) throw new CsvSchemaDdlError("csv must be a non-empty string.");
  if (value.csv.length > CSV_SCHEMA_DDL_MAX_INPUT_CHARS) {
    throw new CsvSchemaDdlError(`csv exceeds ${CSV_SCHEMA_DDL_MAX_INPUT_CHARS} characters.`, 413);
  }
  const table = validateIdentifier(value.table, "table");
  const dialect = value.dialect === undefined ? "postgres" : value.dialect;
  if (dialect !== "postgres" && dialect !== "sqlite" && dialect !== "mysql") {
    throw new CsvSchemaDdlError("dialect must be postgres, sqlite, or mysql.");
  }
  return { csv: value.csv, table, dialect };
}

function quoteIdentifier(value: string, dialect: CsvSchemaDdlDialect): string {
  const checked = validateIdentifier(value, "column name");
  if (dialect === "mysql") return `\`${checked.replaceAll("`", "``")}\``;
  return `"${checked.replaceAll('"', '""')}"`;
}

function isSafeFiniteNumber(value: string): boolean {
  return NUMBER_PATTERN.test(value) && Number.isFinite(Number(value));
}

function inferKind(values: string[]): "integer" | "number" | "boolean" | "text" {
  const observed = values.map((value) => value.trim()).filter(Boolean);
  if (observed.length === 0) return "text";
  if (observed.every((value) => /^(?:true|false)$/i.test(value))) return "boolean";
  if (observed.every((value) => {
    if (!INTEGER_PATTERN.test(value)) return false;
    try {
      const number = BigInt(value);
      return number >= INT64_MIN && number <= INT64_MAX;
    } catch {
      return false;
    }
  })) return "integer";
  if (observed.every(isSafeFiniteNumber)) return "number";
  return "text";
}

export function createCsvSchemaDdl(
  parsed: CsvSchemaDdlParsedCsv,
  table: string,
  dialect: CsvSchemaDdlDialect,
): CsvSchemaDdlResponse {
  if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
    throw new CsvSchemaDdlError("CSV parser result is invalid.");
  }
  if (parsed.columns.length < 1) throw new CsvSchemaDdlError("CSV must contain a header row.");
  if (parsed.columns.length > CSV_SCHEMA_DDL_MAX_COLUMNS) {
    throw new CsvSchemaDdlError(`CSV exceeds ${CSV_SCHEMA_DDL_MAX_COLUMNS} columns.`, 413);
  }
  if (parsed.rows.length > CSV_SCHEMA_DDL_MAX_ROWS) {
    throw new CsvSchemaDdlError(`CSV exceeds ${CSV_SCHEMA_DDL_MAX_ROWS} data rows.`, 413);
  }
  if (new Set(parsed.columns).size !== parsed.columns.length) throw new CsvSchemaDdlError("CSV column names must be unique.");
  const columns = parsed.columns.map((column) => validateIdentifier(column, "column name"));
  for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex++) {
    const row = parsed.rows[rowIndex];
    if (!isPlainObject(row)) throw new CsvSchemaDdlError(`CSV row ${rowIndex + 1} is invalid.`);
    for (const column of columns) {
      if (typeof row[column] !== "string") throw new CsvSchemaDdlError(`CSV row ${rowIndex + 1} has an invalid value for ${column}.`);
    }
  }
  const definitions = columns.map((column) => {
    const kind = inferKind(parsed.rows.map((row) => row[column]));
    return `  ${quoteIdentifier(column, dialect)} ${DIALECT_TYPES[dialect][kind]}`;
  });
  const statement = `CREATE TABLE ${quoteIdentifier(table, dialect)} (\n${definitions.join(",\n")}\n);\n`;
  return {
    statement,
    dialect,
    note: "DDL draft inferred from supplied CSV values; review before use. SQL is not executed and no cell values are returned.",
  };
}
