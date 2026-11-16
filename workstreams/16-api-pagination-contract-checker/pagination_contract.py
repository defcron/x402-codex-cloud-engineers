"""Deterministic checks for captured cursor, offset, and page-number traces.

This module does not fetch URLs, interpret arbitrary response bodies, or execute
caller-provided code. Item identifiers are used only for cross-page consistency
checks and are never copied into findings.
"""
from __future__ import annotations

from typing import Any

MAX_PAYLOAD_BYTES = 65536
MAX_PAGES = 10
MAX_ITEMS_PER_PAGE = 100
MAX_TOTAL_ITEMS = 1000
MAX_ID_LENGTH = 256
MAX_CURSOR_LENGTH = 512


class ContractInputError(ValueError):
    """Raised when a trace is malformed or exceeds documented limits."""


def _object(value: Any, allowed: set[str], required: set[str], label: str) -> dict:
    if not isinstance(value, dict):
        raise ContractInputError(f"{label} must be an object")
    if set(value) - allowed or required - set(value):
        raise ContractInputError(f"{label} has missing or unsupported fields")
    return value


def _integer(value: Any, label: str, minimum: int = 0, maximum: int = 2**31 - 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ContractInputError(f"{label} must be an integer in range")
    return value


def _items(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > MAX_ITEMS_PER_PAGE:
        raise ContractInputError("item_ids must be an array of at most 100 strings")
    if any(not isinstance(item, str) or not item or len(item) > MAX_ID_LENGTH for item in value):
        raise ContractInputError("each item id must be a non-empty string of at most 256 characters")
    return value


def _cursor(value: Any, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > MAX_CURSOR_LENGTH:
        raise ContractInputError(f"{label} must be null or a non-empty string of at most 512 characters")
    return value


def check_pagination_trace(payload: Any) -> dict:
    """Return deterministic findings for a bounded sequence of page snapshots.

    The envelope has mode cursor, offset, or page_number and an array of pages.
    Each page supplies item_ids and has_more plus mode-specific request/next
    continuation values. total_count is optional and may be repeated per page.
    """
    envelope = _object(payload, {"mode", "pages"}, {"mode", "pages"}, "request")
    mode = envelope["mode"]
    if not isinstance(mode, str) or mode not in {"cursor", "offset", "page_number"}:
        raise ContractInputError("mode must be cursor, offset, or page_number")
    pages = envelope["pages"]
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise ContractInputError("pages must contain between 1 and 10 snapshots")

    findings: list[dict] = []
    seen_ids: dict[str, int] = {}
    seen_cursors: set[str] = set()
    total_count: int | None = None
    item_count = 0
    complete = False
    previous_next: Any = None
    previous_had_more = True

    for index, raw_page in enumerate(pages, start=1):
        base = {"item_ids", "has_more"}
        optional = {"total_count"}
        if mode == "cursor":
            allowed = base | optional | {"request_cursor", "next_cursor"}
            required = base
        elif mode == "offset":
            allowed = base | optional | {"request_offset", "next_offset", "limit"}
            required = base | {"request_offset", "limit"}
        else:
            allowed = base | optional | {"request_page", "next_page", "page_size"}
            required = base | {"request_page", "page_size"}

        page = _object(raw_page, allowed, required, f"pages[{index - 1}]")
        items = _items(page["item_ids"])
        item_count += len(items)
        if item_count > MAX_TOTAL_ITEMS:
            raise ContractInputError("trace may contain at most 1000 item ids")

        has_more = page["has_more"]
        if not isinstance(has_more, bool):
            raise ContractInputError(f"pages[{index - 1}].has_more must be boolean")
        if index > 1 and not previous_had_more:
            findings.append({"code": "page_after_terminal", "page": index})

        if "total_count" in page:
            current_total = _integer(page["total_count"], "total_count")
            if total_count is None:
                total_count = current_total
            elif current_total != total_count:
                findings.append({"code": "total_count_changed", "page": index})

        for item_id in items:
            if item_id in seen_ids:
                findings.append({"code": "duplicate_item_id", "page": index, "first_page": seen_ids[item_id]})
            else:
                seen_ids[item_id] = index

        if mode == "cursor":
            request_cursor = _cursor(page.get("request_cursor"), "request_cursor")
            next_cursor = _cursor(page.get("next_cursor"), "next_cursor")
            expected = None if index == 1 else previous_next
            if request_cursor != expected:
                findings.append({"code": "request_cursor_mismatch", "page": index})
            if has_more:
                if next_cursor is None:
                    findings.append({"code": "missing_next_cursor", "page": index})
                elif next_cursor in seen_cursors or next_cursor == request_cursor:
                    findings.append({"code": "cursor_not_advancing", "page": index})
                else:
                    seen_cursors.add(next_cursor)
                if not items:
                    findings.append({"code": "empty_page_with_more", "page": index})
            elif next_cursor is not None:
                findings.append({"code": "terminal_page_has_next_cursor", "page": index})
            previous_next = next_cursor

        elif mode == "offset":
            offset = _integer(page["request_offset"], "request_offset")
            limit = _integer(page["limit"], "limit", 1, MAX_ITEMS_PER_PAGE)
            next_offset = page.get("next_offset")
            if next_offset is not None:
                next_offset = _integer(next_offset, "next_offset")
            expected = 0 if index == 1 else previous_next
            if offset != expected:
                findings.append({"code": "request_offset_mismatch", "page": index})
            if has_more:
                if next_offset is None or next_offset <= offset:
                    findings.append({"code": "offset_not_advancing", "page": index})
                if not items:
                    findings.append({"code": "empty_page_with_more", "page": index})
            elif next_offset is not None:
                findings.append({"code": "terminal_page_has_next_offset", "page": index})
            if len(items) > limit:
                findings.append({"code": "page_exceeds_limit", "page": index})
            previous_next = next_offset

        else:
            requested_page = _integer(page["request_page"], "request_page", 1)
            page_size = _integer(page["page_size"], "page_size", 1, MAX_ITEMS_PER_PAGE)
            next_page = page.get("next_page")
            if next_page is not None:
                next_page = _integer(next_page, "next_page", 1)
            expected = 1 if index == 1 else previous_next
            if requested_page != expected:
                findings.append({"code": "request_page_mismatch", "page": index})
            if has_more:
                if next_page != requested_page + 1:
                    findings.append({"code": "page_number_not_advancing", "page": index})
                if not items:
                    findings.append({"code": "empty_page_with_more", "page": index})
            elif next_page is not None:
                findings.append({"code": "terminal_page_has_next_page", "page": index})
            if len(items) > page_size:
                findings.append({"code": "page_exceeds_page_size", "page": index})
            previous_next = next_page

        if index == len(pages):
            complete = not has_more
        previous_had_more = has_more

    if total_count is not None and total_count < len(seen_ids):
        findings.append({"code": "total_count_below_returned_unique_items", "page": len(pages)})
    if complete and total_count is not None and total_count != len(seen_ids):
        findings.append({"code": "terminal_total_count_mismatch", "page": len(pages)})
    if not complete:
        findings.append({"code": "trace_incomplete", "page": len(pages)})

    return {
        "ok": not findings,
        "mode": mode,
        "pages_checked": len(pages),
        "unique_item_ids": len(seen_ids),
        "findings": findings,
        "note": "Checks captured pagination behavior only; it does not fetch or certify the upstream API.",
    }


def parse_request(raw: bytes) -> dict:
    """Parse a bounded UTF-8 JSON request and validate its pagination trace."""
    if not isinstance(raw, bytes) or len(raw) > MAX_PAYLOAD_BYTES:
        raise ContractInputError("request body must be at most 65536 bytes")
    import json

    try:
        payload = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise ContractInputError("request body must be UTF-8 JSON") from exc
    except json.JSONDecodeError as exc:
        raise ContractInputError("request body must be valid JSON") from exc
    return check_pagination_trace(payload)


if __name__ == "__main__":
    import json
    import sys

    try:
        raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
        print(json.dumps(parse_request(raw), separators=(",", ":")))
    except ContractInputError as exc:
        print(json.dumps({"error": str(exc)}, separators=(",", ":")))
