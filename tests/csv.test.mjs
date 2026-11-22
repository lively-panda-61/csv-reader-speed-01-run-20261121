// Unit tests for solve.js run(input) — expectations hand-computed from the
// csv-reader 1.0.0 policy (competition.yaml / RULES.txt): BOM drop, LF/CRLF
// record ends, blank lines are no records, lone CR outside quotes is dropped
// (stray_cr), quoted fields, doubled quotes, CR/CRLF inside quotes read as
// LF, junk after a closing quote (quote_junk), a quote that never closes is
// literal and the rest re-reads as unquoted (unterminated_quote), quotes
// inside unquoted fields are literal, fields stay strings, short_row pads /
// long_row cuts to the first record's width, errors are {code, line, row} in
// the order met.
//
// run() returns the answer as a JSON string (the entry emits JSON while it
// parses, so no separate stringify pass runs); the tests parse it back and
// compare values, exactly as the scorer does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../solve.js';

/** The answer value of one case, parsed back from run()'s JSON string. */
const got = (input) => JSON.parse(run(input));

const cases = [
  {
    name: 'simple with header',
    input: { text: 'a,b,c\n1,2,3\n', header: true },
    expected: { columns: ['a', 'b', 'c'], rows: [['1', '2', '3']], errors: [] },
  },
  {
    name: 'header false keeps first record as a row, columns null',
    input: { text: 'a,b,c\n1,2,3\n', header: false },
    expected: { columns: null, rows: [['a', 'b', 'c'], ['1', '2', '3']], errors: [] },
  },
  {
    name: 'BOM at the very start is dropped',
    input: { text: '\uFEFFa,b\n1,2\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'BOM alone: header true gives empty columns',
    input: { text: '\uFEFF', header: true },
    expected: { columns: [], rows: [], errors: [] },
  },
  {
    name: 'empty text, header true',
    input: { text: '', header: true },
    expected: { columns: [], rows: [], errors: [] },
  },
  {
    name: 'empty text, header false',
    input: { text: '', header: false },
    expected: { columns: null, rows: [], errors: [] },
  },
  {
    name: 'blank LF and CRLF lines are no records',
    input: { text: 'a,b\n\n\r\n1,2\n\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'CRLF record ends',
    input: { text: 'a,b\r\n1,2\r\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'lone CR inside an unquoted field is dropped, stray_cr on the header',
    input: { text: 'a\rb,c\n1,2\n', header: true },
    expected: {
      columns: ['ab', 'c'],
      rows: [['1', '2']],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'short row pads with empty strings and records its field count',
    input: { text: 'a,b,c\n1,2\n', header: true },
    expected: {
      columns: ['a', 'b', 'c'],
      rows: [['1', '2', '']],
      errors: [{ code: 'short_row', line: 2, row: 0, fields: 2 }],
    },
  },
  {
    name: 'long row is cut and records the cut fields',
    input: { text: 'a,b\n1,2,3,4\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [['1', '2']],
      errors: [{ code: 'long_row', line: 2, row: 0, extra: ['3', '4'] }],
    },
  },
  {
    name: 'header row never gets a short/long error',
    input: { text: 'a,b\n1\n2,3,4\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [['1', ''], ['2', '3']],
      errors: [
        { code: 'short_row', line: 2, row: 0, fields: 1 },
        { code: 'long_row', line: 3, row: 1, extra: ['4'] },
      ],
    },
  },
  {
    name: 'quoted field holding a comma',
    input: { text: 'a,b\n"x,y",2\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['x,y', '2']], errors: [] },
  },
  {
    name: 'doubled quote inside a quoted field is one quote',
    input: { text: '"a""b",2\n', header: false },
    expected: { columns: null, rows: [['a"b', '2']], errors: [] },
  },
  {
    name: 'LF inside quotes is kept and counts as a line for later errors',
    input: { text: '"a\nb",2\n3\n', header: false },
    expected: {
      columns: null,
      rows: [['a\nb', '2'], ['3', '']],
      errors: [{ code: 'short_row', line: 3, row: 1, fields: 1 }],
    },
  },
  {
    name: 'CRLF inside quotes is read as LF',
    input: { text: '"a\r\nb",2\n', header: false },
    expected: { columns: null, rows: [['a\nb', '2']], errors: [] },
  },
  {
    name: 'lone CR inside quotes is read as LF',
    input: { text: '"a\rb",2\n', header: false },
    expected: { columns: null, rows: [['a\nb', '2']], errors: [] },
  },
  {
    name: 'junk after the closing quote is appended, quote_junk when the field ends',
    input: { text: '"a"x,2\n', header: false },
    expected: {
      columns: null,
      rows: [['ax', '2']],
      errors: [{ code: 'quote_junk', line: 1, row: 0 }],
    },
  },
  {
    name: 'a quote inside the junk is a literal character',
    input: { text: '"a"x"y,2\n', header: false },
    expected: {
      columns: null,
      rows: [['ax"y', '2']],
      errors: [{ code: 'quote_junk', line: 1, row: 0 }],
    },
  },
  {
    name: 'stray_cr inside the junk comes before quote_junk',
    input: { text: '"a"x\ry,2\n', header: false },
    expected: {
      columns: null,
      rows: [['axy', '2']],
      errors: [
        { code: 'stray_cr', line: 1, row: 0 },
        { code: 'quote_junk', line: 1, row: 0 },
      ],
    },
  },
  {
    name: 'a quote that never closes is literal and the rest re-reads as unquoted',
    input: { text: '"a,b\n1,2\n', header: false },
    expected: {
      columns: null,
      rows: [['"a', 'b'], ['1', '2']],
      errors: [{ code: 'unterminated_quote', line: 1, row: 0 }],
    },
  },
  {
    name: 'unterminated quote at end of text',
    input: { text: '"ab', header: false },
    expected: {
      columns: null,
      rows: [['"ab']],
      errors: [{ code: 'unterminated_quote', line: 1, row: 0 }],
    },
  },
  {
    name: 'quote inside an unquoted field is literal',
    input: { text: 'a"b,c\n', header: false },
    expected: { columns: null, rows: [['a"b', 'c']], errors: [] },
  },
  {
    name: 'a quoted empty field is a record, an unquoted empty line is not',
    input: { text: '""\n', header: false },
    expected: { columns: null, rows: [['']], errors: [] },
  },
  {
    name: 'a line holding only stray CRs is no record but keeps its errors',
    input: { text: 'a,b\n\r\r\n1,2\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [['1', '2']],
      // The first CR is lone (stray_cr); the second CR with the LF is the
      // line break itself, so there is exactly one error.
      errors: [{ code: 'stray_cr', line: 2, row: 0 }],
    },
  },
  {
    name: 'no trailing line break: the last record still counts',
    input: { text: 'a,b\n1,2', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'fields are never trimmed or converted',
    input: { text: '  x  ,007,1.0\n', header: false },
    expected: { columns: null, rows: [['  x  ', '007', '1.0']], errors: [] },
  },
  {
    name: 'empty fields stay empty strings',
    input: { text: ',,\n', header: false },
    expected: { columns: null, rows: [['', '', '']], errors: [] },
  },
  {
    name: 'quoted field then end of text right after the closing quote',
    input: { text: '"a"', header: false },
    expected: { columns: null, rows: [['a']], errors: [] },
  },
  {
    name: 'lone CR after a closing quote is a stray_cr, no junk when nothing follows',
    input: { text: '"a"\r', header: false },
    expected: {
      columns: null,
      rows: [['a']],
      errors: [{ code: 'stray_cr', line: 1, row: 0 }],
    },
  },
  {
    name: 'CRLF after a closing quote ends the record',
    input: { text: 'h\r\n"a"\r\n', header: true },
    expected: { columns: ['h'], rows: [['a']], errors: [] },
  },
  {
    name: 'stray_cr and short_row on the same record, in the order met',
    input: { text: 'a,b,c\n1\rd,2\n', header: true },
    expected: {
      columns: ['a', 'b', 'c'],
      rows: [['1d', '2', '']],
      errors: [
        { code: 'stray_cr', line: 2, row: 0 },
        { code: 'short_row', line: 2, row: 0, fields: 2 },
      ],
    },
  },
  {
    name: 'a lone CR as the whole text is no record',
    input: { text: '\r', header: false },
    expected: {
      columns: null,
      rows: [],
      errors: [{ code: 'stray_cr', line: 1, row: 0 }],
    },
  },
  {
    name: 'only line breaks: no records at all',
    input: { text: '\n\n', header: false },
    expected: { columns: null, rows: [], errors: [] },
  },
  {
    name: 'non-ASCII fields are kept as they stand',
    input: { text: 'Zürich,東京\n', header: false },
    expected: { columns: null, rows: [['Zürich', '東京']], errors: [] },
  },
  {
    name: 'unterminated quote rewinds the line count to the opening line',
    input: { text: '"a\nb,c\n1,2\n', header: false },
    expected: {
      columns: null,
      // The quote never closes, so the text after it re-reads as unquoted:
      // field 1 is '"a', the LF ends record 1 (width 1); 'b,c' and '1,2'
      // then each lose their second field to long_row.
      rows: [['"a'], ['b'], ['1']],
      errors: [
        { code: 'unterminated_quote', line: 1, row: 0 },
        { code: 'long_row', line: 2, row: 1, extra: ['c'] },
        { code: 'long_row', line: 3, row: 2, extra: ['2'] },
      ],
    },
  },
  {
    name: 'backslash in a field is kept and escaped in the JSON output',
    input: { text: 'a\\b,c\n', header: false },
    expected: { columns: null, rows: [['a\\b', 'c']], errors: [] },
  },
  {
    name: 'tab inside a field is kept and escaped in the JSON output',
    input: { text: 'a\tb,c\n', header: false },
    expected: { columns: null, rows: [['a\tb', 'c']], errors: [] },
  },
  {
    name: 'a quoted field holding a backslash and a newline',
    input: { text: '"a\\b\nc",2\n', header: false },
    expected: { columns: null, rows: [['a\\b\nc', '2']], errors: [] },
  },
];

for (const c of cases) {
  test(c.name, () => {
    assert.deepEqual(got(c.input), c.expected);
  });
}

test('two runs on the same input are byte-identical', () => {
  const input = { text: '"a\nb",2\r\n3,4\n"unterminated', header: true };
  assert.equal(run(input), run(input));
});

test('run keeps no state between calls', () => {
  const first = got({ text: 'a,b\n1,2,3\n', header: true });
  const second = got({ text: 'x\n', header: false });
  assert.deepEqual(first, {
    columns: ['a', 'b'],
    rows: [['1', '2']],
    errors: [{ code: 'long_row', line: 2, row: 0, extra: ['3'] }],
  });
  assert.deepEqual(second, { columns: null, rows: [['x']], errors: [] });
});

test('the returned JSON parses to the same value the scorer compares', () => {
  // The scorer reads answers.json and compares values; run()'s string must
  // be valid JSON whose parsed form is the answer.
  const input = { text: 'a,b\n"x\ny",2\n', header: true };
  const s = run(input);
  assert.equal(typeof s, 'string');
  assert.deepEqual(JSON.parse(s), {
    columns: ['a', 'b'],
    rows: [['x\ny', '2']],
    errors: [],
  });
});
