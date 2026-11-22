// solve.js — a fast drop-in for make.fun's own csv-reader 1.0.0 (v3).
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
// Speed (v2 locally took ~230 ms of run() on the practice set and 1,430,000
// us live; the reference takes ~704 ms locally and 1,380,000 us live). The
// work is reshaped to cut the per-field native calls, which dominate:
//   1. One regex finds the next special character (comma, quote, CR, LF) in
//      a field, where four indexOf calls ran before: a single regex exec
//      costs about a third of the four scans it replaces (measured on the
//      practice set: 76 ms against 229 ms for the same steps).
//   2. A record whose line holds no quote and no stray CR is one native
//      replaceAll(',', '","') plus its wrapping quotes; its field count
//      falls out of the lengths for free (each comma adds two characters to
//      the row), so no split and no count pass runs.
//   3. The closing-quote scan fuses the doubled-quote check, so a quoted
//      field whose content holds no doubling and no carriage return or line
//      feed is one slice; only the fields that actually hold one are walked
//      span by span, and the walk finds its next special with one regex
//      exec instead of three scans.
//   4. Fields are collected per record and joined once natively, and rows
//      are joined once natively: the answer is flattened twice in total,
//      never once per field.
// No state is kept between calls, no clock, no randomness: two runs on the
// same input are byte-identical.

/** Control characters other than CR and LF: never in a generated text. Tab is
 * one of them: a raw tab inside a JSON string is invalid, so it belongs here
 * (LF is handled by the parser's own escaping checks, CR never survives into
 * a field value). */
const CONTROL_RE = /[\x00-\x09\x0b\x0c\x0e-\x1f]/;

/** The next special character inside an unquoted field: comma, quote, CR
 * or LF. One exec replaces four indexOf scans. `lastIndex` is set before
 * every call; single-threaded use only. */
const NEXT_SPECIAL = /[",\n\r]/g;

/** The next special inside a quoted field's content: a doubled quote, a CR
 * or a LF. One exec replaces three indexOf scans. */
const NEXT_QUOTED_SPECIAL = /""|\r|\n/g;

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, as a JSON string. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;

  // Cold fallback: a backslash or any other control character in the text
  // means no field is provably escape-free, so the slow value-based reader
  // runs and JSON.stringify escapes every field. The generator never emits
  // those characters.
  if (text.indexOf('\\') !== -1 || CONTROL_RE.test(text)) {
    return runUnsafe(text, header);
  }

  const len = text.length;
  const rowsParts = []; // one JSON array string per record, after the header
  const errParts = []; // one JSON object string per error, in the order met
  let colsJSON = null; // the first record's JSON array, once it is read
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null: the header), and that index as a JSON literal for its errors.
  let recordLine = 1;
  let rowStr = 'null';

  // Appends one error object to errParts. `tail` is the extra member for a
  // short_row (,"fields":N) or a long_row (,"extra":[...]), else ''.
  function pushError(code, tail) {
    errParts.push('{"code":"' + code + '","line":' + recordLine + ',"row":' + rowStr + tail + '}');
  }

  // The JSON array of a record's field values: one native join, which copies
  // every field once and adds no allocation per field. The values are the
  // fields' JSON-escaped contents (a quote in a value is already \", a line
  // break already \n), so the join's separators supply their quotes.
  function recordJSON(fv) {
    return '["' + fv.join('","') + '"]';
  }

  // Reads unquoted characters from pos onto `value` up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field's escaped content and how it ended; `added` counts the value
  // characters appended. Only the rare paths use it (junk after a closing
  // quote, the re-read after a quote that never closes, a stray CR inside an
  // otherwise plain field); the common unquoted field is read inline in the
  // record loop below.
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      NEXT_SPECIAL.lastIndex = pos;
      const m = NEXT_SPECIAL.exec(text);
      const sp = m === null ? len : m.index;
      const ch = m === null ? -1 : text.charCodeAt(sp);
      value += text.slice(pos, sp);
      added += sp - pos;
      if (ch === 44) {
        pos = sp + 1;
        return { value, ended: COMMA, added };
      }
      if (ch === 10) {
        pos = sp + 1;
        line += 1;
        return { value, ended: LINE, added };
      }
      if (ch === -1) {
        pos = len;
        return { value, ended: END, added };
      }
      if (ch === 34) {
        value += '\\"';
        added += 1;
        pos = sp + 1;
        continue;
      }
      // A CR: a CRLF ends the field, a lone one is dropped (stray_cr).
      if (text.charCodeAt(sp + 1) === 10) {
        pos = sp + 2;
        line += 1;
        return { value, ended: LINE, added };
      }
      pushError('stray_cr', '');
      pos = sp + 1;
    }
    return { value, ended: END, added };
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
      pushError('short_row', ',"fields":' + fv.length);
      while (fv.length < width) fv.push('');
    } else if (fv.length > width) {
      const extra = fv.slice(width);
      pushError('long_row', ',"extra":' + recordJSON(extra));
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
    rowStr = header && colsJSON === null ? 'null' : String(rowsParts.length);

    // Fast path: the record is one clean line — no quote and no stray CR
    // before its line break — so its fields are one native replaceAll. A
    // CRLF's CR sits just before the line feed and is not part of the line.
    const nl = text.indexOf('\n', pos);
    let segEnd = nl === -1 ? len : nl;
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const qPos = text.indexOf('"', pos);
    const rPos = text.indexOf('\r', pos);
    if ((qPos === -1 || qPos >= segEnd) && (rPos === -1 || rPos >= segEnd)) {
      const seg = text.slice(pos, segEnd);
      const row = '["' + seg.replaceAll(',', '","') + '"]';
      // Each comma becomes '","', two characters longer, and the wrapping
      // quotes add four: the field count falls out of the lengths.
      const nfields = (row.length - seg.length - 4) / 2 + 1;
      if (nl === -1) {
        pos = len;
      } else {
        pos = nl + 1;
        line += 1;
      }
      if (width < 0) width = nfields;
      if (header && colsJSON === null) {
        colsJSON = row;
        continue;
      }
      if (nfields < width) {
        pushError('short_row', ',"fields":' + nfields);
        const padded = row.slice(0, -1) + ',""'.repeat(width - nfields) + ']';
        rowsParts.push(padded);
      } else if (nfields > width) {
        const parts = seg.split(',');
        const extra = parts.slice(width);
        pushError('long_row', ',"extra":["' + extra.join('","') + '"]');
        rowsParts.push('["' + parts.slice(0, width).join('","') + '"]');
      } else {
        rowsParts.push(row);
      }
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
        // The closing quote is the next quote that is not doubled.
        let scan = pos + 1;
        let closed = -1;
        let doubled = false;
        for (;;) {
          const nextQuote = text.indexOf('"', scan);
          if (nextQuote === -1) break;
          if (text.charCodeAt(nextQuote + 1) === 34) {
            doubled = true;
            scan = nextQuote + 2;
            continue;
          }
          closed = nextQuote;
          break;
        }
        if (closed === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pushError('unterminated_quote', '');
          pos = open + 1;
          const field = readUnquoted('\\"');
          fv.push(field.value);
          ended = field.ended;
        } else {
          const lfPos = text.indexOf('\n', open + 1);
          const hasLF = lfPos !== -1 && lfPos < closed;
          const crPos = text.indexOf('\r', open + 1);
          const hasCR = crPos !== -1 && crPos < closed;
          let value;
          if (!doubled && !hasLF && !hasCR) {
            value = text.slice(open + 1, closed);
          } else {
            // Walk the specials in order, emitting spans around them: a
            // doubled quote becomes one escaped quote, each CRLF or lone CR
            // becomes an escaped line feed (and moves the line counter on).
            value = '';
            let cur = open + 1;
            for (;;) {
              NEXT_QUOTED_SPECIAL.lastIndex = cur;
              const m = NEXT_QUOTED_SPECIAL.exec(text);
              const sp = m === null ? closed : m.index;
              if (sp >= closed) break;
              value += text.slice(cur, sp);
              if (m[0] === '""') {
                value += '\\"';
                cur = sp + 2;
              } else if (m[0] === '\r') {
                value += '\\n';
                line += 1;
                cur = text.charCodeAt(sp + 1) === 10 ? sp + 2 : sp + 1;
              } else {
                value += '\\n';
                line += 1;
                cur = sp + 1;
              }
            }
            value += text.slice(cur, closed);
          }
          pos = closed + 1;
          if (pos >= len) {
            fv.push(value);
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fv.push(value);
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fv.push(value);
              ended = LINE;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fv.push(value);
              ended = LINE;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const field = readUnquoted(value);
              if (field.added > 0) pushError('quote_junk', '');
              fv.push(field.value);
              ended = field.ended;
            }
          }
        }
      } else {
        lastQuoted = false;
        // An unquoted field ends at the nearest comma or line break. One
        // regex exec finds it (and any quote or stray CR on the way); the
        // span before it holds no special, so it is one slice.
        NEXT_SPECIAL.lastIndex = pos;
        const m = NEXT_SPECIAL.exec(text);
        const sp = m === null ? len : m.index;
        const ch = m === null ? -1 : text.charCodeAt(sp);
        if (ch === 44) {
          fv.push(text.slice(pos, sp));
          pos = sp + 1;
          ended = COMMA;
        } else if (ch === 10) {
          fv.push(text.slice(pos, sp));
          pos = sp + 1;
          line += 1;
          ended = LINE;
        } else if (ch === -1) {
          fv.push(text.slice(pos, sp));
          pos = len;
          ended = END;
        } else if (ch === 13 && text.charCodeAt(sp + 1) === 10) {
          // A CRLF ends the field at the CR.
          fv.push(text.slice(pos, sp));
          pos = sp + 2;
          line += 1;
          ended = LINE;
        } else {
          // A quote in the field is literal, a lone CR is stray: the
          // careful reader takes the field from here.
          const field = readUnquoted('');
          fv.push(field.value);
          ended = field.ended;
        }
      }
    }
    finishRecord(fv, lastQuoted);
  }

  const cols = colsJSON === null ? (header ? '[]' : 'null') : colsJSON;
  return '{"columns":' + cols + ',"rows":[' + rowsParts.join(',') + '],"errors":[' + errParts.join(',') + ']}';
}

/** csv-reader 1.0.0's answer for one case's input, as a value. */
export function runValue(input) {
  return JSON.parse(run(input));
}

// Slow but plainly correct value-based reader, used only when the text holds
// a backslash or another control character, so no field is emitted raw with
// a character JSON forbids. JSON.stringify escapes every field at the end.
function runUnsafe(text, header) {
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;

  function readUnquoted(start, recordLine, rowIndex) {
    let value = start;
    let added = 0;
    let how = END;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        how = COMMA;
        break;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        how = LINE;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          how = LINE;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: rowIndex });
        pos += 1;
        continue;
      }
      let end = pos;
      while (end < len) {
        const d = text.charCodeAt(end);
        if (d === 44 || d === 10 || d === 13) break;
        end += 1;
      }
      value += text.slice(pos, end);
      added += end - pos;
      pos = end;
    }
    return [value, how, added];
  }

  while (true) {
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

    const recordLine = line;
    const rowIndex = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = COMMA;
    while (ended === COMMA) {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        let scan = pos + 1;
        let closed = -1;
        for (;;) {
          const q = text.indexOf('"', scan);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            scan = q + 2;
            continue;
          }
          closed = q;
          break;
        }
        if (closed === -1) {
          errors.push({ code: 'unterminated_quote', line: recordLine, row: rowIndex });
          pos = open + 1;
          const read = readUnquoted('"', recordLine, rowIndex);
          fields.push(read[0]);
          ended = read[1];
        } else {
          let value = '';
          for (let i = open + 1; i < closed; i++) {
            const ch = text.charCodeAt(i);
            if (ch === 34 && text.charCodeAt(i + 1) === 34) {
              value += '"';
              i += 1;
            } else if (ch === 13) {
              value += '\n';
              line += 1;
              if (text.charCodeAt(i + 1) === 10) i += 1;
            } else if (ch === 10) {
              value += '\n';
              line += 1;
            } else {
              value += text[i];
            }
          }
          pos = closed + 1;
          if (pos >= len) {
            fields.push(value);
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              fields.push(value);
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              fields.push(value);
              ended = LINE;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              fields.push(value);
              ended = LINE;
            } else {
              const read = readUnquoted(value, recordLine, rowIndex);
              if (read[2] > 0) {
                errors.push({ code: 'quote_junk', line: recordLine, row: rowIndex });
              }
              fields.push(read[0]);
              ended = read[1];
            }
          }
        }
      } else {
        lastQuoted = false;
        const read = readUnquoted('', recordLine, rowIndex);
        fields.push(read[0]);
        ended = read[1];
      }
    }

    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: rowIndex, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      errors.push({ code: 'long_row', line: recordLine, row: rowIndex, extra });
      fields.length = width;
    }
    rows.push(fields);
  }

  return JSON.stringify({
    columns: header ? (columns === null ? [] : columns) : null,
    rows,
    errors,
  });
}
