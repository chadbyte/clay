// Readers for vendors whose only native usage source is an authenticated HTTP
// endpoint using the vendor CLI's own stored token.
//
// These read exactly one documented credential file and send the token only to
// the vendor's own HTTPS host: an endpoint override is accepted only when it is
// https on that exact host (no credentials, no port); anything else is refused
// BEFORE the credential file is read, so a token is never sent to an unverified
// origin. Redirects are refused. They never refresh or rewrite the file (the CLI
// owns the token lifecycle), never log or return the token, and are used only
// where the credential provably belongs to the requester (see
// vendor-usage-service.js identity rules). `identity` is a short one-way
// fingerprint of the credential used, so the service can notice a sign-in
// change; it cannot be reversed to the token.
// Request shapes follow Orca@17a2bced src/main/rate-limits/{kimi,grok}-fetcher.ts.

var path = require("path");
var crypto = require("crypto");
var m = require("./vendor-usage-metrics");
var failure = require("./vendor-usage-native-readers").failure;

var TOKEN_SKEW_SECONDS = 5;
var TOKEN_SKEW_MS = 5 * 60 * 1000;

function parseJson(text, what) {
  try { return JSON.parse(text); } catch (e) { throw failure("parse", what + " could not be read."); }
}

function fingerprint(parts) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

// Returns the base URL to use, or throws before any credential is read.
function trustedBase(override, fallback, host, what) {
  var value = typeof override === "string" ? override.trim() : "";
  if (!value) return fallback;
  var url;
  try { url = new URL(value); } catch (e) { url = null; }
  if (!url || url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port) {
    throw failure("untrusted_origin", "The " + what + " endpoint override is not the vendor's own HTTPS host, so the saved sign-in was not used or sent.");
  }
  return (url.origin + url.pathname).replace(/\/$/, "");
}

// A missing file means "not signed in", any other failure is a read error.
async function readCredentialFile(deps, file, what) {
  var text;
  try { text = await deps.readText(file); } catch (error) {
    if (error && error.code === "ENOENT") throw failure("no_auth", "Not signed in to " + what + ".");
    throw failure("unavailable", "The " + what + " sign-in file could not be read.");
  }
  return parseJson(text, "The " + what + " sign-in file");
}

async function getJson(deps, url, headers, what) {
  var response;
  try { response = await deps.fetchJson(url, headers); } catch (error) {
    throw failure(error && error.name === "TimeoutError" ? "timeout" : "network", what + " usage could not be reached.");
  }
  if (response.status === 401 || response.status === 403) throw failure("unauthorized", what + " rejected the saved sign-in (HTTP " + response.status + ").");
  if (response.status === 429) throw failure("rate_limited", what + " is rate-limiting usage reads.");
  if (response.status < 200 || response.status >= 300) throw failure("server", what + " usage request failed (HTTP " + response.status + ").");
  return response.body && typeof response.body === "object" ? response.body : {};
}

// ---- Kimi Code ------------------------------------------------------------

function kimiHome(deps) {
  var override = deps.env.KIMI_CODE_HOME && deps.env.KIMI_CODE_HOME.trim();
  return override || path.join(deps.homedir(), ".kimi-code");
}

function windowMins(window) {
  var duration = m.num(window && window.duration);
  if (duration === null) return null;
  var unit = String((window && window.timeUnit) || "").toUpperCase();
  if (unit.indexOf("MINUTE") !== -1) return duration;
  if (unit.indexOf("HOUR") !== -1) return duration * 60;
  if (unit.indexOf("DAY") !== -1) return duration * 1440;
  if (unit.indexOf("SECOND") !== -1) return Math.round(duration / 60);
  return null;
}

// Counts stay counts: used/limit/remaining are the vendor's own figures.
function kimiCount(id, label, detail, mins) {
  if (!detail) return null;
  var limit = m.num(detail.limit);
  var used = m.num(detail.used);
  var remaining = m.num(detail.remaining);
  if (limit === null || limit <= 0) return null;
  if (used === null && remaining !== null) used = limit - remaining;
  if (remaining === null && used !== null) remaining = limit - used;
  if (used === null) return null;
  return m.metric("count", id, label, { used: used, limit: limit, remaining: remaining, windowMins: mins, resetsAtMs: m.isoMs(detail.resetTime || detail.resetAt) });
}

function kimiToken(creds) {
  return creds && typeof creds.access_token === "string" ? creds.access_token : "";
}

async function kimi(deps) {
  var base = trustedBase(deps.env.KIMI_CODE_BASE_URL, "https://api.kimi.com/coding/v1", "api.kimi.com", "Kimi Code");
  var creds = await readCredentialFile(deps, path.join(kimiHome(deps), "credentials", "kimi-code.json"), "Kimi Code");
  var token = kimiToken(creds);
  if (!token) throw failure("no_auth", "Not signed in to Kimi Code.");
  var expiresAt = m.num(creds.expires_at);
  if (expiresAt === null || expiresAt - Math.floor(deps.now() / 1000) <= TOKEN_SKEW_SECONDS) {
    throw failure("expired_auth", "The Kimi Code sign-in has expired; run kimi once to refresh it.");
  }
  var body = await getJson(deps, base + "/usages", { Authorization: "Bearer " + token, Accept: "application/json" }, "Kimi Code");
  var metrics = [];
  // The response does not name the period or unit of the top-level block.
  var weekly = kimiCount("kimi:usage", "Usage", body.usage, null);
  if (weekly) metrics.push(weekly);
  (Array.isArray(body.limits) ? body.limits : []).forEach(function (limit, index) {
    var mins = windowMins(limit && limit.window);
    var item = kimiCount("kimi:limit:" + index, mins ? "Rolling window" : "Limit", limit && limit.detail, mins);
    if (item) metrics.push(item);
  });
  return { metrics: metrics, identity: fingerprint(["kimi", token]) };
}

// Fingerprint of the saved sign-in, read synchronously; null when absent,
// unreadable, or when the endpoint override is untrusted (the credential is not
// read at all in that case, same as the reader).
function kimiIdentity(deps) {
  try {
    trustedBase(deps.env.KIMI_CODE_BASE_URL, "https://api.kimi.com/coding/v1", "api.kimi.com", "Kimi Code");
    var token = kimiToken(JSON.parse(deps.readTextSync(path.join(kimiHome(deps), "credentials", "kimi-code.json"))));
    return token ? fingerprint(["kimi", token]) : null;
  } catch (e) { return null; }
}

// ---- Grok Build -----------------------------------------------------------

var GROK_ISSUER = "https://auth.x.ai";

function grokHome(deps) {
  var override = deps.env.GROK_HOME && deps.env.GROK_HOME.trim();
  return override && path.isAbsolute(override) ? override : path.join(deps.homedir(), ".grok");
}

// Only the default xAI issuer's session is used: a credential from any other
// issuer is not bound to the billing host, so it is never sent there.
function pickGrokSession(parsed, now) {
  var expired = null;
  var keys = Object.keys(parsed || {});
  for (var i = 0; i < keys.length; i++) {
    var entry = parsed[keys[i]];
    var preferred = keys[i] === GROK_ISSUER || keys[i].indexOf(GROK_ISSUER + "::") === 0;
    if (!preferred || !entry || typeof entry.key !== "string" || !entry.key) continue;
    var expiresMs = m.isoMs(entry.expires_at);
    var fresh = expiresMs === null || expiresMs - now > TOKEN_SKEW_MS;
    var session = { token: entry.key, userId: typeof entry.user_id === "string" ? entry.user_id : null, fresh: fresh };
    if (fresh) return session;
    expired = expired || session;
  }
  return expired;
}

function grokMoney(value) {
  return m.num(value && value.val);
}

function grokMetrics(config) {
  var out = [];
  var end = m.isoMs(config.currentPeriod && config.currentPeriod.end || config.billingPeriodEnd);
  var start = m.isoMs(config.currentPeriod && config.currentPeriod.start || config.billingPeriodStart);
  // The period length comes from the response's own start and end, never assumed.
  var mins = start !== null && end !== null && end > start ? Math.round((end - start) / 60000) : null;
  // Only a reported percent is shown: an absent field is unknown, not 0%.
  if (m.num(config.creditUsagePercent) !== null) {
    out.push(m.metric("percent", "grok:credits", "Credits", { usedPercent: Math.min(100, Math.max(0, config.creditUsagePercent)), windowMins: mins, resetsAtMs: end }));
  }
  var limit = grokMoney(config.monthlyLimit);
  var used = grokMoney(config.used);
  // The response does not name a currency, so these stay unitless amounts.
  if (limit !== null && limit > 0 && used !== null) {
    out.push(m.metric("amount", "grok:budget", "Included budget", { used: used, limit: limit, windowMins: mins, resetsAtMs: end }));
  }
  return out;
}

function grokBase(deps) {
  return trustedBase(deps.env.GROK_CLI_CHAT_PROXY_BASE_URL, "https://cli-chat-proxy.grok.com/v1", "cli-chat-proxy.grok.com", "Grok");
}

async function grok(deps) {
  var base = grokBase(deps);
  var parsed = await readCredentialFile(deps, path.join(grokHome(deps), "auth.json"), "Grok");
  var session = pickGrokSession(parsed, deps.now());
  if (!session) throw failure("no_auth", "Not signed in to Grok.");
  if (!session.fresh) throw failure("expired_auth", "The Grok sign-in has expired; run grok once to refresh it.");
  var headers = { Authorization: "Bearer " + session.token, "X-XAI-Token-Auth": "xai-grok-cli", Accept: "application/json" };
  if (session.userId) headers["x-userid"] = session.userId;
  var body = await getJson(deps, base + "/billing?format=credits", headers, "Grok");
  var config = body.config || body;
  var metrics = grokMetrics(config);
  if (metrics.length === 0) {
    // The default view can carry a monthly budget the credits view omits.
    var other = await getJson(deps, base + "/billing", headers, "Grok");
    metrics = grokMetrics(other.config || other);
  }
  return { metrics: metrics, planType: typeof config.subscriptionTier === "string" ? config.subscriptionTier : null, identity: fingerprint(["grok", session.token, session.userId || ""]) };
}

function grokIdentity(deps) {
  try {
    grokBase(deps);
    var session = pickGrokSession(JSON.parse(deps.readTextSync(path.join(grokHome(deps), "auth.json"))), deps.now());
    return session ? fingerprint(["grok", session.token, session.userId || ""]) : null;
  } catch (e) { return null; }
}

module.exports = { kimi: kimi, grok: grok, identities: { kimi: kimiIdentity, grok: grokIdentity } };
