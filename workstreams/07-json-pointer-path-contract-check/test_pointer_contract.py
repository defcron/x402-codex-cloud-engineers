import unittest

from pointer_contract import RequestError, check_paths


class ContractTests(unittest.TestCase):
    def test_root_and_types(self):
        r = check_paths({"data": {"n": 1, "b": True, "z": None, "a": [], "o": {}},
                         "pointers": ["", "/n", "/b", "/z", "/a", "/o"]})["results"]
        self.assertEqual([x["type"] for x in r],
                         ["object", "number", "boolean", "null", "array", "object"])
        self.assertTrue(all(x["exists"] for x in r))

    def test_rfc6901_escapes(self):
        r = check_paths({"data": {"a/b": {"m~n": "private"}},
                         "pointers": ["/a~1b/m~0n"]})["results"][0]
        self.assertEqual((r["exists"], r["type"]), (True, "string"))

    def test_array_indexes_missing_null_and_scalar(self):
        r = check_paths({"data": {"items": ["x", None], "scalar": 3},
                         "pointers": ["/items/0", "/items/1", "/items/01",
                                      "/items/-", "/missing", "/scalar/x"]})["results"]
        self.assertEqual([(x["exists"], x["type"]) for x in r],
                         [(True, "string"), (True, "null"), (False, None),
                          (False, None), (False, None), (False, None)])

    def test_malformed_pointer_is_item_scoped(self):
        r = check_paths({"data": {}, "pointers": ["/bad~2", "relative", "/ok"]})["results"]
        self.assertEqual([x["error"] for x in r],
                         ["invalid_pointer_syntax", "invalid_pointer_syntax", None])

    def test_values_are_never_returned(self):
        r = check_paths({"data": {"token": "do-not-echo"}, "pointers": ["/token"]})
        self.assertNotIn("do-not-echo", repr(r))
        self.assertEqual(set(r["results"][0]), {"pointer", "valid", "exists", "type", "error"})

    def test_request_and_document_bounds(self):
        for request in (
            {"data": {}, "pointers": [], "extra": 1},
            {"data": {}, "pointers": ["/"] * 101},
            {"data": {}, "pointers": ["/" + "x" * 1024]},
            {"data": [None] * 10_000, "pointers": []},
            {"data": "x" * 1_048_577, "pointers": []},
        ):
            with self.assertRaises(RequestError):
                check_paths(request)
        deep = None
        for _ in range(65):
            deep = [deep]
        with self.assertRaises(RequestError):
            check_paths({"data": deep, "pointers": []})


    def test_exact_supported_limits(self):
        long_key = "k" * 1023
        result = check_paths({"data": {long_key: 0},
                              "pointers": ["/" + long_key]})["results"][0]
        self.assertEqual((result["exists"], result["type"]), (True, "number"))
        self.assertEqual(len(check_paths({"data": None, "pointers": [""] * 100})["results"]), 100)
        deep = None
        pointer = ""
        for _ in range(64):
            deep = [deep]
            pointer += "/0"
        result = check_paths({"data": deep, "pointers": [pointer]})["results"][0]
        self.assertEqual((result["exists"], result["type"]), (True, "null"))
        self.assertEqual(len(check_paths({"data": [None] * 9999, "pointers": []})["results"]), 0)
        result = check_paths({"data": "x" * 1_048_574, "pointers": [""]})["results"][0]
        self.assertEqual((result["exists"], result["type"]), (True, "string"))

if __name__ == "__main__":
    unittest.main()
