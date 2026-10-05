// Pure helpers for the Network settings editor. Mirrors lib/network-origins.js
// closely enough to compare spellings; the server remains the authority.

export function normalizeOriginForCompare(value) {
  if (typeof value !== 'string' || value.indexOf('*') !== -1 ||
      !/^https?:\/\/[^\s/?#\\]+\/?$/i.test(value)) return null;
  try {
    var url = new URL(value);
    if (url.username || url.password) return null;
    return url.origin;
  } catch (e) {
    return null;
  }
}

// Returns trimmed non-empty entries plus the 1-based textarea line of each.
export function parseOriginDraft(draft) {
  var origins = [];
  var lines = [];
  var rows = String(draft || '').split('\n');
  for (var i = 0; i < rows.length; i++) {
    var value = rows[i].trim();
    if (!value) continue;
    origins.push(value);
    lines.push(i + 1);
  }
  return { origins: origins, lines: lines };
}

function normalizedSet(values) {
  var set = {};
  for (var i = 0; i < values.length; i++) {
    var origin = normalizeOriginForCompare(values[i]);
    if (origin) set[origin] = true;
  }
  return set;
}

// Returns the page's normalized origin when the saved list allowed it and the
// next list does not; otherwise null. Equivalent spellings count as kept.
export function removesCurrentOrigin(savedText, nextOrigins, currentOrigin) {
  var current = normalizeOriginForCompare(currentOrigin);
  if (!current) return null;
  if (!normalizedSet(parseOriginDraft(savedText).origins)[current]) return null;
  if (normalizedSet(nextOrigins)[current]) return null;
  return current;
}

// Turns stored-entry problems into a status message using textarea line numbers.
export function describeInvalidEntries(invalid) {
  if (!Array.isArray(invalid) || !invalid.length) return '';
  var first = invalid[0];
  var message = 'Line ' + (first.index + 1) + ' ' + first.reason;
  if (invalid.length > 1) message += ' ' + (invalid.length - 1) + ' more line(s) also need correction.';
  return message + ' Invalid lines are ignored until corrected.';
}
