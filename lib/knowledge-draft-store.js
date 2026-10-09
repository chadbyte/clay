var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var MAX_DRAFT_BYTES = 2 * 1024 * 1024;

function safePart(value) { return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24); }
function createKnowledgeDraftStore(baseDir, scopeKey) {
  var root = path.join(baseDir, "knowledge-document-drafts", safePart(scopeKey));
  function safeDirectory(directory, create) {
    var stat;
    try { stat = fs.lstatSync(directory); } catch (error) { if (!create || error.code !== "ENOENT") throw error; fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(directory); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error("Knowledge draft path is not a safe directory."), { code: "UNSAFE_PATH" });
  }
  function userRoot(userId) { return path.join(root, safePart(userId)); }
  function target(userId, documentId) { return path.join(userRoot(userId), safePart(documentId) + ".json"); }
  function read(userId, documentId) {
    try { safeDirectory(root, false); safeDirectory(userRoot(userId), false); var file = target(userId, documentId); var stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DRAFT_BYTES + 4096) throw Object.assign(new Error("Knowledge draft is not a safe file."), { code: "UNSAFE_PATH" });
      var value = JSON.parse(fs.readFileSync(file, "utf8")); return value && value.version === 1 ? value : null; }
    catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
  }
  function save(userId, documentId, draft) {
    var content = draft && draft.content;
    if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_DRAFT_BYTES) throw new Error("Knowledge draft is invalid or too large.");
    var current = read(userId, documentId); var clientVersion = Math.max(0, Number(draft.clientVersion) || 0);
    if (current && Number(current.clientVersion) > clientVersion) return current;
    var value = { version: 1, documentId: String(documentId), name: String(draft.name || "").slice(0, 500), content: content,
      baseRevision: draft.baseRevision || null, cursor: draft.cursor && typeof draft.cursor === "object" ? { line: Number(draft.cursor.line) || 0, ch: Number(draft.cursor.ch) || 0 } : null,
      clientVersion: clientVersion, newDocument: draft.newDocument === true, savedAt: Date.now() };
    safeDirectory(root, true); safeDirectory(userRoot(userId), true); var file = target(userId, documentId);
    var temporary = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(5).toString("hex");
    try { fs.writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch (error) {} }
    return value;
  }
  function remove(userId, documentId, throughVersion) {
    var current = read(userId, documentId); if (!current) return false;
    if (throughVersion != null && Number(current.clientVersion) > Number(throughVersion)) return false;
    try { fs.unlinkSync(target(userId, documentId)); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }
  function list(userId) {
    var folder = userRoot(userId); var names; try { safeDirectory(root, false); safeDirectory(folder, false); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    try { names = fs.readdirSync(folder); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    var values = [];
    for (var i = 0; i < names.length; i++) {
      if (!/^[a-f0-9]{24}\.json$/.test(names[i])) continue;
      try { var file = path.join(folder, names[i]); var stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DRAFT_BYTES + 4096) continue;
        var value = JSON.parse(fs.readFileSync(file, "utf8")); if (value && value.version === 1) values.push(value); } catch (error) {}
    }
    return values.sort(function (a, b) { return b.savedAt - a.savedAt; });
  }
  return { read: read, save: save, remove: remove, list: list };
}

module.exports = { createKnowledgeDraftStore: createKnowledgeDraftStore };
