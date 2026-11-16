"""Static audit of a captured CORS preflight exchange (no network or browser use)."""
import re

MAX_HEADER_PAIRS = 100
MAX_FIELD_VALUE = 8_192
MAX_TOTAL_BYTES = 32_768
MAX_REQUEST_HEADERS = 100
MAX_NAME = 256
MAX_ORIGIN = 2_048
_TOKEN_PUNCT = set("!#$%&'*+-.^_`|~")


class RequestError(ValueError):
    """Captured request/response is malformed or exceeds the input contract."""


def _token(value):
    return (isinstance(value, str) and bool(value) and len(value) <= MAX_NAME
            and value.isascii()
            and all(ch.isalnum() or ch in _TOKEN_PUNCT for ch in value))


def _safe_text(value, limit):
    return (isinstance(value, str) and len(value) <= limit
            and not any(ord(ch) < 32 and ch != "\t" or ord(ch) == 127 for ch in value))


def _validate(request):
    if not isinstance(request, dict) or set(request) != {"request", "response"}:
        raise RequestError("request must contain exactly request and response")
    req, res = request["request"], request["response"]
    if not isinstance(req, dict) or set(req) != {"origin", "method", "headers", "credentials"}:
        raise RequestError("request fields must be origin, method, headers, credentials")
    if not isinstance(res, dict) or set(res) != {"status", "headers"}:
        raise RequestError("response fields must be status and headers")
    if not _safe_text(req["origin"], MAX_ORIGIN) or not req["origin"]:
        raise RequestError("origin must be a non-empty bounded header value")
    if not _token(req["method"]):
        raise RequestError("method must be a bounded HTTP token")
    if not isinstance(req["credentials"], bool):
        raise RequestError("credentials must be boolean")
    names = req["headers"]
    if not isinstance(names, list) or len(names) > MAX_REQUEST_HEADERS:
        raise RequestError("headers must be an array of at most 100 names")
    if any(not _token(name) for name in names):
        raise RequestError("requested headers must be bounded HTTP tokens")
    status = res["status"]
    if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
        raise RequestError("response status must be an integer from 100 to 599")
    pairs = res["headers"]
    if not isinstance(pairs, list) or len(pairs) > MAX_HEADER_PAIRS:
        raise RequestError("response headers must be an array of at most 100 pairs")
    total = 0
    for pair in pairs:
        if (not isinstance(pair, list) or len(pair) != 2
                or not _token(pair[0]) or not _safe_text(pair[1], MAX_FIELD_VALUE)):
            raise RequestError("each response header must be a valid [name, value] pair")
        total += len(pair[0].encode("utf-8")) + len(pair[1].encode("utf-8"))
        if total > MAX_TOTAL_BYTES:
            raise RequestError("response headers exceed 32768 UTF-8 bytes")
    return req, res


def _split_list(values):
    items = []
    valid = True
    for value in values:
        for item in value.split(","):
            item = item.strip(" \t")
            if not item:
                valid = False
            else:
                items.append(item)
    return items, valid


def analyze_preflight(payload):
    """Return allow/deny and stable issue codes, never echo header values."""
    req, res = _validate(payload)
    fields = {}
    for name, value in res["headers"]:
        fields.setdefault(name.lower(), []).append(value.strip(" \t"))
    issues = []

    def add(code):
        if code not in issues:
            issues.append(code)

    if not 200 <= res["status"] < 300:
        add("preflight_status_not_success")

    origins = fields.get("access-control-allow-origin", [])
    if not origins:
        add("allow_origin_missing")
    elif len(origins) != 1:
        add("allow_origin_duplicate")
    elif origins[0] == "*":
        if req["credentials"]:
            add("origin_wildcard_with_credentials")
    elif origins[0] != req["origin"]:
        add("allow_origin_mismatch")

    if req["credentials"]:
        credentials = fields.get("access-control-allow-credentials", [])
        if len(credentials) != 1 or credentials[0] != "true":
            add("allow_credentials_missing_or_invalid")

    method_values = fields.get("access-control-allow-methods", [])
    if not method_values:
        add("allow_methods_missing")
    else:
        methods, valid = _split_list(method_values)
        if not valid or any(m != "*" and not _token(m) for m in methods):
            add("allow_methods_invalid")
        elif req["method"] not in methods and not ("*" in methods and not req["credentials"]):
            add("method_not_allowed")

    requested = {name.lower() for name in req["headers"]}
    if requested:
        header_values = fields.get("access-control-allow-headers", [])
        if not header_values:
            add("allow_headers_missing")
        else:
            allowed, valid = _split_list(header_values)
            allowed_lower = {name.lower() for name in allowed if name != "*"}
            if not valid or any(name != "*" and not _token(name) for name in allowed):
                add("allow_headers_invalid")
            wildcard = "*" in allowed and not req["credentials"]
            # Fetch treats Authorization as a CORS non-wildcard request-header name.
            denied = {name for name in requested
                      if name not in allowed_lower and not (wildcard and name != "authorization")}
            if denied:
                add("requested_header_not_allowed")

    return {"allowed": not issues, "issues": issues}
