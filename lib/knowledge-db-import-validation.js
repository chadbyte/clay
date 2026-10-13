var crypto = require("crypto");
var validation = require("./knowledge-db-validation");
var MAX_BATCH_ROWS = 100;
var MAX_BATCH_BYTES = 256 * 1024;

function fail(message, code) { throw Object.assign(new Error(message), { code: code || "INVALID" }); }
function json(value, depth) {
  if (depth > 32) fail("Import JSON exceeds 32 nesting levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || !value) fail("Import payload must contain finite JSON values.");
  if (!Array.isArray(value)) validation.plainObject(value, "Import payload");
  Object.keys(value).forEach(function (key) { json(value[key], depth + 1); });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  var out = {}; Object.keys(value).sort().forEach(function (key) { out[key] = canonical(value[key]); }); return out;
}
function identity(namespace, key) { return JSON.stringify([namespace, key]); }
function sourceText(value, label, max) {
  var clean = validation.text(value, label, max, false);
  if (clean !== value) fail(label + " must not have surrounding whitespace.");
  return clean;
}
function batch(args) {
  validation.plainObject(args, "Import request");
  var namespace = sourceText(args.sourceNamespace, "Source namespace", 120);
  if (!Array.isArray(args.rows) || !args.rows.length || args.rows.length > MAX_BATCH_ROWS) fail("Import batch must contain between 1 and " + MAX_BATCH_ROWS + " rows.", "IMPORT_BATCH_LIMIT");
  json(args.rows, 0);
  if (Buffer.byteLength(JSON.stringify(args.rows), "utf8") > MAX_BATCH_BYTES) fail("Import rows exceed the " + MAX_BATCH_BYTES + " byte input limit.", "IMPORT_BYTES_LIMIT");
  var seen = new Set();
  var rows = args.rows.map(function (row) {
    validation.plainObject(row, "Import row");
    var key = sourceText(row.sourceKey, "Source row key", 200);
    if (seen.has(key)) fail("Import batch contains duplicate source row keys.");
    seen.add(key);
    if (!Object.prototype.hasOwnProperty.call(row, "sourcePayload")) fail("Each import row needs an immutable sourcePayload.");
    validation.plainObject(row.values, "Import values");
    var fingerprint = crypto.createHash("sha256").update(JSON.stringify(canonical({ sourcePayload: row.sourcePayload, values: row.values }))).digest("hex");
    return { sourceKey: key, fingerprint: fingerprint, values: row.values };
  });
  return { sourceNamespace: namespace, rows: rows };
}

module.exports = { batch: batch, identity: identity, sourceText: sourceText, MAX_BATCH_ROWS: MAX_BATCH_ROWS, MAX_BATCH_BYTES: MAX_BATCH_BYTES };
