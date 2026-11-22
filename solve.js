// solve.js — a fast drop-in for make.fun's own csv-reader 1.0.0 (v2).
//
// run(input) returns the JSON string of csv-reader's answer {columns, rows,
// errors} for one case's input {text, header}, following its written
// broken-row policy:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote and each CRLF or lone CR inside it read
//     as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character, and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row
//     or long_row when it ends: line the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row its record's
//     index in rows, null for the header.
//
// runValue(input) returns the same answer as a value, for callers that want
// the object instead of its JSON string.
//
// Speed (v1 locally took ~160-600 ms of run() and ~265 ms of JSON.stringify
// on the practice set, and 1.92 s live against the 1.38 s baseline):
//   1. The scanner is one flat loop with no per-field function calls. A
//      record whose line holds no quote and no stray CR is split whole with
//      one native split(','); anything else is read field by field, each
//      field found with indexOf and taken as one slice, so a quoted field's
//      content is copied once and normalized only when it actually holds a
//      doubled quote or a carriage return.
//   2. The answer is emitted as JSON while it is parsed, with no object
//      tree and no JSON.stringify pass: each record's fields are collected
//      as raw values and written with a single native join('","'), which
//      copies every field once and adds no allocation per field. A field
//      that needs JSON escaping (a quote or a line break in it) is
//      pre-escaped in place with replaceAll, so the join never sees a raw
//      special character. A per-case pre-check falls back to JSON.stringify
//      for every field when the text holds a backslash or any other control
//      character (the generator never emits those, so the fallback is cold).
// No state is kept between calls, no clock, no randomness: two runs on the
// same input are byte-identical.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE = 1;
const END = 2;

/** Control characters other than CR and LF: never in a generated text. Tab is
 * one of them: a raw tab inside a JSON string is invalid, so it belongs here
 * (LF is handled by the parser's own escaping checks, CR never survives into
 * a field value). */
const CONTROL_RE = /[\x00-\x09\x0b\x0c\x0e-\x1f]/;

/** csv-reader 1.0.0's answer for one case's input, as a JSON string. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  // Cold fallback: a backslash or any other control character in the text
  // means no field is provably escape-free, so every field is escaped with
  // JSON.stringify at the end. The generator never emits those characters.
  const unsafe = text.indexOf('\\') !== -1 || CONTROL_RE.test(text);

  const rowsParts = []; // one JSON array string per record, after the header
  const errParts = []; // one JSON object string per error, in the order met
  let colsJSON = null; // the first record's JSON array, once it is read
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, its index in rows (null:
  // the header), and that index as a JSON literal for its error records.
  let recordLine = 1;
  let recordRow = null;
  let rowStr = 'null';

  // Pre-escapes a field value for the join trick below: a quote becomes \"
  // and a line break becomes \n, so the value can sit bare between the
  // quotes the join supplies. Skipped when unsafe (the fallback escapes it
  // instead, and pre-escaping first would double-escape it).
  function escapeValue(value) {
    if (unsafe) return value;
    if (value.indexOf('"') !== -1) value = value.replaceAll('"', '\\"');
    if (value.indexOf('\n') !== -1) value = value.replaceAll('\n', '\\n');
    return value;
  }

  // The JSON array of a record's field values: one native join, which copies
  // every field once and adds no allocation per field. The values are raw
  // (or pre-escaped, see escapeValue), so the join's separators supply their
  // quotes. When unsafe, every field is escaped with JSON.stringify instead.
  function recordJSON(fv) {
    if (unsafe) return '[' + fv.map((f) => JSON.stringify(f)).join(',') + ']';
    return '["' + fv.join('","') + '"]';
  }

  // Reads unquoted characters onto `startValue` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept. Only the rare
  // paths use it (junk after a closing quote, the re-read after a quote that
  // never closes, a stray CR inside an otherwise plain field); the common
  // unquoted field is read inline in the record loop below.
  function readUnquoted(startValue) {
    let value = startValue;
    let added = 0;
    while (pos < len) {
      const cPos = text.indexOf(',', pos);
      const nPos = text.indexOf('\n', pos);
      const rPos = text.indexOf('\r', pos);
      let end = len;
      let kind = END;
      if (cPos !== -1 && cPos < end) {
        end = cPos;
        kind = COMMA;
      }
      if (nPos !== -1 && nPos < end) {
        end = nPos;
        kind = LINE;
      }
      if (rPos !== -1 && rPos < end) {
        if (text.charCodeAt(rPos + 1) === 10) {
          // CRLF: the field ends at the CR.
          end = rPos;
          kind = LINE;
        } else {
          // Lone CR: dropped, and the field goes on past it.
          value += text.slice(pos, rPos);
          added += rPos - pos;
          errParts.push(`{"code":"stray_cr","line":${recordLine},"row":${rowStr}}`);
          pos = rPos + 1;
          continue;
        }
      }
      value += text.slice(pos, end);
      added += end - pos;
      if (kind === COMMA) {
        pos = end + 1;
      } else if (kind === LINE) {
        pos = text.charCodeAt(end) === 13 ? end + 2 : end + 1;
        line += 1;
      } else {
        pos = len;
      }
      return { value, ended: kind, added };
    }
    return { value, ended: END, added };
  }

  // Normalizes a quoted field's content the way the reference reads it:
  // "" becomes one quote, each CRLF or lone CR becomes LF, and every line
  // break inside it moves the line counter on (a CRLF counts once).
  function normalizeQuoted(content) {
    let breaks = 0;
    let i = content.indexOf('\n');
    while (i !== -1) {
      breaks += 1;
      i = content.indexOf('\n', i + 1);
    }
    i = content.indexOf('\r');
    while (i !== -1) {
      if (content.charCodeAt(i + 1) !== 10) breaks += 1;
      i = content.indexOf('\r', i + 1);
    }
    line += breaks;
    if (content.indexOf('""') !== -1) content = content.replaceAll('""', '"');
    if (content.indexOf('\r') !== -1) {
      content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    }
    return content;
  }

  // Settles one record's field values: the first record sets the width and,
  // when header is true, becomes the columns; later records are padded or
  // cut to that width. A line that held only stray CRs leaves one empty
  // unquoted field and is no record (its stray_cr errors stay).
  function finishRecord(fv, lastQuoted) {
    if (fv.length === 1 && fv[0] === '' && !lastQuoted) return;
    if (width < 0) width = fv.length;
    if (header && colsJSON === null) {
      colsJSON = recordJSON(fv);
      return;
    }
    if (fv.length < width) {
      errParts.push(`{"code":"short_row","line":${recordLine},"row":${rowStr},"fields":${fv.length}}`);
      while (fv.length < width) fv.push('');
    } else if (fv.length > width) {
      const extra = fv.slice(width);
      const extraJSON = unsafe
        ? '[' + extra.map((f) => JSON.stringify(f)).join(',') + ']'
        : '["' + extra.join('","') + '"]';
      errParts.push(`{"code":"long_row","line":${recordLine},"row":${rowStr},"extra":${extraJSON}}`);
      fv.length = width;
    }
    rowsParts.push(recordJSON(fv));
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && colsJSON === null ? null : rowsParts.length;
    rowStr = recordRow === null ? 'null' : String(recordRow);

    // Fast path: the record is one clean line — no quote and no stray CR
    // before its line break — so its fields are the line split on commas.
    // The slice is a view, not a copy; the two scans on it stay inside the
    // line, so a quote far ahead in the text can never slow this check down.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    const segment = text.slice(pos, lineEnd);
    if (segment.indexOf('"') === -1 && segment.indexOf('\r') === -1) {
      const fields = segment.split(',');
      if (nl === -1) {
        pos = len;
      } else {
        pos = nl + 1;
        line += 1;
      }
      finishRecord(fields, false);
      continue;
    }

    // Slow path: read the record field by field, inline (no calls in the
    // hot loop except the rare stray-CR / junk / unterminated paths).
    const fv = [];
    let ended = COMMA;
    let lastQuoted = false;
    while (ended === COMMA) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        // The closing quote is the next quote that is not doubled.
        let scan = pos + 1;
        let closed = -1;
        for (;;) {
          const nextQuote = text.indexOf('"', scan);
          if (nextQuote === -1) break;
          if (text.charCodeAt(nextQuote + 1) === 34) {
            scan = nextQuote + 2;
            continue;
          }
          closed = nextQuote;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errParts.push(`{"code":"unterminated_quote","line":${recordLine},"row":${rowStr}}`);
          const field = readUnquoted('"');
          fv.push(escapeValue(field.value));
          ended = field.ended;
        } else {
          const raw = text.slice(open + 1, closed);
          const value =
            raw.indexOf('"') !== -1 || raw.indexOf('\r') !== -1 || raw.indexOf('\n') !== -1
              ? normalizeQuoted(raw)
              : raw;
          pos = closed + 1;
          if (pos >= len) {
            fv.push(escapeValue(value));
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fv.push(escapeValue(value));
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fv.push(escapeValue(value));
              ended = LINE;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fv.push(escapeValue(value));
              ended = LINE;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const field = readUnquoted(value);
              if (field.added > 0) {
                errParts.push(`{"code":"quote_junk","line":${recordLine},"row":${rowStr}}`);
              }
              fv.push(escapeValue(field.value));
              ended = field.ended;
            }
          }
        }
      } else {
        lastQuoted = false;
        // An unquoted field ends at the nearest comma or line break. It
        // holds no line break by construction and no CR unless a stray one
        // sits in it (rare: the slice check sends that case to the careful
        // reader); a quote in it is literal and is pre-escaped.
        const cPos = text.indexOf(',', pos);
        const nPos = text.indexOf('\n', pos);
        let end = len;
        let kind = END;
        if (cPos !== -1 && (nPos === -1 || cPos < nPos)) {
          end = cPos;
          kind = COMMA;
        } else if (nPos !== -1) {
          end = nPos;
          kind = LINE;
        }
        const crlf = kind === LINE && end > pos && text.charCodeAt(end - 1) === 13;
        let value = text.slice(pos, crlf ? end - 1 : end);
        if (value.indexOf('\r') !== -1) {
          const field = readUnquoted('');
          fv.push(escapeValue(field.value));
          ended = field.ended;
        } else {
          if (!unsafe && value.indexOf('"') !== -1) value = value.replaceAll('"', '\\"');
          fv.push(value);
          if (kind === COMMA) {
            pos = end + 1;
          } else if (kind === LINE) {
            pos = end + 1;
            line += 1;
          } else {
            pos = len;
          }
          ended = kind;
        }
      }
    }
    finishRecord(fv, lastQuoted);
  }

  const cols = colsJSON === null ? (header ? '[]' : 'null') : colsJSON;
  return `{"columns":${cols},"rows":[${rowsParts.join(',')}],"errors":[${errParts.join(',')}]}`;
}

/** csv-reader 1.0.0's answer for one case's input, as a value. */
export function runValue(input) {
  return JSON.parse(run(input));
}
