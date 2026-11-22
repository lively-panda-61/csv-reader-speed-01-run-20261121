// Practice-set check: run() on the kit's practice set must match the
// reference answers in practice/reference/expected.json, compared as JSON
// values exactly as the scorer does. Run with:
// node --test tests/practice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const KIT = new URL(
  '../../csv-reader-speed-01-run-20261121-kit/',
  import.meta.url,
).pathname;
const { run } = await import('../solve.js');

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const cases = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(
  readFileSync(`${KIT}practice/reference/expected.json`, 'utf8'),
);
const wantById = new Map(expected.cases.map((c) => [c.id, c.output]));

test('practice set matches the reference answers byte-for-byte as values', () => {
  assert.equal(cases.length, expected.cases.length);
  for (const c of cases) {
    const want = wantById.get(c.id);
    assert.ok(want, `no expected answer for ${c.id}`);
    const have = JSON.parse(run(c.input));
    assert.equal(canonical(have), canonical(want), `case ${c.id} differs`);
  }
});

test('practice answers are deterministic across two runs', () => {
  for (const c of cases) {
    assert.equal(run(c.input), run(c.input), `case ${c.id} not deterministic`);
  }
});
