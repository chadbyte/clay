// Provider-neutral usage metric shapes. A metric keeps the unit its vendor
// reported; nothing is converted to a percentage here or anywhere downstream.
//
//   percent   { usedPercent }                       native percent used
//   count     { used, limit, remaining }            requests/messages/tokens
//   credits   { balance, used, limit, unlimited }   unitless credits (balance and/or used of limit)
//   currency  { used, limit, balance, currencyCode } money in a named currency
//   amount    { used, limit }                       numbers whose unit the vendor did not name
//
// Every metric may carry windowMins and resetsAtMs (milliseconds). A field the
// vendor did not report is null, never 0.

var UNITS = ["percent", "count", "credits", "currency", "amount"];

function num(value) {
  if (typeof value === "string" && value.trim() !== "") value = Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resetMs(value) {
  var n = num(value);
  return n !== null && n > 0 ? n : null;
}

function isoMs(value) {
  if (typeof value !== "string" || !value) return null;
  var ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function metric(unit, id, label, fields) {
  var m = { unit: unit, id: String(id), label: String(label), windowMins: null, resetsAtMs: null };
  Object.keys(fields || {}).forEach(function (key) { m[key] = fields[key]; });
  return m;
}

// Validates a metric from any reader before it can reach a client.
function valid(m) {
  if (!m || UNITS.indexOf(m.unit) === -1 || typeof m.id !== "string") return false;
  if (m.unit === "percent") return num(m.usedPercent) !== null && m.usedPercent >= 0;
  if (m.unit === "count" || m.unit === "amount") return num(m.used) !== null || num(m.remaining) !== null;
  if (m.unit === "credits") return m.unlimited === true || num(m.balance) !== null || num(m.used) !== null;
  if (m.unit === "currency") return typeof m.currencyCode === "string" && m.currencyCode !== "" && (num(m.used) !== null || num(m.balance) !== null);
  return false;
}

module.exports = { UNITS: UNITS, num: num, resetMs: resetMs, isoMs: isoMs, metric: metric, valid: valid };
