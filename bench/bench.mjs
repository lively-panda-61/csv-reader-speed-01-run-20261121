// Benchmark + practice-set verification.
// Usage: node bench/bench.mjs [--rounds N]
// Loads the kit's practice set, checks this repo's solve.js against
// expected.json with the scorer's canonical comparison, and reports CPU
// timings for the whole pipeline the harness times (read + parse the cases,
// run all cases, serialize the answers array, write the file), with
// process.cpuUsage(), 9 timed rounds after 1 warm-up, trimmed mean dropping
// the 2 fastest and 2 slowest — the same trimming the harness applies.
// Compares: mine (run() returns a JSON string, rope-joined), v2 (run()
// returns a JSON string, answers.join), and the reference csv-reader 1.0.0
// (object + JSON.stringify, exactly like its main.ts). The v2 code and the
// reference are imported from outside this repo (dev-only, not part of the
// entry).
import { readFileSync, writeFileSync } from 'node:fs';

const KIT = new URL(
  '../../csv-reader-speed-01-run-20261121-kit/',
  import.meta.url,
).pathname;
const V2 = new URL('../../repo2/', import.meta.url).pathname;
const { run } = await import('../solve.js');
const { run: runV2 } = await import(`${V2}solve.js`);
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

const rawCases = readFileSync(`${KIT}practice/input/cases.json`, 'utf8');
const cases = JSON.parse(rawCases);
const expected = JSON.parse(
  readFileSync(`${KIT}practice/reference/expected.json`, 'utf8'),
);
const wantById = new Map(expected.cases.map((c) => [c.id, c.output]));

// Correctness first: every case must match the reference answer as a value.
for (const c of cases) {
  const have = JSON.parse(run(c.input));
  if (canonical(have) !== canonical(wantById.get(c.id))) {
    console.error(`MISMATCH on practice case ${c.id}`);
    process.exit(1);
  }
}
console.log(`practice set: ${cases.length}/6 cases match expected.json`);

const rounds = Number(process.argv[2]?.replace('--rounds=', '')) || 9;

function trimmedMean(values) {
  const s = [...values].sort((a, b) => a - b);
  const core = s.slice(2, s.length - 2);
  return core.reduce((a, b) => a + b, 0) / core.length;
}

function cpuMs(fn) {
  const start = process.cpuUsage();
  fn();
  const d = process.cpuUsage(start);
  return (d.user + d.system) / 1000;
}

// Whole pipeline the harness times: read + parse + run + serialize + write.
function pipelineV3() {
  const cs = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
  let out = '[';
  for (let i = 0; i < cs.length; i++) {
    if (i > 0) out += ',';
    out += run(cs[i].input);
  }
  out += ']';
  writeFileSync('/tmp/bench-v3.json', out);
}
function pipelineV2() {
  const cs = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
  const answers = [];
  for (const c of cs) answers.push(runV2(c.input));
  writeFileSync('/tmp/bench-v2.json', '[' + answers.join(',') + ']');
}
function pipelineRef() {
  const cs = JSON.parse(readFileSync(`${KIT}practice/input/cases.json`, 'utf8'));
  const answers = [];
  for (const c of cs) answers.push(readCsv(c.input));
  writeFileSync('/tmp/bench-ref.json', JSON.stringify(answers));
}
// run() only, on the already-parsed cases.
function runOnly(fn) {
  for (const c of cases) fn(c.input);
}

function measure(label, fn) {
  fn(); // warm-up (untimed, like the harness)
  const ts = [];
  for (let r = 0; r < rounds; r++) ts.push(cpuMs(fn));
  const tm = trimmedMean(ts);
  console.log(`${label}: trimmed mean ${tm.toFixed(1)} ms | rounds: ${ts.map((x) => x.toFixed(0)).join(', ')}`);
  return tm;
}

console.log(`-- ${rounds} timed rounds after 1 warm-up, CPU ms, trimmed mean (drop 2 fastest + 2 slowest) --`);
const tV3 = measure('v3 pipeline ', pipelineV3);
const tV2 = measure('v2 pipeline ', pipelineV2);
const tRef = measure('ref pipeline', pipelineRef);
const rV3 = measure('v3 run-only ', () => runOnly(run));
const rV2 = measure('v2 run-only ', () => runOnly(runV2));
const rRef = measure('ref run-only', () => runOnly(readCsv));
console.log(`v3 vs v2 pipeline: ${(tV2 / tV3).toFixed(2)}x | v3 vs ref pipeline: ${(tRef / tV3).toFixed(2)}x`);
console.log(`v3 vs v2 run-only: ${(rV2 / rV3).toFixed(2)}x | v3 vs ref run-only: ${(rRef / rV3).toFixed(2)}x`);
