// Readers that ask a vendor runtime Clay already manages (no credential reads).
// Each takes a request context { adapter, linuxUser } and returns
//   { metrics: [...], accountId?, planType?, observedAtMs? }
// or throws an Error carrying `failureKind`.

var m = require("./vendor-usage-metrics");

function failure(kind, message) {
  var error = new Error(message);
  error.failureKind = kind;
  return error;
}

function codexSnapshotMetrics(limitId, snapshot) {
  var out = [];
  var prefix = limitId || "codex";
  var named = snapshot.limitName && limitId && limitId !== "codex" ? String(snapshot.limitName) : "";
  [["primary", "Primary"], ["secondary", "Secondary"]].forEach(function (pair) {
    var window = snapshot[pair[0]];
    if (!window || window.windowDurationMins === 0) return;
    var used = m.num(window.usedPercent);
    if (used === null || used < 0) return;
    out.push(m.metric("percent", prefix + ":" + pair[0], named || pair[1], {
      usedPercent: used,
      windowMins: m.num(window.windowDurationMins) > 0 ? window.windowDurationMins : null,
      resetsAtMs: m.resetMs(window.resetsAt) !== null ? window.resetsAt * 1000 : null,
    }));
  });
  var credits = snapshot.credits;
  if (credits && (credits.unlimited === true || (credits.hasCredits === true && m.num(credits.balance) !== null))) {
    out.push(m.metric("credits", prefix + ":credits", "Credits", { balance: credits.unlimited === true ? null : m.num(credits.balance), unlimited: credits.unlimited === true }));
  }
  return out;
}

// Source: codex app-server `account/rateLimits/read` (GetAccountRateLimitsResponse).
function codex(context) {
  var adapter = context.adapter;
  if (!adapter || typeof adapter.readAccountRateLimits !== "function") return Promise.reject(failure("unavailable", "The Codex runtime cannot report account usage."));
  return adapter.readAccountRateLimits({ linuxUser: context.linuxUser || undefined }).then(function (reply) {
    if (!reply || typeof reply !== "object") throw failure("parse", "Codex returned no usage.");
    var metrics = [];
    var byId = reply.rateLimitsByLimitId && typeof reply.rateLimitsByLimitId === "object" ? reply.rateLimitsByLimitId : null;
    if (byId) Object.keys(byId).forEach(function (id) { if (byId[id]) metrics = metrics.concat(codexSnapshotMetrics(id, byId[id])); });
    else if (reply.rateLimits) metrics = codexSnapshotMetrics(reply.rateLimits.limitId || "codex", reply.rateLimits);
    var plan = reply.rateLimits && typeof reply.rateLimits.planType === "string" ? reply.rateLimits.planType : null;
    return { metrics: metrics, accountId: typeof reply.accountId === "string" ? reply.accountId : null, planType: plan };
  });
}

// Source: Muse Code `usage/read`; windows carry native used percent and reset ms.
function muse(context) {
  var adapter = context.adapter;
  if (!adapter || typeof adapter.readUsage !== "function") return Promise.reject(failure("unavailable", "The Muse runtime cannot report usage."));
  return adapter.readUsage({ signal: context.signal }).then(function (usage) {
    if (!usage) throw failure("unavailable", "Muse reported no usage.");
    var metrics = [];
    [["window", "Window"], ["weekly", "Weekly"]].forEach(function (pair) {
      var value = usage[pair[0]];
      if (!value || m.num(value.usedPercent) === null || value.usedPercent < 0) return;
      metrics.push(m.metric("percent", "muse:" + pair[0], pair[1], {
        usedPercent: value.usedPercent,
        windowMins: pair[0] === "weekly" ? 10080 : (m.num(value.windowDurationMins) > 0 ? value.windowDurationMins : null),
        resetsAtMs: m.resetMs(value.resetsAtMs),
      }));
    });
    return { metrics: metrics, observedAtMs: m.num(usage.observedAtMs) };
  });
}

var CLAUDE_WINDOWS = [["five_hour", "5-hour", 300], ["seven_day", "7-day", 10080], ["seven_day_opus", "7-day Opus", 10080], ["seven_day_sonnet", "7-day Sonnet", 10080], ["seven_day_oauth_apps", "7-day OAuth apps", 10080]];

// Source: the Claude SDK's account usage call (marked experimental by the SDK),
// answered by one of the requester's own live sessions, so the account is the
// one that session authenticates as. Every field is shape-checked; a changed or
// missing response is "unavailable", never a guess.
function claude(context) {
  var session = context.session;
  var query = session && session.queryInstance;
  if (!query || typeof query.getAccountUsage !== "function") return Promise.reject(failure("unavailable", "Account usage needs one of your live Claude sessions."));
  return Promise.resolve(query.getAccountUsage({ skipBehaviors: true })).then(function (reply) {
    if (!reply || typeof reply !== "object") throw failure("unavailable", "This Claude runtime cannot report account usage.");
    if (reply.rate_limits_available === false || !reply.rate_limits) throw failure("unavailable", "Plan limits do not apply to this Claude account (for example an API key or a third-party provider).");
    var limits = reply.rate_limits;
    var metrics = [];
    CLAUDE_WINDOWS.forEach(function (spec) {
      var w = limits[spec[0]];
      if (!w || m.num(w.utilization) === null || w.utilization < 0) return;
      metrics.push(m.metric("percent", "claude:" + spec[0], spec[1], { usedPercent: w.utilization, windowMins: spec[2], resetsAtMs: m.isoMs(w.resets_at) }));
    });
    (Array.isArray(limits.model_scoped) ? limits.model_scoped : []).forEach(function (w, index) {
      if (!w || m.num(w.utilization) === null || w.utilization < 0) return;
      metrics.push(m.metric("percent", "claude:model:" + index, typeof w.display_name === "string" && w.display_name ? w.display_name : "Model", { usedPercent: w.utilization, resetsAtMs: m.isoMs(w.resets_at) }));
    });
    var extra = limits.extra_usage;
    if (extra && extra.is_enabled === true && m.num(extra.used_credits) !== null) {
      var shared = { used: extra.used_credits, limit: m.num(extra.monthly_limit), balance: null };
      metrics.push(typeof extra.currency === "string" && extra.currency
        ? m.metric("currency", "claude:extra", "Extra usage", Object.assign({ currencyCode: extra.currency }, shared))
        : m.metric("credits", "claude:extra", "Extra usage", Object.assign({ unlimited: false }, shared)));
    }
    return { metrics: metrics, planType: typeof reply.subscription_type === "string" ? reply.subscription_type : null, sourceSessionId: session.localId };
  });
}

module.exports = { codex: codex, muse: muse, claude: claude, failure: failure };
