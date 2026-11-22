// Differential fuzz test: random CSV-ish inputs must read exactly as the
// reference csv-reader 1.0.0 reads them. The reference is imported from the
// kit (dev-only: it is NOT part of the entry, and no kit file is copied into
// the repository). run() returns the answer as a JSON string; the test parses
// it back and compares values, exactly as the scorer does. Run with:
// node --test tests/fuzz.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The kit's reference implementation, resolved relative to this repo's place
// in the workspace (../../csv-reader-speed-01-run-20261121-kit/).
const { readCsv } = await import(
  new URL(
    '../../csv-reader-speed-01-run-20261121-kit/baselines/csv-reader/vendor/csv-reader/index.js',
    import.meta.url,
  ).href
);
const { run } = await import('../solve.js');

/** Two JSON values are equal when their canonical forms (keys sorted) match. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The answer value of one case, parsed back from run()'s JSON string. */
const got = (input) => JSON.parse(run(input));

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'a', 'b', 'ab', 'x', '1', '007', ' ', '  ', 'café', 'Zürich', '',
  ',', '"', '""', '"a"', '\n', '\r', '\r\n', 'x"y', '"a', 'a"', 'kg', '!',
  '\uFEFF', 'a,b', '"a,b"', '"a\nb"', '"a\rb"', '"a\r\nb"', 'a\rb', 'a\rb\n',
  'a\\b', 'a\tb', '\\', '\t', 'x\\', '"\\"', 'back\\slash',
];

function randomText(r, maxPieces) {
  const n = 1 + Math.floor(r() * maxPieces);
  let s = '';
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(r() * PIECES.length)];
  return s;
}

function randomStructured(r) {
  // Records built from random fields, some quoted, some broken.
  const width = 1 + Math.floor(r() * 5);
  const lines = [];
  const records = 1 + Math.floor(r() * 12);
  for (let i = 0; i < records; i++) {
    const fields = [];
    const n = Math.max(0, width + Math.floor(r() * 3) - 1);
    for (let j = 0; j < n; j++) {
      const v = PIECES[Math.floor(r() * 10)];
      const style = r();
      if (style < 0.3) fields.push(`"${v.replaceAll('"', '""')}"`);
      else if (style < 0.35) fields.push(`"${v}"junk`);
      else if (style < 0.4) fields.push(`"${v}`);
      else fields.push(v);
    }
    lines.push(fields.join(','));
    if (r() < 0.1) lines.push('');
  }
  const eol = r() < 0.5 ? '\n' : '\r\n';
  let text = lines.join(eol);
  if (r() < 0.3) text = '\uFEFF' + text;
  if (r() < 0.3) text += eol;
  return text;
}

test('fuzz: random token soup matches the reference', () => {
  const r = rng(20261122);
  for (let i = 0; i < 5000; i++) {
    const text = randomText(r, 40);
    const header = r() < 0.5;
    const input = { text, header };
    assert.equal(
      canonical(got(input)),
      canonical(readCsv(input)),
      `mismatch on case ${i}: ${JSON.stringify(input)}`,
    );
  }
});

test('fuzz: random structured records match the reference', () => {
  const r = rng(31337);
  for (let i = 0; i < 4000; i++) {
    const text = randomStructured(r);
    const header = r() < 0.5;
    const input = { text, header };
    assert.equal(
      canonical(got(input)),
      canonical(readCsv(input)),
      `mismatch on structured case ${i}: ${JSON.stringify(input)}`,
    );
  }
});

test('fuzz: long token soup matches the reference', () => {
  const r = rng(90210);
  for (let i = 0; i < 500; i++) {
    const text = randomText(r, 600);
    const header = r() < 0.5;
    const input = { text, header };
    assert.equal(
      canonical(got(input)),
      canonical(readCsv(input)),
      `mismatch on long case ${i}`,
    );
  }
});

test('fuzz: every run() output is valid JSON on its own', () => {
  // The entry's answers.json is built from run()'s strings; each one must
  // parse, so a bad escape can never corrupt the whole file.
  const r = rng(555);
  for (let i = 0; i < 1000; i++) {
    const text = randomText(r, 60);
    const s = run({ text, header: r() < 0.5 });
    assert.doesNotThrow(() => JSON.parse(s), `run() returned invalid JSON on case ${i}: ${s.slice(0, 200)}`);
  }
});
