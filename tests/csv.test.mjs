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
    name: 'only newlines',
    input: { text: '\n\n\n', header: true },
    expected: { columns: [], rows: [], errors: [] },
  },
  {
    name: 'CRLF record ends',
    input: { text: 'a,b\r\n1,2\r\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'no trailing newline',
    input: { text: 'a,b\n1,2', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'blank lines skipped',
    input: { text: 'a,b\n\n1,2\n\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'short row pads with empty strings',
    input: { text: 'a,b,c\n1,2\n', header: true },
    expected: {
      columns: ['a', 'b', 'c'],
      rows: [['1', '2', '']],
      errors: [{ code: 'short_row', line: 2, row: 0, fields: 2 }],
    },
  },
  {
    name: 'long row cuts, extra listed',
    input: { text: 'a,b\n1,2,3\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [['1', '2']],
      errors: [{ code: 'long_row', line: 2, row: 0, extra: ['3'] }],
    },
  },
  {
    name: 'header row defines the width, later rows pad',
    input: { text: 'a,b,c\n1,2\n3,4,5\n', header: true },
    expected: {
      columns: ['a', 'b', 'c'],
      rows: [
        ['1', '2', ''],
        ['3', '4', '5'],
      ],
      errors: [{ code: 'short_row', line: 2, row: 0, fields: 2 }],
    },
  },
  {
    name: 'width from first record when header false',
    input: { text: 'a,b,c\n1,2\n', header: false },
    expected: {
      columns: null,
      rows: [
        ['a', 'b', 'c'],
        ['1', '2', ''],
      ],
      errors: [{ code: 'short_row', line: 2, row: 1, fields: 2 }],
    },
  },
  {
    name: 'quoted field with a comma inside',
    input: { text: '"a,b",c\n1,2\n', header: true },
    expected: { columns: ['a,b', 'c'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'doubled quotes become one quote',
    input: { text: '"a""b",c\n', header: true },
    expected: { columns: ['a"b', 'c'], rows: [], errors: [] },
  },
  {
    name: 'LF inside a quoted field stays, read as LF',
    input: { text: '"a\nb",c\n1,2\n', header: true },
    expected: { columns: ['a\nb', 'c'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'CRLF inside a quoted field reads as LF',
    input: { text: '"a\r\nb",c\n1,2\n', header: true },
    expected: { columns: ['a\nb', 'c'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'lone CR inside a quoted field reads as LF',
    input: { text: '"a\rb",c\n1,2\n', header: true },
    expected: { columns: ['a\nb', 'c'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'junk after a closing quote is appended, quote_junk',
    input: { text: '"a"junk,b\n1,2\n', header: true },
    expected: {
      columns: ['ajunk', 'b'],
      rows: [['1', '2']],
      errors: [{ code: 'quote_junk', line: 1, row: null }],
    },
  },
  {
    name: 'no junk after a closing quote, no error',
    input: { text: '"a",b\n', header: true },
    expected: { columns: ['a', 'b'], rows: [], errors: [] },
  },
  {
    name: 'unterminated quote is literal, rest re-read as unquoted',
    input: { text: '"a,b\n1,2\n', header: true },
    expected: {
      columns: ['"a', 'b'],
      rows: [['1', '2']],
      errors: [{ code: 'unterminated_quote', line: 1, row: null }],
    },
  },
  {
    name: 'quote inside an unquoted field is literal',
    input: { text: 'a"b,c\n', header: true },
    expected: { columns: ['a"b', 'c'], rows: [], errors: [] },
  },
  {
    name: 'stray CR outside quotes is dropped',
    input: { text: 'a\rb,c\n1,2\n', header: true },
    expected: {
      columns: ['ab', 'c'],
      rows: [['1', '2']],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'stray CR at the end of the text',
    input: { text: 'a,b\r', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'lone CR alone is no record, error stays',
    input: { text: '\r', header: true },
    expected: {
      columns: [],
      rows: [],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'empty quoted field is a real field',
    input: { text: '"",b\n', header: true },
    expected: { columns: ['', 'b'], rows: [], errors: [] },
  },
  {
    name: 'fields keep their spaces, never trimmed',
    input: { text: ' a , b \n', header: true },
    expected: { columns: [' a ', ' b '], rows: [], errors: [] },
  },
  {
    name: 'numbers stay strings',
    input: { text: '1,2.5\n', header: true },
    expected: { columns: ['1', '2.5'], rows: [], errors: [] },
  },
  {
    name: 'trailing comma means a trailing empty field',
    input: { text: 'a,b,\n1,2,\n', header: true },
    expected: { columns: ['a', 'b', ''], rows: [['1', '2', '']], errors: [] },
  },
  {
    name: 'leading comma means a leading empty field',
    input: { text: ',a\n,1\n', header: true },
    expected: { columns: ['', 'a'], rows: [['', '1']], errors: [] },
  },
  {
    name: 'quoted empty field plus junk',
    input: { text: '""junk\n', header: true },
    expected: {
      columns: ['junk'],
      rows: [],
      errors: [{ code: 'quote_junk', line: 1, row: null }],
    },
  },
  {
    name: 'quote at end of text never closes',
    input: { text: 'a,"b', header: true },
    expected: {
      columns: ['a', '"b'],
      rows: [],
      errors: [{ code: 'unterminated_quote', line: 1, row: null }],
    },
  },
  {
    name: 'backslash in a field (unsafe path) stays one backslash',
    input: { text: 'a\\b,c\n', header: true },
    expected: { columns: ['a\\b', 'c'], rows: [], errors: [] },
  },
  {
    name: 'tab in a field stays a tab',
    input: { text: 'a\tb,c\n', header: true },
    expected: { columns: ['a\tb', 'c'], rows: [], errors: [] },
  },
  {
    name: 'unicode stays as-is',
    input: { text: 'café,Zürich\n', header: true },
    expected: { columns: ['café', 'Zürich'], rows: [], errors: [] },
  },
  {
    name: 'errors come in the order met',
    input: { text: 'a,b\n1\n2,3,4\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [
        ['1', ''],
        ['2', '3'],
      ],
      errors: [
        { code: 'short_row', line: 2, row: 0, fields: 1 },
        { code: 'long_row', line: 3, row: 1, extra: ['4'] },
      ],
    },
  },
  {
    name: 'record line counts LF inside quotes',
    input: { text: '"x\ny",b\n1\n', header: true },
    expected: {
      columns: ['x\ny', 'b'],
      rows: [['1', '']],
      errors: [{ code: 'short_row', line: 3, row: 0, fields: 1 }],
    },
  },
  {
    name: 'CRLF inside quotes counts once for the line',
    input: { text: '"x\r\ny",b\n1\n', header: true },
    expected: {
      columns: ['x\ny', 'b'],
      rows: [['1', '']],
      errors: [{ code: 'short_row', line: 3, row: 0, fields: 1 }],
    },
  },
  {
    name: 'lone CR inside quotes counts for the line',
    input: { text: '"x\ry",b\n1\n', header: true },
    expected: {
      columns: ['x\ny', 'b'],
      rows: [['1', '']],
      errors: [{ code: 'short_row', line: 3, row: 0, fields: 1 }],
    },
  },
  {
    name: 'stray CR does not move the line counter',
    input: { text: 'a\rb\n1\n', header: true },
    expected: {
      columns: ['ab'],
      rows: [['1']],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'two stray CRs give two errors',
    input: { text: 'a\rb\rc\n', header: true },
    expected: {
      columns: ['abc'],
      rows: [],
      errors: [
        { code: 'stray_cr', line: 1, row: null },
        { code: 'stray_cr', line: 1, row: null },
      ],
    },
  },
  {
    name: 'stray CR at the start of the text',
    input: { text: '\ra,b\n', header: true },
    expected: {
      columns: ['a', 'b'],
      rows: [],
      errors: [{ code: 'stray_cr', line: 1, row: null }],
    },
  },
  {
    name: 'header defines width even when it is one field',
    input: { text: 'a\n1,2\n', header: true },
    expected: {
      columns: ['a'],
      rows: [['1']],
      errors: [{ code: 'long_row', line: 2, row: 0, extra: ['2'] }],
    },
  },
  {
    name: 'two quoted fields',
    input: { text: '"a","b"\n"1","2"\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
  {
    name: 'CRLF blank lines skipped',
    input: { text: 'a,b\r\n\r\n1,2\r\n', header: true },
    expected: { columns: ['a', 'b'], rows: [['1', '2']], errors: [] },
  },
];

for (const c of cases) {
  test(c.name, () => {
    assert.deepEqual(got(c.input), c.expected);
  });
}
