#!/usr/bin/env python3
"""Infer a bounded CSV's column types and emit CREATE TABLE SQL only."""
from __future__ import annotations

import argparse
import csv
import decimal
import io
import math
import re
import sys
from pathlib import Path
from typing import Iterable

MAX_INPUT_CHARS = 262_144
MAX_ROWS = 1_000
MAX_COLUMNS = 50
MAX_IDENTIFIER_CHARS = 128
INTEGER_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)$")
NUMBER_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$")
DIALECT_TYPES = {
    "postgres": {"integer": "BIGINT", "number": "NUMERIC", "boolean": "BOOLEAN", "text": "TEXT"},
    "sqlite": {"integer": "INTEGER", "number": "REAL", "boolean": "INTEGER", "text": "TEXT"},
    "mysql": {"integer": "BIGINT", "number": "DOUBLE", "boolean": "BOOLEAN", "text": "TEXT"},
}


def _is_integer(value: str) -> bool:
    if not INTEGER_PATTERN.fullmatch(value):
        return False
    try:
        number = int(value)
        return -(2**63) <= number <= 2**63 - 1
    except ValueError:
        return False


def _is_number(value: str) -> bool:
    if not NUMBER_PATTERN.fullmatch(value):
        return False
    try:
        return decimal.Decimal(value).is_finite() and math.isfinite(float(value))
    except (decimal.InvalidOperation, OverflowError, ValueError):
        return False


def infer_kind(values: Iterable[str]) -> str:
    observed = [value.strip() for value in values if value.strip()]
    if not observed:
        return "text"
    if all(value.lower() in {"true", "false"} for value in observed):
        return "boolean"
    if all(_is_integer(value) for value in observed):
        return "integer"
    if all(_is_number(value) for value in observed):
        return "number"
    return "text"


def quote_identifier(value: str, dialect: str) -> str:
    if not value or "\x00" in value:
        raise ValueError("identifiers must be non-empty and cannot contain NUL")
    if len(value) > MAX_IDENTIFIER_CHARS:
        raise ValueError(f"identifiers cannot exceed {MAX_IDENTIFIER_CHARS} characters")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("identifiers cannot contain control characters")
    if len(value) > MAX_IDENTIFIER_CHARS:
        raise ValueError(f"identifiers cannot exceed {MAX_IDENTIFIER_CHARS} characters")
    if dialect == "mysql":
        return "`" + value.replace("`", "``") + "`"
    return '"' + value.replace('"', '""') + '"'


def generate_ddl(csv_text: str, table: str, dialect: str = "postgres") -> str:
    if dialect not in DIALECT_TYPES:
        raise ValueError(f"dialect must be one of: {', '.join(sorted(DIALECT_TYPES))}")
    if len(csv_text) > MAX_INPUT_CHARS:
        raise ValueError(f"CSV exceeds {MAX_INPUT_CHARS} character limit")
    reader = csv.reader(io.StringIO(csv_text, newline=""), strict=True)
    try:
        headers = next(reader)
    except StopIteration:
        raise ValueError("CSV is empty") from None
    if not headers or any(not header.strip() for header in headers):
        raise ValueError("CSV must have non-empty column names")
    if len(headers) > MAX_COLUMNS:
        raise ValueError(f"CSV exceeds {MAX_COLUMNS} column limit")
    if len(set(headers)) != len(headers):
        raise ValueError("CSV column names must be unique")
    if any(len(header) > MAX_IDENTIFIER_CHARS for header in headers):
        raise ValueError(f"column names cannot exceed {MAX_IDENTIFIER_CHARS} characters")
    if any(len(header) > MAX_IDENTIFIER_CHARS for header in headers):
        raise ValueError(f"column names cannot exceed {MAX_IDENTIFIER_CHARS} characters")
    rows = list(reader)
    if len(rows) > MAX_ROWS:
        raise ValueError(f"CSV exceeds {MAX_ROWS} data row limit")
    for row_number, row in enumerate(rows, start=1):
        if len(row) != len(headers):
            raise ValueError(f"data record {row_number} has {len(row)} fields; expected {len(headers)}")
    types = DIALECT_TYPES[dialect]
    definitions = []
    for index, header in enumerate(headers):
        kind = infer_kind(row[index] for row in rows)
        definitions.append(f"  {quote_identifier(header, dialect)} {types[kind]}")
    return f"CREATE TABLE {quote_identifier(table, dialect)} (\n" + ",\n".join(definitions) + "\n);\n"


def create_table_response(request: object) -> dict[str, str]:
    """JSON-facing adapter for an HTTP route; it never executes generated SQL."""
    if not isinstance(request, dict):
        raise ValueError("request body must be a JSON object")
    if set(request) - {"csv", "table", "dialect"}:
        raise ValueError("request contains unsupported fields")
    if not isinstance(request.get("csv"), str):
        raise ValueError("csv must be a string")
    if not isinstance(request.get("table"), str):
        raise ValueError("table must be a string")
    dialect = request.get("dialect", "postgres")
    if not isinstance(dialect, str):
        raise ValueError("dialect must be a string")
    return {
        "statement": generate_ddl(request["csv"], request["table"], dialect),
        "dialect": dialect,
        "note": "DDL draft inferred from supplied CSV values; review before use.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path, help="CSV input path, or - for stdin")
    parser.add_argument("--table", required=True, help="table identifier")
    parser.add_argument("--dialect", choices=sorted(DIALECT_TYPES), default="postgres")
    args = parser.parse_args()
    try:
        if str(args.csv_file) == "-":
            source = sys.stdin.read(MAX_INPUT_CHARS + 1)
        else:
            with args.csv_file.open(encoding="utf-8-sig", newline="") as input_file:
                source = input_file.read(MAX_INPUT_CHARS + 1)
        sys.stdout.write(generate_ddl(source, args.table, args.dialect))
    except (OSError, UnicodeError, csv.Error, ValueError) as error:
        print(f"csv_schema_sql: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
