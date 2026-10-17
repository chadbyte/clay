var CONVERSATION_CAP = 6000;

// SDK text is persisted as delta before onTurnDone; the response preview
// is only a notification excerpt. Historical complete text entries remain readable.
function isDigestEntry(entry) {
  return entry && (entry.type === "user_message" || entry.type === "assistant_message" || entry.type === "delta" || entry.type === "text");
}

function copyCursor(cursor) {
  return {
    historyIndex: Math.max(0, cursor.historyIndex || 0),
    textOffset: Math.max(0, cursor.textOffset || 0),
  };
}

function readState(history) {
  var state = { cursor: { historyIndex: 0, textOffset: 0 } };
  for (var i = history.length - 1; i >= 0; i--) {
    var entry = history[i];
    if (!entry || entry.type !== "digest_checkpoint") continue;
    if (entry.cursor && typeof entry.cursor.historyIndex === "number") {
      state.cursor = copyCursor(entry.cursor);
    } else if (typeof entry.digestedIndex === "number") {
      // Legacy checkpoints pointed at the next history entry and had no
      // within-entry progress. Treat them as fully consumed entries.
      state.cursor = { historyIndex: Math.max(0, entry.digestedIndex), textOffset: 0 };
    }
    break;
  }
  return state;
}

function readCursor(history) {
  return readState(history).cursor;
}

function sameCursor(left, right) {
  return left.historyIndex === right.historyIndex && left.textOffset === right.textOffset;
}

function safeTextEnd(text, start, maximum) {
  var end = Math.min(text.length, start + maximum);
  if (end < text.length && end > start) {
    var previous = text.charCodeAt(end - 1);
    if (previous >= 0xD800 && previous <= 0xDBFF) end--;
  }
  // The normal cap leaves enough room for a code point. Keep this fallback
  // defensive so a future smaller cap cannot make the cursor stall.
  if (end === start && end < text.length) {
    end = start + (text.charCodeAt(start) >= 0xD800 && text.charCodeAt(start) <= 0xDBFF ? 2 : 1);
  }
  return Math.min(end, text.length);
}

function collectChunk(history, startCursor) {
  var cursor = copyCursor(startCursor);
  var parts = [];
  var totalLength = 0;
  var hadHistoryProgress = false;
  var partCount = 0;

  function appendPart(value) {
    var separatorLength = partCount > 0 ? 1 : 0;
    if (totalLength + separatorLength + value.length > CONVERSATION_CAP) return false;
    parts.push(value);
    totalLength += separatorLength + value.length;
    partCount++;
    return true;
  }

  while (cursor.historyIndex < history.length) {
    var entry = history[cursor.historyIndex];
    if (!isDigestEntry(entry) || typeof entry.text !== "string" || !entry.text) {
      cursor.historyIndex++;
      cursor.textOffset = 0;
      hadHistoryProgress = true;
      continue;
    }

    var text = entry.text;
    var offset = Math.min(cursor.textOffset, text.length);

    var label = entry.type === "user_message" ? "User: " : "Mate: ";
    var available = CONVERSATION_CAP - totalLength - (partCount > 0 ? 1 : 0) - label.length;
    if (available <= 0 && partCount > 0) break;
    if (available <= 0) available = CONVERSATION_CAP - label.length;

    if (offset < text.length) {
      var end = safeTextEnd(text, offset, available);
      var value = label + text.substring(offset, end);
      if (!appendPart(value)) break;
      cursor.textOffset = end;
      hadHistoryProgress = true;
      if (end < text.length) break;
    }

    cursor.historyIndex++;
    cursor.textOffset = 0;
  }

  return {
    conversationContent: parts.join("\n"),
    cursor: cursor,
    hasHistoryProgress: hadHistoryProgress,
  };
}

function hasPending(history, cursor) {
  var probe = collectChunk(history, cursor, "");
  return !!probe.conversationContent;
}

module.exports = {
  CONVERSATION_CAP: CONVERSATION_CAP,
  collectChunk: collectChunk,
  hasPending: hasPending,
  readCursor: readCursor,
  readState: readState,
  sameCursor: sameCursor,
};
