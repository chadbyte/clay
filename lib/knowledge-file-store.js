var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var MAX_CONTENT_BYTES = 2 * 1024 * 1024;
var RESERVED = { "session-digests.jsonl": true, "sticky-notes.md": true, "memory-summary.md": true };

function revision(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function validName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && path.basename(value) === value &&
    !/[\x00-\x1f\x7f]/.test(value) && /\.(md|jsonl)$/.test(value) && !RESERVED[value];
}

function createKnowledgeFileStore(cwd) {
  var directory = path.join(cwd, "knowledge");
  function ensureDirectory(create) {
    var stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { if (!create || error.code !== "ENOENT") throw error; fs.mkdirSync(directory, { recursive: true }); stat = fs.lstatSync(directory); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Knowledge directory is not a safe directory.");
  }
  function filePath(name) { if (!validName(name)) throw new Error("Invalid knowledge file name."); return path.join(directory, name); }
  function existing(name) {
    var target = filePath(name); var stat;
    try { stat = fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Knowledge file is not a safe regular file.");
    var content = fs.readFileSync(target, "utf8");
    return { name: name, content: content, revision: revision(content), size: stat.size, mtime: stat.mtimeMs };
  }
  function list() {
    try { ensureDirectory(false); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    var names = fs.readdirSync(directory); var out = [];
    for (var i = 0; i < names.length; i++) {
      if (!validName(names[i])) continue;
      var item; try { item = existing(names[i]); } catch (error) { continue; }
      if (item) out.push({ name: item.name, size: item.size, mtime: item.mtime, revision: item.revision, writable: item.name.endsWith(".md") });
    }
    return out.sort(function (a, b) { return b.mtime - a.mtime || a.name.localeCompare(b.name); });
  }
  function read(name) { ensureDirectory(false); var item = existing(name); if (!item) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" }); return item; }
  function assertExpected(current, expected) {
    if (!current && expected) throw Object.assign(new Error("This document was removed since it was opened."), { code: "STALE", currentRevision: null });
    if (current && (!expected || expected !== current.revision)) throw Object.assign(new Error("This document changed since it was opened."), { code: "STALE", currentRevision: current.revision });
  }
  function save(name, content, expectedRevision) {
    if (!validName(name) || !name.endsWith(".md")) throw new Error("Only valid Markdown documents can be edited.");
    if (typeof content !== "string") throw new Error("Knowledge content is required.");
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("Knowledge document is too large.");
    ensureDirectory(true); var current = existing(name); assertExpected(current, expectedRevision);
    var target = filePath(name); var temporary = path.join(directory, ".clay-knowledge-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"));
    try { fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, target); }
    finally { try { fs.unlinkSync(temporary); } catch (error) { /* renamed or already removed */ } }
    return read(name);
  }
  function rename(from, to, expectedRevision) {
    if (!validName(to) || !to.endsWith(".md")) throw new Error("Only valid Markdown documents can be renamed.");
    if (!validName(from) || !from.endsWith(".md")) throw Object.assign(new Error("This Knowledge source is read only."), { code: "READ_ONLY" });
    ensureDirectory(false); var current = existing(from); if (!current) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" });
    assertExpected(current, expectedRevision); if (existing(to)) throw Object.assign(new Error("A document with that name already exists."), { code: "EXISTS" });
    fs.renameSync(filePath(from), filePath(to)); return read(to);
  }
  function remove(name, expectedRevision) {
    if (!validName(name) || !name.endsWith(".md")) throw Object.assign(new Error("This Knowledge source is read only."), { code: "READ_ONLY" });
    ensureDirectory(false); var current = existing(name); if (!current) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" });
    assertExpected(current, expectedRevision); fs.unlinkSync(filePath(name)); return current;
  }
  return { list: list, read: read, save: save, rename: rename, remove: remove };
}

module.exports = { createKnowledgeFileStore: createKnowledgeFileStore, revision: revision, validName: validName };
