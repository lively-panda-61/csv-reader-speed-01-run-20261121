// solve.js — a fast drop-in for make.fun's own csv-reader 1.0.0.
//
// run(input) returns csv-reader's answer {columns, rows, errors} for one
// case's input {text, header}, following its written broken-row policy:
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
// Speed: the reference walks the text one character at a time and builds
// every field by concatenation. This reader jumps instead. A record whose
// line holds no quote and no stray CR — the overwhelming majority — is split
// whole with one native split(','). Anything else is read field by field,
// each field found with indexOf and taken as one slice, so a quoted field's
// content is copied once and normalized only when it actually holds a
// doubled quote or a carriage return. No state is kept between calls, no
// clock, no randomness: two runs on the same input are byte-identical.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Read by scanUnquoted for its error records.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field starting at pos, appending its characters onto
  // `value`: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept. Used for plain
  // unquoted fields that hold a lone CR, for the junk after a closing quote,
  // and for the re-read after a quote that never closes.
  function scanUnquoted(value) {
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
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
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
    let lines = 0;
    let i = content.indexOf('\n');
    while (i !== -1) {
      lines += 1;
      i = content.indexOf('\n', i + 1);
    }
    i = content.indexOf('\r');
    while (i !== -1) {
      if (content.charCodeAt(i + 1) !== 10) lines += 1;
      i = content.indexOf('\r', i + 1);
    }
    line += lines;
    if (content.indexOf('""') !== -1) content = content.replaceAll('""', '"');
    if (content.indexOf('\r') !== -1) {
      content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    }
    return content;
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
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record is one clean line — no quote and no stray CR
    // before its line break — so its fields are the line split on commas.
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

    // Slow path: read the record field by field.
    const fields = [];
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
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const field = scanUnquoted('"');
          fields.push(field.value);
          ended = field.ended;
        } else {
          let value = text.slice(open + 1, closed);
          if (value.indexOf('"') !== -1 || value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
            value = normalizeQuoted(value);
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
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const field = scanUnquoted(value);
              if (field.added > 0) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              fields.push(field.value);
              ended = field.ended;
            }
          }
        }
      } else {
        lastQuoted = false;
        // An unquoted field ends at the nearest comma or line break. A CR
        // before that end is a stray one — except the CR of a CRLF line
        // break — and the field is then read by the full unquoted scan.
        // Checking the sliced field for a CR, rather than scanning the
        // whole rest of the text for one, keeps this branch short: a stray
        // CR can sit far past the field's end in an LF file.
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
        const value = text.slice(pos, crlf ? end - 1 : end);
        if (value.indexOf('\r') !== -1) {
          const field = scanUnquoted('');
          fields.push(field.value);
          ended = field.ended;
        } else {
          fields.push(value);
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
    finishRecord(fields, lastQuoted);
  }

  // Settles one record's fields: the first record sets the width and, when
  // header is true, becomes the columns; later records are padded or cut to
  // that width. A line that held only stray CRs leaves one empty unquoted
  // field and is no record (its stray_cr errors stay).
  function finishRecord(fields, lastQuoted) {
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
