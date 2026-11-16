import unittest

from uri_template import TemplateError, expand, inspect, parse


class ParseTests(unittest.TestCase):
    def test_expression_metadata(self):
        self.assertEqual(inspect("/users/{id}{?fields*}")["variables"], ["id", "fields"])
        expression = inspect("{?fields*}")["expressions"][0]
        self.assertEqual(expression, {"operator": "?", "variables": [{"name": "fields", "explode": True, "prefix": None}]})

    def test_malformed_braces_and_expression(self):
        for template in ("x}", "{x", "{{x}}", "{}", "{x,,y}", "{x:0}", "{x:10000}", "{x:2*}", "{bad name}", "{x%Q1}"):
            with self.subTest(template=template), self.assertRaises(TemplateError):
                parse(template)

    def test_invalid_literal_characters_and_percent_escapes(self):
        for template in ("/has space", "/bad%", "/bad%Q0", "/emoji-😀"):
            with self.subTest(template=template), self.assertRaises(TemplateError):
                parse(template)

    def test_limits(self):
        self.assertEqual(len(parse("a" * 4096)[0].literal), 4096)
        self.assertEqual(len(inspect("{x}" * 100)["expressions"]), 100)
        self.assertEqual(len(inspect("{" + ",".join(f"v{i}" for i in range(50)) + "}")["variables"]), 50)
        self.assertEqual(len(inspect("{" + "x" * 256 + "}")["variables"][0]), 256)
        with self.assertRaisesRegex(TemplateError, "256"):
            inspect("{" + "x" * 257 + "}")
        with self.assertRaisesRegex(TemplateError, "4096"):
            parse("a" * 4097)
        with self.assertRaisesRegex(TemplateError, "100 expressions"):
            parse("{x}" * 101)
        with self.assertRaisesRegex(TemplateError, "50 unique"):
            parse("{" + ",".join(f"v{i}" for i in range(51)) + "}")


class ExpandTests(unittest.TestCase):
    def test_accepts_maximum_value_and_output_boundaries(self):
        self.assertEqual(len(expand("{x}", {"x": "x" * 4096})["expanded"]), 4096)
        self.assertEqual(expand("{?list*}", {"list": ["x"] * 100})["valid"], True)
        self.assertEqual(len(expand("{x}" * 64, {"x": "x" * 4096})["expanded"]), 262144)
        self.assertEqual(expand("{x}", {f"v{i}": "x" for i in range(50)})["valid"], True)

    def test_rfc6570_operator_examples(self):
        values = {"var": "value", "hello": "Hello World!", "path": "/foo/bar", "x": 1024, "y": 768}
        examples = {
            "{var}": "value",
            "{hello}": "Hello%20World%21",
            "{+path}/here": "/foo/bar/here",
            "{#path}": "#/foo/bar",
            "X{.var}": "X.value",
            "{/var}": "/value",
            "{;x,y}": ";x=1024;y=768",
            "{?x,y}": "?x=1024&y=768",
            "{&x,y}": "&x=1024&y=768",
            "{var:3}": "val",
        }
        for template, expected in examples.items():
            with self.subTest(template=template):
                self.assertEqual(expand(template, values)["expanded"], expected)

    def test_list_and_map_expansion(self):
        values = {"list": ["red", "green", "blue"], "keys": {"semi": ";", "dot": ".", "comma": ","}}
        self.assertEqual(expand("{?list}", values)["expanded"], "?list=red,green,blue")
        self.assertEqual(expand("{list*}", values)["expanded"], "red,green,blue")
        self.assertEqual(expand("{/list*}", values)["expanded"], "/red/green/blue")
        self.assertEqual(expand("{.list*}", values)["expanded"], ".red.green.blue")
        self.assertEqual(expand("{;list*}", values)["expanded"], ";list=red;list=green;list=blue")
        self.assertEqual(expand("{?list*}", values)["expanded"], "?list=red&list=green&list=blue")
        self.assertEqual(expand("{keys*}", values)["expanded"], "semi=%3B,dot=.,comma=%2C")
        self.assertEqual(expand("{.keys*}", values)["expanded"], ".semi=%3B.dot=..comma=%2C")
        self.assertEqual(expand("{/keys*}", values)["expanded"], "/semi=%3B/dot=./comma=%2C")
        self.assertEqual(expand("{;keys*}", values)["expanded"], ";semi=%3B;dot=.;comma=%2C")
        self.assertEqual(expand("{?keys*}", values)["expanded"], "?semi=%3B&dot=.&comma=%2C")
        self.assertEqual(expand("{keys}", values)["expanded"], "semi,%3B,dot,.,comma,%2C")

    def test_reserved_and_utf8_encoding(self):
        self.assertEqual(expand("{var}", {"var": "a/b café"})["expanded"], "a%2Fb%20caf%C3%A9")
        self.assertEqual(expand("{+var}", {"var": "a/b?c"})["expanded"], "a/b?c")

    def test_empty_and_missing_values(self):
        result = expand("/p/{id}{?q,missing}", {"id": "", "q": ""})
        self.assertEqual(result["expanded"], "/p/?q=")
        self.assertEqual(result["missing_variables"], ["missing"])
        self.assertEqual(result["unused_variables"], [])
        self.assertEqual(expand("{;empty}", {"empty": ""})["expanded"], ";empty")
        self.assertEqual(expand("{?empty}", {"empty": ""})["expanded"], "?empty=")
        self.assertEqual(expand("{?absent}", {})["expanded"], "")

    def test_unused_variables_are_reported(self):
        result = expand("/p/{id}", {"id": 7, "other": "x"})
        self.assertEqual(result["unused_variables"], ["other"])

    def test_encoded_and_prototype_like_variable_names(self):
        self.assertEqual(expand("{?foo%20bar}", {"foo%20bar": "x"})["expanded"], "?foo%20bar=x")
        self.assertEqual(expand("{?__proto__,constructor}", {"__proto__": "p", "constructor": "c"})["expanded"], "?__proto__=p&constructor=c")

    def test_input_bounds_and_unsafe_types(self):
        cases = [
            ("{x}", {"x": "a" * 4097}),
            ("{x}", {"x": ["v"] * 101}),
            ("{x}", {"x": {"nested": {"bad": 1}}}),
            ("{x:2}", {"x": ["a"]}),
            ("{x}", {"x": float("inf")}),
            ("{x}", {"x": "\ud800"}),
            ("{x}", {"x": object()}),
            ("{x}" * 100, {"x": "x" * 4096}),
        ]
        for template, values in cases:
            with self.subTest(template=template, values=type(values["x"]).__name__), self.assertRaises(TemplateError):
                expand(template, values)

    def test_value_count_limit(self):
        values = {f"v{i}": "x" for i in range(51)}
        with self.assertRaisesRegex(TemplateError, "50 variables"):
            expand("{x}", values)


if __name__ == "__main__":
    unittest.main()
