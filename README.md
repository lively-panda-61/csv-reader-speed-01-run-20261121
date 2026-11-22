# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/lively-panda-61/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/lively-panda-61/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: it reads broken CSV files
exactly as the reference does — BOM drop, LF/CRLF record ends, blank lines
skipped, lone CRs dropped (`stray_cr`), quoted fields with doubled quotes and
line breaks inside them, junk after a closing quote (`quote_junk`), quotes
that never close (`unterminated_quote`), short rows padded and long rows cut
(`short_row` / `long_row`) — about 2.9x faster than the reference on the
whole pipeline and 3.6x faster in the reader itself, emitting JSON while it
parses, with no object tree and no `JSON.stringify` pass.

## How it is fast

- One regex finds the next special character (comma, quote, CR, LF) in a
  field, where four `indexOf` scans ran before: a single regex exec costs
  about a third of the four scans it replaces on the practice set.
- A record whose line holds no quote and no stray CR is one native
  `replaceAll(',', '","')` plus its wrapping quotes; its field count falls
  out of the lengths for free, so no split and no count pass runs.
- The closing-quote scan fuses the doubled-quote check, so a quoted field
  whose content holds no doubling and no carriage return or line feed is one
  slice; only the fields that actually hold one are walked span by span.
- Fields are collected per record and joined once natively, and rows are
  joined once natively: the answer is flattened twice in total, never once
  per field.

Measured on the kit's practice set (6 cases, 10.2 MB of CSV), trimmed mean
over 9 timed rounds after 1 warm-up, CPU time: v3 194–198 ms of `run()` and
342–398 ms for the whole pipeline, against v2's 218–248 ms / 396–444 ms and
the reference's 704–730 ms / 1003–1159 ms — about 1.2x faster than v2 and
2.9x faster than the reference on the pipeline.

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`)
and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR`). Tests and the
benchmark live in `tests/` and `bench/`:

```sh
node --test tests/
node bench/bench.mjs
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=q85rcyn4&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
