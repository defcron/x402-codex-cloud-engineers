import csv
import unittest

from csv_schema_sql import MAX_COLUMNS, MAX_IDENTIFIER_CHARS, MAX_INPUT_CHARS, MAX_ROWS, create_table_response, generate_ddl


class GenerateDdlTests(unittest.TestCase):
    def test_infers_sql_types_and_emits_ddl_only(self):
        sql = generate_ddl('id,price,active,note\n1,2.5,true,ok\n2,3.75,false,', 'items')
        self.assertIn('"id" BIGINT', sql)
        self.assertIn('"price" NUMERIC', sql)
        self.assertIn('"active" BOOLEAN', sql)
        self.assertIn('"note" TEXT', sql)
        self.assertNotIn('INSERT', sql)
        self.assertNotIn('ok', sql)

    def test_quotes_identifiers_per_dialect(self):
        self.assertIn('"odd""table"', generate_ddl('c"ol\nx', 'odd"table'))
        self.assertIn('`odd``table`', generate_ddl('c\nx', 'odd`table', 'mysql'))
        self.assertIn('"odd""table"', generate_ddl('c\nx', 'odd"table', 'sqlite'))

    def test_handles_multiline_fields_and_empty_columns(self):
        sql = generate_ddl('note,blank\n"line one\nline two",\n', 't')
        self.assertIn('"note" TEXT', sql)
        self.assertIn('"blank" TEXT', sql)
        self.assertNotIn('line one', sql)

    def test_preserves_leading_zero_identifiers_as_text(self):
        sql = generate_ddl("postal,amount\n00123,4.20\n00456,5.10", "addresses", "sqlite")
        self.assertIn('"postal" TEXT', sql)
        self.assertIn('"amount" REAL', sql)

    def test_rejects_empty_headers_duplicate_names_and_bad_width(self):
        cases = ('', 'a,\n1,2', 'a,a\n1,2', 'a,b\n1')
        for source in cases:
            with self.subTest(source=source), self.assertRaises(ValueError):
                generate_ddl(source, 't')

    def test_enforces_resource_bounds(self):
        with self.assertRaisesRegex(ValueError, 'character limit'):
            generate_ddl('x' * (MAX_INPUT_CHARS + 1), 't')
        too_many_columns = ','.join(f'c{i}' for i in range(MAX_COLUMNS + 1))
        with self.assertRaisesRegex(ValueError, 'column limit'):
            generate_ddl(too_many_columns, 't')
        rows = 'id\n' + '\n'.join(str(i) for i in range(MAX_ROWS + 1))
        with self.assertRaisesRegex(ValueError, 'row limit'):
            generate_ddl(rows, 't')

    def test_rejects_malformed_csv_and_large_integer_uses_numeric_family(self):
        with self.assertRaises(csv.Error):
            generate_ddl('a\n"unterminated', 't')
        sql = generate_ddl('id\n9223372036854775808', 't', 'postgres')
        self.assertIn('"id" NUMERIC', sql)

    def test_rejects_invalid_identifier(self):
        with self.assertRaisesRegex(ValueError, 'NUL'):
            generate_ddl('a\n1', 'bad\x00name')
        with self.assertRaisesRegex(ValueError, '128 characters'):
            generate_ddl('a\n1', 't' * (MAX_IDENTIFIER_CHARS + 1))

    def test_json_route_adapter_validates_and_returns_ddl(self):
        result = create_table_response({'csv': 'id\n1', 'table': 'items', 'dialect': 'sqlite'})
        self.assertIn('CREATE TABLE "items"', result['statement'])
        self.assertEqual(result['dialect'], 'sqlite')
        for invalid in (None, [], {'csv': 1, 'table': 't'}, {'csv': 'a\n1', 'table': 't', 'extra': True}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                create_table_response(invalid)


if __name__ == '__main__':
    unittest.main()
