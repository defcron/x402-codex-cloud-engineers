"""Bounded RFC 6901 presence/type checks. Target values are never returned."""
import json
import math

MAX_BYTES, MAX_NODES, MAX_DEPTH = 1_048_576, 10_000, 64
MAX_POINTERS, MAX_POINTER_LENGTH = 100, 1_024


class RequestError(ValueError):
    """Invalid request shape or bounded JSON document."""


def _type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise RequestError("non-finite numbers are not JSON")
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    raise RequestError("data must contain only JSON values")


def _check_data(data):
    stack, count = [(data, 0)], 0
    while stack:
        value, depth = stack.pop()
        count += 1
        if count > MAX_NODES:
            raise RequestError("data exceeds 10000 nodes")
        if depth > MAX_DEPTH:
            raise RequestError("data exceeds depth 64")
        kind = _type(value)
        if kind == "object":
            if any(not isinstance(key, str) for key in value):
                raise RequestError("object keys must be strings")
            stack.extend((child, depth + 1) for child in value.values())
        elif kind == "array":
            stack.extend((child, depth + 1) for child in value)
    try:
        size = len(json.dumps(data, ensure_ascii=False, allow_nan=False,
                              separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise RequestError("data must be valid UTF-8 JSON") from exc
    if size > MAX_BYTES:
        raise RequestError("data exceeds 1048576 bytes")


def _decode(pointer):
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError("pointer must start with '/'")
    tokens = []
    for raw in pointer[1:].split("/"):
        token, i = [], 0
        while i < len(raw):
            if raw[i] != "~":
                token.append(raw[i])
                i += 1
            elif i + 1 < len(raw) and raw[i + 1] in "01":
                token.append("~" if raw[i + 1] == "0" else "/")
                i += 2
            else:
                raise ValueError("invalid '~' escape")
        tokens.append("".join(token))
    return tokens


def _resolve(data, tokens):
    value = data
    for token in tokens:
        if isinstance(value, dict):
            if token not in value:
                return False, None
            value = value[token]
        elif isinstance(value, list):
            if (token == "-" or not token.isascii() or not token.isdigit()
                    or (len(token) > 1 and token.startswith("0"))):
                return False, None
            index = int(token)
            if index >= len(value):
                return False, None
            value = value[index]
        else:
            return False, None
    return True, value


def check_paths(request):
    """Request: {'data': JSON value, 'pointers': [RFC 6901 strings]}."""
    if not isinstance(request, dict) or set(request) != {"data", "pointers"}:
        raise RequestError("request must contain exactly data and pointers")
    data, pointers = request["data"], request["pointers"]
    _check_data(data)
    if not isinstance(pointers, list) or len(pointers) > MAX_POINTERS:
        raise RequestError("pointers must be an array of at most 100 strings")
    results = []
    for pointer in pointers:
        if not isinstance(pointer, str):
            raise RequestError("each pointer must be a string")
        if len(pointer) > MAX_POINTER_LENGTH:
            raise RequestError("pointer exceeds 1024 characters")
        try:
            exists, value = _resolve(data, _decode(pointer))
            results.append({"pointer": pointer, "valid": True, "exists": exists,
                            "type": _type(value) if exists else None, "error": None})
        except ValueError:
            results.append({"pointer": pointer, "valid": False, "exists": False,
                            "type": None, "error": "invalid_pointer_syntax"})
    return {"results": results}
