// Benchmark + practice-set verification.
// Usage: node bench/bench.mjs [--rounds N]
// Loads the kit's practice set, checks this repo's solve.js against
// expected.json with the scorer's canonical comparison, and reports CPU
// timings for the whole pipeline the harness times (run all cases +
// serialize the answers array), with process.cpuUsage(), 9 rounds, trimmed
// mean dropping the 2 fastest and 2 slowest — the same trimming the harness
// applies. Compares: mine (run() returns a JSON string, joined), v1 (run()
// returns an object, one JSON.stringify at the end, exactly like its
// main.ts), and the reference csv-reader 1.0.0 (object + stringify). The v1
// code and the reference are imported from outside this repo (dev-only, not
// part of the entry).
import { readFileSync } from 'node:fs';

const KIT = new URL(
  '../../csv-reader-speed-01-run-20261121-kit/',
  import.meta.url,
).pathname;
const V1 = new URL(
  '../../repo/',
  import.meta.url,
).pathname;
const { run } = await import('../solve.js');
const { run: runV1 } = await import(`${V1}solve.js`);
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

const rounds = Number(process.argv.find((a) => a.startsWith('--rounds='))?.split('=')[1] ?? 9);
const cases = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${KIT}practice/reference/expected.json`, 'utf8'));
const byId = new Map(expected.cases.map((c) => [c.id, c.output]));

const totalChars = cases.reduce((n, c) => n + c.input.text.length, 0);
console.log(`[bench] ${cases.length} practice cases, ${totalChars.toLocaleString('en-US')} chars total`);

// Correctness first, once (run() returns a JSON string; parse it back).
let passed = 0;
for (const c of cases) {
  const ok = canonical(JSON.parse(run(c.input))) === canonical(byId.get(c.id));
  console.log(`[bench] ${c.id}: ${ok ? 'PASS' : 'FAIL'} (${c.input.text.length.toLocaleString('en-US')} chars, header=${c.input.header})`);
  if (ok) passed += 1;
}
console.log(`[bench] correctness: ${passed}/${cases.length} cases identical to the oracle`);

// Timing: the whole pipeline (run all cases + serialize), CPU time.
const inputs = cases.map((c) => c.input);
function cpuMs(fn) {
  const before = process.cpuUsage();
  fn();
  const after = process.cpuUsage(before);
  return (after.user + after.system) / 1000;
}
function mine() {
  const answers = [];
  for (const input of inputs) answers.push(run(input));
  return '[' + answers.join(',') + ']';
}
function v1() {
  const answers = [];
  for (const input of inputs) answers.push(runV1(input));
  return JSON.stringify(answers);
}
function ref() {
  const answers = [];
  for (const input of inputs) answers.push(readCsv(input));
  return JSON.stringify(answers);
}

// Warm-up (JIT + GC settle), untimed.
mine(); v1(); ref();

const mineTimes = [];
const v1Times = [];
const refTimes = [];
for (let r = 0; r < rounds; r++) {
  mineTimes.push(cpuMs(mine));
  v1Times.push(cpuMs(v1));
  refTimes.push(cpuMs(ref));
  console.log(
    `[bench] round ${r + 1}: mine ${mineTimes[r].toFixed(1)} ms, v1 ${v1Times[r].toFixed(1)} ms, ref ${refTimes[r].toFixed(1)} ms`,
  );
}
function trimmedMean(a) {
  const s = [...a].sort((x, y) => x - y);
  const core = s.slice(2, s.length - 2);
  return core.reduce((x, y) => x + y, 0) / core.length;
}
const mMine = trimmedMean(mineTimes);
const mV1 = trimmedMean(v1Times);
const mRef = trimmedMean(refTimes);
console.log(`[bench] trimmed-mean CPU: mine ${mMine.toFixed(1)} ms, v1 ${mV1.toFixed(1)} ms, ref ${mRef.toFixed(1)} ms`);
console.log(`[bench] speedup over csv-reader: ${(mRef / mMine).toFixed(2)}x mine, ${(mRef / mV1).toFixed(2)}x v1`);
console.log(`[bench] throughput: ${(totalChars / 1e6 / (mMine / 1000)).toFixed(1)} MB/s mine, ${(totalChars / 1e6 / (mRef / 1000)).toFixed(1)} MB/s ref`);
// Sanity: the two pipelines must produce identical output.
const a = mine();
const b = v1();
console.log(`[bench] outputs identical: ${a === b} (mine ${a.length} bytes, v1 ${b.length} bytes)`);
if (passed !== cases.length || a !== b) process.exitCode = 1;
