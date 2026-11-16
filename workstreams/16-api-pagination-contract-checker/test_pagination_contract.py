import unittest

from pagination_contract import ContractInputError, check_pagination_trace, parse_request


class PaginationTraceTests(unittest.TestCase):
    def test_cursor_trace_passes(self):
        result = check_pagination_trace({
            "mode": "cursor",
            "pages": [
                {"request_cursor": None, "next_cursor": "c1", "has_more": True, "item_ids": ["a", "b"], "total_count": 3},
                {"request_cursor": "c1", "next_cursor": None, "has_more": False, "item_ids": ["c"], "total_count": 3},
            ],
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["findings"], [])
        self.assertEqual(result["unique_item_ids"], 3)

    def test_repeated_cursor_is_reported_without_echoing_token(self):
        result = check_pagination_trace({
            "mode": "cursor",
            "pages": [
                {"next_cursor": "secret-token", "has_more": True, "item_ids": ["a"]},
                {"request_cursor": "secret-token", "next_cursor": "secret-token", "has_more": True, "item_ids": ["b"]},
            ],
        })
        codes = {finding["code"] for finding in result["findings"]}
        self.assertIn("cursor_not_advancing", codes)
        self.assertIn("trace_incomplete", codes)
        self.assertNotIn("secret-token", repr(result))

    def test_page_after_terminal_is_reported(self):
        result = check_pagination_trace({
            "mode": "cursor",
            "pages": [
                {"has_more": False, "item_ids": ["a"]},
                {"request_cursor": None, "has_more": False, "item_ids": ["b"]},
            ],
        })
        self.assertIn("page_after_terminal", {f["code"] for f in result["findings"]})

    def test_offset_sequence_and_boundary_limit_pass(self):
        result = check_pagination_trace({
            "mode": "offset",
            "pages": [
                {"request_offset": 0, "limit": 2, "next_offset": 2, "has_more": True, "item_ids": ["a", "b"]},
                {"request_offset": 2, "limit": 2, "next_offset": None, "has_more": False, "item_ids": ["c"]},
            ],
        })
        self.assertTrue(result["ok"])

    def test_offset_that_does_not_advance_is_reported(self):
        result = check_pagination_trace({
            "mode": "offset",
            "pages": [
                {"request_offset": 0, "limit": 2, "next_offset": 0, "has_more": True, "item_ids": ["a"]},
            ],
        })
        self.assertIn("offset_not_advancing", {f["code"] for f in result["findings"]})

    def test_page_number_gap_is_reported(self):
        result = check_pagination_trace({
            "mode": "page_number",
            "pages": [
                {"request_page": 1, "page_size": 2, "next_page": 3, "has_more": True, "item_ids": ["a"]},
                {"request_page": 3, "page_size": 2, "next_page": None, "has_more": False, "item_ids": ["b"]},
            ],
        })
        self.assertIn("page_number_not_advancing", {f["code"] for f in result["findings"]})

    def test_duplicates_and_terminal_count_mismatch_are_reported(self):
        result = check_pagination_trace({
            "mode": "cursor",
            "pages": [
                {"next_cursor": "c1", "has_more": True, "item_ids": ["same"], "total_count": 4},
                {"request_cursor": "c1", "has_more": False, "item_ids": ["same"], "total_count": 4},
            ],
        })
        codes = {finding["code"] for finding in result["findings"]}
        self.assertIn("duplicate_item_id", codes)
        self.assertIn("terminal_total_count_mismatch", codes)

    def test_empty_page_with_more_and_missing_continuation_are_reported(self):
        result = check_pagination_trace({
            "mode": "cursor",
            "pages": [{"has_more": True, "item_ids": []}],
        })
        codes = {finding["code"] for finding in result["findings"]}
        self.assertIn("empty_page_with_more", codes)
        self.assertIn("missing_next_cursor", codes)

    def test_malformed_and_oversized_inputs_are_rejected(self):
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": "unknown", "pages": []})
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": [], "pages": []})
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": "cursor", "pages": [{"has_more": 1, "item_ids": []}]})
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": "cursor", "pages": [{"has_more": False, "item_ids": ["x" * 257]}]})
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": "cursor", "pages": [{"has_more": False, "item_ids": []}] * 11})
        with self.assertRaises(ContractInputError):
            check_pagination_trace({"mode": "cursor", "pages": [{"has_more": False, "item_ids": [], "total_count": True}]})

    def test_bounded_json_parser_accepts_utf8_and_rejects_bad_bodies(self):
        valid = b'{"mode":"cursor","pages":[{"has_more":false,"item_ids":["a"]}]}'
        self.assertTrue(parse_request(valid)["ok"])
        with self.assertRaises(ContractInputError):
            parse_request(b"not-json")
        with self.assertRaises(ContractInputError):
            parse_request(bytes([255]))
        with self.assertRaises(ContractInputError):
            parse_request(b" " * 65537)

    def test_invalid_integer_boolean_is_not_accepted(self):
        with self.assertRaises(ContractInputError):
            check_pagination_trace({
                "mode": "offset",
                "pages": [{"request_offset": True, "limit": 1, "next_offset": None, "has_more": False, "item_ids": []}],
            })


if __name__ == "__main__":
    unittest.main()
