import unittest

from cors_preflight_audit import RequestError, analyze_preflight


def exchange(*, origin="https://agent.example", method="POST",
             headers=None, credentials=False, status=204, response_headers=None):
    if response_headers is None:
        response_headers = [
            ["Access-Control-Allow-Origin", origin],
            ["Access-Control-Allow-Methods", "POST, OPTIONS"],
            ["Access-Control-Allow-Headers", "authorization, content-type"],
            ["Access-Control-Allow-Credentials", "true"],
        ]
    return {
        "request": {"origin": origin, "method": method,
                    "headers": headers or [], "credentials": credentials},
        "response": {"status": status, "headers": response_headers},
    }


class CorsPreflightAuditTests(unittest.TestCase):
    def test_matching_credentialed_preflight(self):
        self.assertEqual(analyze_preflight(exchange(
            headers=["Authorization", "Content-Type"], credentials=True)),
            {"allowed": True, "issues": []})

    def test_noncredentialed_wildcards(self):
        headers = [
            ["Access-Control-Allow-Origin", "*"],
            ["Access-Control-Allow-Methods", "*"],
            ["Access-Control-Allow-Headers", "*"],
        ]
        self.assertTrue(analyze_preflight(exchange(
            headers=["x-agent-id"], response_headers=headers))["allowed"])

    def test_wildcard_origin_is_rejected_with_credentials(self):
        headers = [
            ["Access-Control-Allow-Origin", "*"],
            ["Access-Control-Allow-Methods", "POST"],
            ["Access-Control-Allow-Credentials", "true"],
        ]
        result = analyze_preflight(exchange(credentials=True, response_headers=headers))
        self.assertIn("origin_wildcard_with_credentials", result["issues"])

    def test_header_names_are_case_insensitive_but_methods_are_case_sensitive(self):
        headers = [
            ["Access-Control-Allow-Origin", "https://agent.example"],
            ["Access-Control-Allow-Methods", "post"],
            ["Access-Control-Allow-Headers", "X-AGENT-ID"],
        ]
        result = analyze_preflight(exchange(method="POST", headers=["x-agent-id"],
                                           response_headers=headers))
        self.assertEqual(result["issues"], ["method_not_allowed"])

    def test_authorization_is_not_covered_by_header_wildcard(self):
        headers = [
            ["Access-Control-Allow-Origin", "*"],
            ["Access-Control-Allow-Methods", "*"],
            ["Access-Control-Allow-Headers", "*"],
        ]
        result = analyze_preflight(exchange(headers=["Authorization"],
                                           response_headers=headers))
        self.assertIn("requested_header_not_allowed", result["issues"])

    def test_missing_requested_header_and_credentials_permission(self):
        headers = [
            ["Access-Control-Allow-Origin", "https://agent.example"],
            ["Access-Control-Allow-Methods", "POST"],
            ["Access-Control-Allow-Headers", "content-type"],
        ]
        result = analyze_preflight(exchange(headers=["x-agent-id"], credentials=True,
                                           response_headers=headers))
        self.assertIn("requested_header_not_allowed", result["issues"])
        self.assertIn("allow_credentials_missing_or_invalid", result["issues"])

    def test_status_origin_and_duplicate_origin_findings(self):
        base = [
            ["Access-Control-Allow-Origin", "https://other.example"],
            ["Access-Control-Allow-Methods", "POST"],
        ]
        result = analyze_preflight(exchange(status=403, response_headers=base))
        self.assertEqual(result["issues"],
                         ["preflight_status_not_success", "allow_origin_mismatch"])
        duplicate = base + [["Access-Control-Allow-Origin", "https://agent.example"]]
        self.assertIn("allow_origin_duplicate",
                      analyze_preflight(exchange(response_headers=duplicate))["issues"])

    def test_malformed_capture_is_rejected(self):
        for payload in (
            {},
            exchange(method="bad method"),
            exchange(response_headers=[["X-Test", "ok\r\nInjected: yes"]]),
            exchange(status=True),
            exchange(headers=["bad header"]),
        ):
            with self.assertRaises(RequestError):
                analyze_preflight(payload)

    def test_input_bounds(self):
        with self.assertRaises(RequestError):
            analyze_preflight(exchange(headers=["X-Test"] * 101))
        with self.assertRaises(RequestError):
            analyze_preflight(exchange(response_headers=[["X-Test", "x" * 8193]]))


if __name__ == "__main__":
    unittest.main()
