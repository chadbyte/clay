// Read only explicit image output references; never open provider paths/URIs.
var MAX_BYTES = 6 * 1024 * 1024;
var MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
function create(getRuntime, push) {
  var seen = new Set();
  return async function(item) {
    var ref = item && item.outputRef;
    if (!item || item.status !== "completed" || !ref || MEDIA_TYPES.indexOf(ref.mediaType) < 0) return;
    var key = JSON.stringify([item.itemId, ref.id]);
    if (seen.has(key)) return;
    seen.add(key);
    var runtime = getRuntime();
    runtime.check();
    var event = { yokeType: "generated_image", toolId: item.itemId + ":image", blockId: item.itemId,
      mediaType: ref.mediaType, prompt: "", savedPath: null, transparentBackground: null,
      status: "completed", isError: false, data: "" };
    try {
      if (ref.availability !== "available" || typeof ref.id !== "string" || !ref.id || !Number.isSafeInteger(ref.byteLen) || ref.byteLen <= 0 || ref.byteLen > MAX_BYTES) throw new Error("Muse image artifact is unavailable or exceeds the 6 MiB output limit");
      var result = await runtime.waitRequest(runtime.connection.request("item/readOutput", {
        sessionId: runtime.session.sessionId, itemId: item.itemId, outputRef: ref.id, offsetBytes: 0, lengthBytes: MAX_BYTES,
      }));
      runtime.check();
      if (result.encoding !== "base64" || result.mediaType !== ref.mediaType || result.offsetBytes !== 0 || result.eof !== true || result.byteLen !== ref.byteLen || typeof result.content !== "string" || result.content.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.content)) throw new Error("Muse returned an incomplete or invalid image artifact");
      var bytes = Buffer.from(result.content, "base64");
      if (bytes.length !== ref.byteLen || bytes.toString("base64") !== result.content) throw new Error("Muse image artifact byte length does not match its reference");
      event.data = result.content;
    } catch (error) {
      runtime.check();
      event.isError = true;
      event.status = "failed";
      push({ yokeType: "informational", level: "warning", content: error.message || "Muse image artifact could not be read" });
    }
    push(event);
  };
}
module.exports = { create: create };
