import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CSV_SCHEMA_DDL_MAX_COLUMNS,
  CSV_SCHEMA_DDL_MAX_INPUT_CHARS,
  CSV_SCHEMA_DDL_MAX_ROWS,
  CsvSchemaDdlError,
  createCsvSchemaDdl,
  validateCsvSchemaDdlInput,
} from '../src/csv-schema-ddl.ts';

function parsed(columns, rows) { return { columns, rows }; }

test('infers only a CREATE TABLE schema and never returns input cell values', () => {
  const result = createCsvSchemaDdl(parsed(
    ['id', 'price', 'active', 'note'],
    [
      { id: '1', price: '2.50', active: 'true', note: 'secret' },
      { id: '2', price: '3.75', active: 'false', note: '' },
    ],
  ), 'items', 'postgres');
  assert.match(result.statement, /"id" BIGINT/);
  assert.match(result.statement, /"price" NUMERIC/);
  assert.match(result.statement, /"active" BOOLEAN/);
  assert.match(result.statement, /"note" TEXT/);
  assert.equal(result.statement.includes('INSERT'), false);
  assert.equal(result.statement.includes('secret'), false);
});

test('quotes identifiers per dialect', () => {
  assert.match(createCsvSchemaDdl(parsed(['a"b'], [{ 'a"b': 'v' }]), 'odd"table', 'postgres').statement, /"odd""table"/);
  assert.match(createCsvSchemaDdl(parsed(['a`b'], [{ 'a`b': 'v' }]), 'odd`table', 'mysql').statement, /`odd``table`/);
  assert.match(createCsvSchemaDdl(parsed(['id'], [{ id: '1' }]), 'items', 'sqlite').statement, /"id" INTEGER/);
});

test('preserves leading-zero identifiers as text and handles empty columns', () => {
  const result = createCsvSchemaDdl(parsed(
    ['postal', 'empty'],
    [{ postal: '00123', empty: '' }, { postal: '00456', empty: '' }],
  ), 'addresses', 'sqlite');
  assert.match(result.statement, /"postal" TEXT/);
  assert.match(result.statement, /"empty" TEXT/);
});

test('accepts a header-only parsed CSV', () => {
  const result = createCsvSchemaDdl(parsed(['id'], []), 'items', 'postgres');
  assert.match(result.statement, /"id" TEXT/);
});

test('validates JSON request shape, dialect, and identifiers', () => {
  assert.equal(validateCsvSchemaDdlInput({ csv: 'id\n1', table: 'items' }).dialect, 'postgres');
  for (const body of [null, [], { csv: 'id\n1', table: 'items', execute: true }, { csv: '', table: 'items' }, { csv: 'id\n1', table: 'items', dialect: 'oracle' }, { csv: 'id\n1', table: 'bad\nname' }]) {
    assert.throws(() => validateCsvSchemaDdlInput(body), CsvSchemaDdlError);
  }
});

test('enforces character, row, and column bounds', () => {
  assert.throws(() => validateCsvSchemaDdlInput({ csv: 'x'.repeat(CSV_SCHEMA_DDL_MAX_INPUT_CHARS + 1), table: 't' }), (error) => error instanceof CsvSchemaDdlError && error.status === 413);
  const columns = Array.from({ length: CSV_SCHEMA_DDL_MAX_COLUMNS + 1 }, (_, index) => `c${index}`);
  assert.throws(() => createCsvSchemaDdl(parsed(columns, []), 't', 'postgres'), (error) => error instanceof CsvSchemaDdlError && error.status === 413);
  const rows = Array.from({ length: CSV_SCHEMA_DDL_MAX_ROWS + 1 }, () => ({ id: '1' }));
  assert.throws(() => createCsvSchemaDdl(parsed(['id'], rows), 't', 'postgres'), (error) => error instanceof CsvSchemaDdlError && error.status === 413);
});

test('rejects malicious row shapes and control characters in identifiers', () => {
  assert.throws(() => createCsvSchemaDdl(parsed(['id'], [{ id: 1 }]), 't', 'postgres'), /invalid value/);
  assert.throws(() => createCsvSchemaDdl(parsed(['bad\x00name'], [{ 'bad\x00name': 'x' }]), 't', 'postgres'), /control characters/);
});
