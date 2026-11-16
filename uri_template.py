"""Bounded RFC 6570 URI-template parsing and expansion (no third-party deps)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

MAX_TEMPLATE_CHARS = 4096
MAX_EXPRESSIONS = 100
MAX_VARIABLES = 50
MAX_VARIABLE_NAME_CHARS = 256
MAX_VALUE_CHARS = 4096
MAX_DEPTH = 4
MAX_OUTPUT_CHARS = 262144

_VAR_NAME = re.compile(r"^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+$")
_OPERATORS = "+#./;?&"
_UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
_RESERVED = ":/?#[]@!$&'()*+,;="


class TemplateError(ValueError):
    """Template syntax or input-value error with a user-safe message."""


@dataclass(frozen=True)
class VarSpec:
    name: str
    explode: bool = False
    prefix: int | None = None


@dataclass(frozen=True)
class Expression:
    operator: str
    variables: tuple[VarSpec, ...]


@dataclass(frozen=True)
class Part:
    literal: str | None = None
    expression: Expression | None = None


def parse(template: str) -> tuple[Part, ...]:
    if not isinstance(template, str) or not template:
        raise TemplateError("template must be a non-empty string")
    if len(template) > MAX_TEMPLATE_CHARS:
        raise TemplateError(f"template exceeds {MAX_TEMPLATE_CHARS} characters")
    parts: list[Part] = []
    pos = 0
    expressions = 0
    while pos < len(template):
        opening = template.find("{", pos)
        stray_close = template.find("}", pos)
        if stray_close != -1 and (opening == -1 or stray_close < opening):
            raise TemplateError(f"unmatched closing brace at character {stray_close}")
        if opening == -1:
            literal = template[pos:]
            _check_literal(literal, pos)
            parts.append(Part(literal=literal))
            break
        if opening > pos:
            literal = template[pos:opening]
            _check_literal(literal, pos)
            parts.append(Part(literal=literal))
        closing = template.find("}", opening + 1)
        nested = template.find("{", opening + 1)
        if closing == -1 or (nested != -1 and nested < closing):
            raise TemplateError(f"unmatched or nested opening brace at character {opening}")
        expressions += 1
        if expressions > MAX_EXPRESSIONS:
            raise TemplateError(f"template exceeds {MAX_EXPRESSIONS} expressions")
        parts.append(Part(expression=_parse_expression(template[opening + 1:closing], opening)))
        pos = closing + 1
    if not parts:
        parts.append(Part(literal=""))
    referenced = [v.name for p in parts if p.expression for v in p.expression.variables]
    if len(set(referenced)) > MAX_VARIABLES:
        raise TemplateError(f"template references more than {MAX_VARIABLES} unique variables")
    return tuple(parts)


def _parse_expression(body: str, offset: int) -> Expression:
    if not body:
        raise TemplateError(f"empty expression at character {offset}")
    operator = body[0] if body[0] in _OPERATORS else ""
    spec_text = body[1:] if operator else body
    if not spec_text:
        raise TemplateError(f"expression at character {offset} has no variable")
    variables: list[VarSpec] = []
    for raw in spec_text.split(","):
        if not raw:
            raise TemplateError(f"empty variable at character {offset}")
        explode = raw.endswith("*")
        prefix: int | None = None
        name = raw[:-1] if explode else raw
        if ":" in name:
            if explode:
                raise TemplateError(f"prefix and explode modifiers cannot be combined at character {offset}")
            name, digits = name.rsplit(":", 1)
            if not digits.isdigit() or not 1 <= int(digits) <= 9999:
                raise TemplateError(f"invalid prefix modifier at character {offset}")
            prefix = int(digits)
        if not _VAR_NAME.fullmatch(name):
            raise TemplateError(f"invalid variable name at character {offset}")
        if len(name) > MAX_VARIABLE_NAME_CHARS:
            raise TemplateError(f"variable name exceeds {MAX_VARIABLE_NAME_CHARS} characters")
        variables.append(VarSpec(name=name, explode=explode, prefix=prefix))
    return Expression(operator=operator, variables=tuple(variables))


def _check_literal(literal: str, offset: int) -> None:
    allowed = set(_UNRESERVED + _RESERVED)
    pos = 0
    while pos < len(literal):
        char = literal[pos]
        if char == "%":
            if pos + 2 >= len(literal) or not re.fullmatch(r"[0-9A-Fa-f]{2}", literal[pos + 1:pos + 3]):
                raise TemplateError(f"invalid percent escape at character {offset + pos}")
            pos += 3
            continue
        if char not in allowed:
            raise TemplateError(f"invalid literal character at character {offset + pos}")
        pos += 1


def expand(template: str, values: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(values, dict):
        raise TemplateError("values must be an object")
    parts = parse(template)
    _validate_values(values)
    referenced = [v.name for p in parts if p.expression for v in p.expression.variables]
    unique = list(dict.fromkeys(referenced))
    missing = [name for name in unique if name not in values]
    unused = [name for name in values if name not in unique]
    output = "".join(p.literal if p.literal is not None else _expand_expression(p.expression, values) for p in parts)
    if len(output) > MAX_OUTPUT_CHARS:
        raise TemplateError(f"expanded result exceeds {MAX_OUTPUT_CHARS} characters")
    return {
        "valid": True,
        "variables": unique,
        "missing_variables": missing,
        "unused_variables": unused,
        "expanded": output,
    }


def inspect(template: str) -> dict[str, Any]:
    parts = parse(template)
    unique = list(dict.fromkeys(v.name for p in parts if p.expression for v in p.expression.variables))
    expressions = []
    for part in parts:
        if part.expression:
            expressions.append({
                "operator": part.expression.operator or "simple",
                "variables": [
                    {"name": v.name, "explode": v.explode, "prefix": v.prefix}
                    for v in part.expression.variables
                ],
            })
    return {"valid": True, "variables": unique, "expressions": expressions}


def _validate_values(values: dict[str, Any]) -> None:
    if len(values) > MAX_VARIABLES:
        raise TemplateError(f"values exceeds {MAX_VARIABLES} variables")
    budget = 0
    for name, value in values.items():
        if not isinstance(name, str) or not _VAR_NAME.fullmatch(name):
            raise TemplateError("values contain an invalid variable name")
        if len(name) > MAX_VARIABLE_NAME_CHARS:
            raise TemplateError(f"variable name exceeds {MAX_VARIABLE_NAME_CHARS} characters")
        budget += _value_size(value, depth=0)
        if budget > MAX_VALUE_CHARS:
            raise TemplateError(f"combined values exceed {MAX_VALUE_CHARS} characters")


def _value_size(value: Any, depth: int) -> int:
    if depth > MAX_DEPTH:
        raise TemplateError(f"values exceed nesting depth {MAX_DEPTH}")
    if value is None or isinstance(value, (str, int, float, bool)):
        return len(_string(value))
    if isinstance(value, list):
        if depth > 0:
            raise TemplateError("arrays may contain only scalar values")
        if len(value) > 100:
            raise TemplateError("arrays may contain at most 100 values")
        return sum(_value_size(v, depth + 1) for v in value)
    if isinstance(value, dict):
        if depth > 0:
            raise TemplateError("objects may contain only scalar values")
        if len(value) > 100:
            raise TemplateError("objects may contain at most 100 entries")
        if any(not isinstance(k, str) for k in value):
            raise TemplateError("object keys must be strings")
        return sum(len(k) + _value_size(v, depth + 1) for k, v in value.items())
    raise TemplateError("values must be strings, numbers, booleans, nulls, arrays, or objects")


def _string(value: Any) -> str:
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and (value != value or abs(value) == float("inf")):
        raise TemplateError("numbers must be finite")
    return str(value)


def _encode(value: Any, allow_reserved: bool) -> str:
    safe = _UNRESERVED + (_RESERVED if allow_reserved else "")
    try:
        return quote(_string(value), safe=safe, encoding="utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise TemplateError("values must contain valid Unicode text") from error


def _expand_expression(expression: Expression, values: dict[str, Any]) -> str:
    op = expression.operator
    config = {
        "": ("", ",", False, False, False),
        "+": ("", ",", False, False, True),
        "#": ("#", ",", False, False, True),
        ".": (".", ".", False, False, False),
        "/": ("/", "/", False, False, False),
        ";": (";", ";", True, True, False),
        "?": ("?", "&", True, False, False),
        "&": ("&", "&", True, False, False),
    }
    prefix, separator, named, omit_empty, reserved = config[op]
    items: list[str] = []
    for spec in expression.variables:
        if spec.name not in values:
            continue
        value = values[spec.name]
        # Var names are already RFC 6570 encoded; do not encode '%' twice.
        name = spec.name
        if spec.prefix is not None and isinstance(value, (list, dict)):
            raise TemplateError(f"prefix modifier requires a scalar value for {spec.name}")
        if value is None or value == "":
            if omit_empty:
                if named:
                    items.append(name)
                continue
        if isinstance(value, str) and spec.prefix is not None:
            value = value[:spec.prefix]
        if isinstance(value, list):
            strings = [_string(v) for v in value]
            if spec.explode:
                if named:
                    items.extend(_named(name, _encode(v, reserved), op, omit_empty) for v in strings)
                else:
                    items.extend(_encode(v, reserved) for v in strings)
            else:
                joined = ",".join(_encode(v, reserved) for v in strings)
                items.append(_named(name, joined, op, omit_empty) if named else joined)
        elif isinstance(value, dict):
            pairs = [(_encode(k, False), _encode(v, reserved)) for k, v in value.items()]
            if spec.explode:
                items.extend(_named(k, v, op, omit_empty) for k, v in pairs)
            else:
                joined = ",".join(piece for pair in pairs for piece in pair)
                items.append(_named(name, joined, op, omit_empty) if named else joined)
        else:
            encoded = _encode(value, reserved)
            items.append(_named(name, encoded, op, omit_empty) if named else encoded)
    return prefix + separator.join(items) if items else ""


def _named(name: str, value: str, operator: str, omit_empty: bool) -> str:
    if value == "" and omit_empty:
        return name
    return f"{name}={value}"
