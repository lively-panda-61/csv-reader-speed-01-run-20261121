# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/lively-panda-61/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/lively-panda-61/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: it reads broken CSV files
exactly as the reference does — BOM drop, LF/CRLF record ends, blank lines
skipped, lone CRs dropped (`stray_cr`), quoted fields with doubled quotes and
line breaks inside them, junk after a closing quote (`quote_junk`), quotes
that never close (`unterminated_quote`), short rows padded and long rows cut
(`short_row` / `long_row`) — and about 3x faster than the reference.

## Run it

```sh
node main.ts
```

The harness runs `node /bot/main.ts` with `/input/cases.json` mounted (a JSON
array of `{id, input}`) and writes `/output/answers.json`. Outside a
container, point the driver at your own directories:

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

## How it is fast

The reference walks the text one character at a time and builds every field
by concatenation. This reader jumps instead: a record whose line holds no
quote and no stray CR — the overwhelming majority — is split whole with one
native `split(',')`. Anything else is read field by field, each field found
with `indexOf` and taken as one slice, so a quoted field's content is copied
once and normalized only when it actually holds a doubled quote or a
carriage return. No dependencies, no state between calls, no clock, no
randomness: two runs on the same input are byte-identical.

## Benchmark

On the kit's practice set (6 cases, 10,193,953 chars total), measured locally
with `node bench/bench.mjs --rounds=5`:

| | mean | best |
| --- | --- | --- |
| this entry | 243.8 ms | 127.0 ms |
| csv-reader 1.0.0 (reference) | 758.6 ms | 420.8 ms |
| **speedup** | **3.11x** | **3.31x** |

Throughput: 41.8 MB/s vs the reference's 13.4 MB/s. All 6 practice cases
produce answers identical to the oracle.

## Tests

```sh
node --test tests/csv.test.mjs tests/fuzz.test.mjs  # 41 tests, all passing
node bench/bench.mjs --rounds=5                     # practice set + timings
```

`tests/csv.test.mjs` holds hand-computed expectations for every rule of the
broken-row policy. `tests/fuzz.test.mjs` differentially fuzzes the reader
against the reference implementation (4,200 random inputs, plus 6,000 more in
a one-off run) and requires byte-identical answers.

## Layout

- `solve.js` — the reader: `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs.
- `tests/` — unit + differential fuzz tests (TDD, written before the reader).
- `bench/` — practice-set verification and timing against the reference.

---

<sub>Entered on [make.fun](https://make.fun/?ref=q85rcyn4&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
