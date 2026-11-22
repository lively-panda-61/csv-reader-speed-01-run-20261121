// Benchmark + practice-set verification.
// Usage: node bench/bench.mjs [--rounds N]
// Loads the kit's practice set, runs this repo's solve.js and the reference
// csv-reader 1.0.0 on every case, checks each answer against expected.json
// with the scorer's canonical comparison, and reports CPU timings.
// The reference is imported from the kit (dev-only, not part of the entry).
import { readFileSync } from 'node:fs';

const KIT = new URL(
  '../../csv-reader-speed-01-run-20261121-kit/',
  import.meta.url,
).pathname;
const { run } = await import('../solve.js');
const { readCsv } = await import(
  `${KIT}baselines/csv-reader/vendor/csv-reader/index.js`
);

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const rounds = Number(process.argv.find((a) => a.startsWith('--rounds='))?.split('=')[1] ?? 3);
const cases = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}practice/reference/expected.json`, 'utf8'));
const byId = new Map(expected.cases.map((c) => [c.id, c.output]));

const totalChars = cases.reduce((n, c) => n + c.input.text.length, 0);
console.log(`[bench] ${cases.length} practice cases, ${totalChars.toLocaleString('en-US')} chars total`);

function time(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const t1 = process.hrtime.bigint();
  return { out, ms: Number(t1 - t0) / 1e6 };
}

// Correctness first, once.
let passed = 0;
for (const c of cases) {
  const got = run(c.input);
  const ok = canonical(got) === canonical(byId.get(c.id));
  console.log(`[bench] ${c.id}: ${ok ? 'PASS' : 'FAIL'} (${c.input.text.length.toLocaleString('en-US')} chars, header=${c.input.header})`);
  if (ok) passed += 1;
}
console.log(`[bench] correctness: ${passed}/${cases.length} cases identical to the oracle`);

// Timing: repeat the whole set, mine vs the reference.
const mine = [];
const ref = [];
for (let r = 0; r < rounds; r++) {
  mine.push(time(() => cases.map((c) => run(c.input))).ms);
  ref.push(time(() => cases.map((c) => readCsv(c.input))).ms);
  console.log(`[bench] round ${r + 1}: mine ${mine[r].toFixed(1)} ms, reference ${ref[r].toFixed(1)} ms`);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const best = (a) => Math.min(...a);
console.log(`[bench] mean: mine ${mean(mine).toFixed(1)} ms, reference ${mean(ref).toFixed(1)} ms`);
console.log(`[bench] best: mine ${best(mine).toFixed(1)} ms, reference ${best(ref).toFixed(1)} ms`);
console.log(`[bench] speedup over csv-reader: ${(mean(ref) / mean(mine)).toFixed(2)}x (mean), ${(best(ref) / best(mine)).toFixed(2)}x (best)`);
console.log(`[bench] throughput: ${(totalChars / 1e6 / (mean(mine) / 1000)).toFixed(1)} MB/s mine, ${(totalChars / 1e6 / (mean(ref) / 1000)).toFixed(1)} MB/s reference`);
if (passed !== cases.length) process.exitCode = 1;
