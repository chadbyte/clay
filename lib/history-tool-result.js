var MAX_INLINE_BYTES = 16 * 1024;
var PREVIEW_CHARS = 1000;

function preview(entry) {
  if (!entry || entry.type !== "tool_result" || typeof entry.id !== "string") return entry;
  var content = typeof entry.content === "string" ? entry.content : "";
  var size = Buffer.byteLength(content);
  for (var image of Array.isArray(entry.images) ? entry.images : []) {
    if (image && typeof image.data === "string") size += image.data.length;
  }
  if (size <= MAX_INLINE_BYTES) return entry;
  var visible = content.replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g, "");
  var stub = Object.assign({}, entry, { content: visible.slice(0, PREVIEW_CHARS), deferredHistoryResult: true });
  delete stub.images;
  return stub;
}

function read(session, request) {
  if (!session || !session.sessionOriginId || request.sessionOriginId !== session.sessionOriginId ||
    request.sessionId !== session.localId || !Number.isSafeInteger(request.index) || request.index < 0) return null;
  var entry = session.history[request.index];
  if (!entry || entry.type !== "tool_result" || entry.id !== request.toolId) return null;
  return { content: typeof entry.content === "string" ? entry.content : "",
    images: Array.isArray(entry.images) ? entry.images : [] };
}

module.exports = { preview: preview, read: read };
