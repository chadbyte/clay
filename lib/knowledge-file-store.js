var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var MAX_CONTENT_BYTES = 2 * 1024 * 1024;
var RESERVED = { "session-digests.jsonl": true, "sticky-notes.md": true, "memory-summary.md": true };

function revision(content) { return crypto.createHash("sha256").update(content, "utf8").digest("hex"); }
function cleanName(value) {
  if (typeof value !== "string") return null;
  var name = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!name || name.length > 500 || name[0] === "/" || /[\x00-\x1f\x7f]/.test(name)) return null;
  var parts = name.split("/");
  if (parts.length > 20 || parts.some(function (part) { return !part || part === "." || part === ".." || part.length > 120; })) return null;
  if (!/\.(md|jsonl)$/i.test(name) || RESERVED[name]) return null;
  return parts.join("/");
}
function validName(value) { return cleanName(value) !== null; }
function itemType(name) { return /\.jsonl$/i.test(name) ? "db" : "text"; }
function atomicJson(target, value) {
  var temporary = target + ".tmp-" + process.pid + "-" + crypto.randomBytes(6).toString("hex");
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, target); }
  finally { try { fs.unlinkSync(temporary); } catch (error) {} }
}

function createKnowledgeFileStore(cwd, options) {
  var directory = path.join(cwd, "knowledge");
  var settings = options || {};
  var metaRoot = settings.metaDir || path.join(cwd, ".clay", "knowledge-documents");
  var registryPath = path.join(metaRoot, "documents.json");
  var historyRoot = path.join(metaRoot, "history");
  var fileCache = {};
  function safeDirectory(target, create) {
    var stat;
    try { stat = fs.lstatSync(target); }
    catch (error) { if (!create || error.code !== "ENOENT") throw error; fs.mkdirSync(target, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(target); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error("Knowledge metadata path is not a safe directory."), { code: "UNSAFE_PATH" });
  }
  function ensureMetadata(createHistory) {
    safeDirectory(metaRoot, true);
    var registryStat;
    try { registryStat = fs.lstatSync(registryPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (registryStat && (!registryStat.isFile() || registryStat.isSymbolicLink())) throw Object.assign(new Error("Knowledge metadata registry is not a safe file."), { code: "UNSAFE_PATH" });
    if (createHistory) safeDirectory(historyRoot, true);
    else { try { safeDirectory(historyRoot, false); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
  function ensureDirectory(create) {
    var stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { if (!create || error.code !== "ENOENT") throw error; fs.mkdirSync(directory, { recursive: true }); stat = fs.lstatSync(directory); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Knowledge directory is not a safe directory.");
  }
  function targetPath(name, createParents) {
    var clean = cleanName(name); if (!clean) throw new Error("Invalid knowledge file name."); ensureDirectory(!!createParents);
    var parts = clean.split("/"); var cursor = directory;
    for (var i = 0; i < parts.length - 1; i++) {
      cursor = path.join(cursor, parts[i]); var stat;
      try { stat = fs.lstatSync(cursor); }
      catch (error) { if (!createParents || error.code !== "ENOENT") throw error; fs.mkdirSync(cursor, { mode: 0o700 }); stat = fs.lstatSync(cursor); }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Knowledge path contains an unsafe directory.");
    }
    return path.join(directory, clean);
  }
  function registry() {
    ensureMetadata(false);
    try { var parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")); return parsed && parsed.version === 1 && parsed.documents ? parsed : { version: 1, documents: {} }; }
    catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return { version: 1, documents: {} }; throw error; }
  }
  function writeRegistry(value) { ensureMetadata(false); atomicJson(registryPath, value); }
  function existing(name) {
    var clean = cleanName(name); if (!clean) throw new Error("Invalid knowledge file name."); var target; var stat;
    try { target = targetPath(clean, false); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    try { stat = fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Knowledge file is not a safe regular file.");
    if (stat.size > MAX_CONTENT_BYTES) throw Object.assign(new Error("Knowledge document exceeds the safe read limit."), { code: "TOO_LARGE" });
    var cached = fileCache[clean]; var content;
    if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs && cached.ctime === stat.ctimeMs && cached.ino === stat.ino) content = cached.content;
    else { content = fs.readFileSync(target, "utf8"); fileCache[clean] = { content: content, revision: revision(content), size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino }; }
    cached = fileCache[clean]; return { name: clean, content: content, revision: cached.revision, size: stat.size, mtime: stat.mtimeMs, itemType: itemType(clean) };
  }
  function walk(relative, out) {
    var base = relative ? path.join(directory, relative) : directory; var names = fs.readdirSync(base);
    for (var i = 0; i < names.length; i++) {
      var rel = relative ? relative + "/" + names[i] : names[i]; var stat;
      try { stat = fs.lstatSync(path.join(directory, rel)); } catch (error) { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { walk(rel, out); continue; }
      if (!stat.isFile() || !validName(rel)) continue;
      var item; try { item = existing(rel); } catch (error) {
        if (error.code === "TOO_LARGE") item = { name: rel, content: null, revision: null, size: stat.size, mtime: stat.mtimeMs, itemType: itemType(rel), readError: error.message };
        else continue;
      }
      if (item) out.push(item);
    }
  }
  function reconcileIdentity(items) {
    var data = registry(); var changed = false; var used = {}; var currentNames = {};
    items.forEach(function (item) { currentNames[item.name] = true; });
    Object.keys(data.documents).forEach(function (id) { if (!data.documents[id].deleted) used[data.documents[id].name] = id; });
    for (var i = 0; i < items.length; i++) {
      var id = used[items[i].name];
      if (!id) {
        var candidates = items[i].revision ? Object.keys(data.documents).filter(function (key) { var doc = data.documents[key]; return !currentNames[doc.name] && doc.lastRevision === items[i].revision; }) : [];
        id = candidates.length === 1 ? candidates[0] : crypto.randomUUID(); changed = true;
      }
      if (!data.documents[id] || data.documents[id].name !== items[i].name || data.documents[id].lastRevision !== items[i].revision || data.documents[id].deleted) changed = true;
      data.documents[id] = Object.assign({}, data.documents[id] || {}, { id: id, name: items[i].name,
        lastRevision: items[i].revision || data.documents[id] && data.documents[id].lastRevision || null, deleted: false });
      items[i].id = id; used[items[i].name] = id;
    }
    Object.keys(data.documents).forEach(function (id) {
      var found = items.some(function (item) { return item.id === id; });
      if (!found && !data.documents[id].deleted) { data.documents[id].deleted = true; changed = true; }
    });
    if (changed) writeRegistry(data); return data;
  }
  function list() {
    try { ensureDirectory(false); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    var items = []; walk("", items); reconcileIdentity(items);
    return items.map(function (item) { return { id: item.id, name: item.name, path: item.name, folder: path.posix.dirname(item.name) === "." ? "" : path.posix.dirname(item.name),
      itemType: item.itemType, size: item.size, mtime: item.mtime, revision: item.revision, writable: item.itemType === "text" }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function read(name) {
    ensureDirectory(false); var item = existing(name); if (!item) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" });
    var data = registry(); var id = Object.keys(data.documents).filter(function (key) { return !data.documents[key].deleted && data.documents[key].name === item.name; })[0];
    if (!id) { list(); data = registry(); id = Object.keys(data.documents).filter(function (key) { return !data.documents[key].deleted && data.documents[key].name === item.name; })[0]; }
    return Object.assign(item, { id: id || null });
  }
  function assertExpected(current, expected) {
    if (!current && expected) throw Object.assign(new Error("This document was removed since it was opened."), { code: "STALE", currentRevision: null });
    if (current && (!expected || expected !== current.revision)) throw Object.assign(new Error("This document changed since it was opened."), { code: "STALE", currentRevision: current.revision });
  }
  function snapshot(item, reason) {
    if (!item) return;
    var listed = list(); var identity = listed.filter(function (entry) { return entry.name === item.name; })[0]; if (!identity) return; ensureMetadata(true);
    var folder = path.join(historyRoot, identity.id); safeDirectory(folder, true);
    var target = path.join(folder, Date.now() + "-" + item.revision + ".md");
    fs.writeFileSync(target, item.content, { flag: "wx", mode: 0o600 });
  }
  function save(name, content, expectedRevision) {
    var clean = cleanName(name); if (!clean || itemType(clean) !== "text") throw new Error("Only valid Markdown documents can be edited.");
    if (typeof content !== "string") throw new Error("Knowledge content is required.");
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) throw new Error("Knowledge document is too large.");
    ensureDirectory(true); var current = existing(clean); assertExpected(current, expectedRevision); if (current) snapshot(current, "before-save");
    var target = targetPath(clean, true); var temporary = path.join(path.dirname(target), ".clay-knowledge-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"));
    try { fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 }); fs.renameSync(temporary, target); }
    finally { try { fs.unlinkSync(temporary); } catch (error) {} }
    delete fileCache[clean];
    return read(clean);
  }
  function rename(from, to, expectedRevision) {
    var cleanFrom = cleanName(from); var cleanTo = cleanName(to);
    if (!cleanTo || itemType(cleanTo) !== "text") throw new Error("Only valid Markdown documents can be renamed or moved.");
    if (!cleanFrom || itemType(cleanFrom) !== "text") throw Object.assign(new Error("This Knowledge source is read only."), { code: "READ_ONLY" });
    ensureDirectory(false); var current = existing(cleanFrom); if (!current) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" });
    assertExpected(current, expectedRevision); if (existing(cleanTo)) throw Object.assign(new Error("A document with that path already exists."), { code: "EXISTS" }); snapshot(current, "before-move");
    fs.renameSync(targetPath(cleanFrom, false), targetPath(cleanTo, true));
    delete fileCache[cleanFrom];
    var data = registry(); Object.keys(data.documents).forEach(function (id) { if (data.documents[id].name === cleanFrom && !data.documents[id].deleted) data.documents[id].name = cleanTo; }); writeRegistry(data);
    return read(cleanTo);
  }
  function remove(name, expectedRevision) {
    var clean = cleanName(name); if (!clean || itemType(clean) !== "text") throw Object.assign(new Error("This Knowledge source is read only."), { code: "READ_ONLY" });
    ensureDirectory(false); var current = existing(clean); if (!current) throw Object.assign(new Error("Knowledge file not found."), { code: "ENOENT" });
    assertExpected(current, expectedRevision); snapshot(current, "before-delete"); fs.unlinkSync(targetPath(clean, false)); delete fileCache[clean]; list(); return current;
  }
  function history(id) {
    if (!/^[a-f0-9-]{20,50}$/i.test(String(id || ""))) throw new Error("Invalid document identity."); ensureMetadata(false); var folder = path.join(historyRoot, id); var names;
    try { safeDirectory(folder, false); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    try { names = fs.readdirSync(folder); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return names.filter(function (name) { return /^\d+-[a-f0-9]{64}\.md$/.test(name); }).sort().reverse().slice(0, 50).map(function (name) {
      var target = path.join(folder, name); var stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONTENT_BYTES) throw Object.assign(new Error("Knowledge history contains an unsafe version."), { code: "UNSAFE_PATH" });
      return { version: name, size: stat.size, createdAt: Number(name.split("-")[0]) };
    });
  }
  function readHistory(id, versionName) {
    var versions = history(id); if (!versions.some(function (entry) { return entry.version === versionName; })) throw Object.assign(new Error("Knowledge history version not found."), { code: "ENOENT" });
    return { version: versionName, content: fs.readFileSync(path.join(historyRoot, id, versionName), "utf8") };
  }
  function restore(id, versionName, name, expectedRevision) {
    if (!/^[a-f0-9-]{20,50}$/i.test(String(id || "")) || !/^\d+-[a-f0-9]{64}\.md$/.test(String(versionName || ""))) throw new Error("Invalid history version.");
    var selected = readHistory(id, versionName);
    var data = registry(); var record = data.documents[id]; if (!record) throw Object.assign(new Error("Knowledge document identity not found."), { code: "ENOENT" });
    var current = existing(name); var restored = save(name, selected.content, current ? expectedRevision || null : null);
    data = registry(); Object.keys(data.documents).forEach(function (key) { if (key !== id && data.documents[key].name === restored.name && !data.documents[key].deleted) delete data.documents[key]; });
    data.documents[id] = Object.assign({}, record, { id: id, name: restored.name, lastRevision: restored.revision, deleted: false }); writeRegistry(data);
    return Object.assign(restored, { id: id });
  }
  function deleted() {
    var data = registry(); return Object.keys(data.documents).filter(function (id) { return data.documents[id].deleted; }).map(function (id) {
      return { id: id, name: data.documents[id].name, revision: data.documents[id].lastRevision || null, deleted: true, historyCount: history(id).length };
    }).filter(function (item) { return item.historyCount > 0; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  return { list: list, read: read, save: save, rename: rename, remove: remove, history: history, readHistory: readHistory, restore: restore, deleted: deleted };
}

module.exports = { createKnowledgeFileStore: createKnowledgeFileStore, revision: revision, validName: validName, cleanName: cleanName, itemType: itemType, MAX_CONTENT_BYTES: MAX_CONTENT_BYTES };
