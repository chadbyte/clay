// Owner-scoped vendor usage overview for the top bar.
//
// This is a read model over quota Clay already observed from the owner's own
// sessions in this project. It is separate from the active-session rejection,
// warning and scheduling path and never changes it.
//
// Identity boundary: Clay cannot prove which vendor account a session used, so
// observations are never merged into a synthetic account view. Each observing
// session is its own source; the overview shows the single most recent source's
// coherent snapshot and reports which session it came from and how many other
// sources exist. A different account in a later session simply becomes the
// newest source; earlier buckets are never combined with it. Sources whose
// session was deleted, replaced or no longer belongs to the owner are ignored.
//
// Account figures come from vendor-usage-service.js, which reads a vendor's own
// native source only when the credential provably belongs to the requester, and
// are reported beside, never merged into, the session-observed snapshot. Nothing
// here starts an agent turn or invents a value: a vendor with no observation is
// reported with no windows and no observation time, and a vendor without a
// verified source says so (capability.mode "unsupported" plus the reason).

var usage = require("./yoke/usage");
var vendorRegistry = require("./yoke/vendor-registry");
var quotaSnapshots = require("./sdk-quota-snapshot");
var capabilities = require("./vendor-usage-capabilities");
var usageService = require("./vendor-usage-service");

var HISTORY_SCAN_LIMIT = 2000;
var DEFAULT_OWNER = "default";

var MAX_SOURCES = 24;

function attachVendorUsageOverview(ctx) {
  var slug = ctx.slug;
  var sm = ctx.sm;
  var usersModule = ctx.usersModule;
  var clients = ctx.clients;
  var sendTo = ctx.sendTo;
  var now = typeof ctx.now === "function" ? ctx.now : Date.now;
  var service = ctx.usageService || usageService.createUsageService({
    now: now, multiUser: multiUser, osUsersEnabled: function () { return !!ctx.osUsers; },
    getAdapter: function (vendor) { return ctx.adapters ? ctx.adapters[vendor] || null : null; },
    sourceLive: function (session) { return !!(sm && sm.sessions && typeof sm.sessions.get === "function" && sm.sessions.get(session.localId) === session); },
  });
  var owners = Object.create(null);
  var seeded = Object.create(null);
  var sequence = 0;

  function multiUser() {
    return !!(usersModule && usersModule.isMultiUser && usersModule.isMultiUser());
  }

  // Session owner key. In account mode an ownerless legacy session belongs to
  // nobody we can name, so it contributes to no one's overview.
  function sessionOwner(session) {
    if (!multiUser()) return DEFAULT_OWNER;
    return session && session.ownerId ? String(session.ownerId) : null;
  }

  // The caller's live identity: the cached socket user must still exist and
  // still have access to this project. Returns the owner key or null.
  function socketOwner(ws) {
    if (!ws || ws.readyState !== 1 || (clients && typeof clients.has === "function" && !clients.has(ws))) return null;
    if (!multiUser()) return DEFAULT_OWNER;
    var user = ws._clayUser;
    if (!user || !user.id || typeof usersModule.findUserById !== "function" || !usersModule.findUserById(user.id)) return null;
    if (typeof usersModule.canAccessProject !== "function" || typeof ctx.getProjectAccess !== "function") return null;
    if (usersModule.canAccessProject(user.id, ctx.getProjectAccess()) !== true) return null;
    return String(user.id);
  }

  function liveSession(owner, vendor, source) {
    var session = sm && sm.sessions && typeof sm.sessions.get === "function" ? sm.sessions.get(source.sessionId) : null;
    if (!session || session !== source.session || sessionOwner(session) !== owner || (session.vendor || "claude") !== vendor) return null;
    return session;
  }

  // Sources keep the exact session object they were recorded for, so a session
  // later replaced at the same id never inherits them.
  function sourceFor(owner, vendor, session) {
    var byVendor = owners[owner] || (owners[owner] = Object.create(null));
    var entry = byVendor[vendor] || (byVendor[vendor] = { sources: Object.create(null) });
    var key = String(session.localId);
    var source = entry.sources[key];
    if (source && source.session !== session) { delete entry.sources[key]; source = null; }
    if (!source) source = entry.sources[key] = { session: session, sessionId: session.localId, buckets: Object.create(null), lastObservedAtMs: null, seq: 0 };
    return { entry: entry, source: source };
  }

  // Ordering is lexicographic on (observation time, sequence); never arithmetic,
  // so large timestamps cannot lose precision.
  function compareSources(a, b) {
    var at = Number.isFinite(a.lastObservedAtMs) ? a.lastObservedAtMs : -Infinity;
    var bt = Number.isFinite(b.lastObservedAtMs) ? b.lastObservedAtMs : -Infinity;
    if (at !== bt) return at < bt ? -1 : 1;
    return a.seq - b.seq;
  }

  // Runs after a successful update, so the newest source can never evict itself.
  function trimSources(entry) {
    var keys = Object.keys(entry.sources);
    if (keys.length <= MAX_SOURCES) return;
    keys.sort(function (x, y) { return compareSources(entry.sources[x], entry.sources[y]); });
    for (var i = 0; i < keys.length - MAX_SOURCES; i++) delete entry.sources[keys[i]];
  }

  function newer(existing, observedAtMs) {
    if (!existing) return true;
    if (!Number.isFinite(observedAtMs)) return !Number.isFinite(existing.observedAtMs);
    return !Number.isFinite(existing.observedAtMs) || observedAtMs >= existing.observedAtMs;
  }

  function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function touch(source, observedAtMs) {
    source.seq = ++sequence;
    if (Number.isFinite(observedAtMs) && (source.lastObservedAtMs === null || observedAtMs > source.lastObservedAtMs)) source.lastObservedAtMs = observedAtMs;
  }

  // Returns true when the overview changed.
  function apply(owner, vendor, session, message, observedAtMs, origin) {
    if (!owner || !vendor || !message || !session) return false;
    var event = usage.clientEvent(message, vendor);
    if (!event || event.ignored === true) return false;
    var held = sourceFor(owner, vendor, session);
    var source = held.source;
    var at = Number.isFinite(observedAtMs) ? observedAtMs : null;
    var changed = applyToSource(source, event, at, origin);
    if (changed) trimSources(held.entry);
    else if (Object.keys(source.buckets).length === 0) delete held.entry.sources[String(session.localId)];
    return changed;
  }

  function applyToSource(source, event, at, origin) {
    if (event.source === "account_snapshot" && Array.isArray(event.quotaWindows)) {
      var limitId = String(event.limitId || "");
      var guardKey = "snapshot\u0000" + limitId + "\u0000guard";
      var guard = source.buckets[guardKey];
      if (guard && !newer(guard, at)) return false;
      Object.keys(source.buckets).forEach(function (key) {
        if (source.buckets[key].limitId === limitId && source.buckets[key].kind === "snapshot") delete source.buckets[key];
      });
      source.buckets[guardKey] = { kind: "guard", observedAtMs: at, limitId: limitId };
      event.quotaWindows.forEach(function (window) {
        source.buckets["snapshot\u0000" + limitId + "\u0000" + window.key] = {
          kind: "snapshot", limitId: limitId, key: window.key,
          windowDurationMins: numberOrNull(window.windowDurationMins),
          usedPercent: numberOrNull(window.usedPercent),
          resetsAt: numberOrNull(window.resetsAt),
          observedAtMs: at, origin: origin,
        };
      });
      touch(source, at);
      return true;
    }
    if (event.type === "rate_limit_usage" && event.rateLimitType && numberOrNull(event.resetsAt)) {
      var resetKey = "reset\u0000" + event.rateLimitType;
      var prior = source.buckets[resetKey];
      if (!newer(prior, at)) return false;
      source.buckets[resetKey] = {
        kind: "reset", rateLimitType: event.rateLimitType, resetsAt: event.resetsAt,
        status: typeof event.status === "string" ? event.status : null,
        usedPercent: prior && prior.resetsAt === event.resetsAt ? prior.usedPercent : null,
        observedAtMs: at, origin: origin,
      };
      touch(source, at);
      return true;
    }
    if (event.type === "rate_limit" && event.rateLimitType && numberOrNull(event.utilization) !== null) {
      var bucket = source.buckets["reset\u0000" + event.rateLimitType];
      // Utilization is only attached to a window whose reset time is known.
      if (bucket && newer(bucket, at)) {
        bucket.usedPercent = Math.round(event.utilization * 1000) / 10;
        bucket.observedAtMs = at;
        touch(source, at);
        return true;
      }
    }
    return false;
  }

  // Seed once per owner from session history that survived a restart. Observed
  // times come from the record's own stamp, never from the time of the scan.
  function seed(owner) {
    if (seeded[owner]) return;
    seeded[owner] = true;
    var sessions = sm && sm.sessions;
    if (!sessions || typeof sessions.forEach !== "function") return;
    sessions.forEach(function (session) {
      if (sessionOwner(session) !== owner || !session.history) return;
      var vendor = session.vendor || "claude";
      var seenSnapshot = Object.create(null);
      var seenReset = Object.create(null);
      var history = session.history;
      var floor = Math.max(0, history.length - HISTORY_SCAN_LIMIT);
      for (var i = history.length - 1; i >= floor; i--) {
        var item = history[i];
        if (!item || item.type !== "rate_limit_usage" || item.vendor !== vendor) continue;
        var observedAtMs = numberOrNull(item.observedAtMs) !== null ? item.observedAtMs : numberOrNull(item._ts);
        if (item.source === "account_snapshot") {
          if (seenSnapshot[item.limitId]) continue;
          seenSnapshot[item.limitId] = true;
        } else if (item.rateLimitType) {
          if (seenReset[item.rateLimitType]) continue;
          seenReset[item.rateLimitType] = true;
        }
        apply(owner, vendor, session, item, observedAtMs, "history");
      }
    });
  }

  function activeWindows(source, current) {
    var windows = [];
    Object.keys(source.buckets).forEach(function (key) {
      var bucket = source.buckets[key];
      if (bucket.kind === "guard") return;
      if (bucket.resetsAt !== null && bucket.resetsAt <= current) return;
      windows.push({
        kind: bucket.kind, limitId: bucket.limitId || null, key: bucket.key || bucket.rateLimitType || null,
        rateLimitType: bucket.rateLimitType || null, windowDurationMins: bucket.windowDurationMins || null,
        usedPercent: bucket.usedPercent, resetsAt: bucket.resetsAt, status: bucket.status || null,
        observedAtMs: bucket.observedAtMs, origin: bucket.origin,
      });
    });
    return windows;
  }

  // The newest still-valid source supplies the whole snapshot; sources are
  // never blended.
  function vendorMessage(owner, vendor, installedMap, linuxUser) {
    var entry = owners[owner] && owners[owner][vendor];
    var current = now();
    var candidates = [];
    if (entry) {
      Object.keys(entry.sources).forEach(function (key) {
        var source = entry.sources[key];
        if (!liveSession(owner, vendor, source)) return;
        candidates.push({ source: source, windows: activeWindows(source, current) });
      });
    }
    candidates.sort(function (a, b) { return compareSources(b.source, a.source); });
    var withWindows = candidates.filter(function (c) { return c.windows.length > 0; });
    var chosen = withWindows[0] || candidates[0] || null;
    return {
      vendor: vendor,
      installed: installedMap ? installedMap[vendor] === true : null,
      windows: chosen ? chosen.windows : [],
      lastObservedAtMs: chosen ? chosen.source.lastObservedAtMs : null,
      sourceSessionId: chosen ? chosen.source.sessionId : null,
      otherSourceCount: Math.max(0, withWindows.length - (withWindows[0] ? 1 : 0)),
      scope: "latest_observing_session",
      capability: capabilities.publicCapability(vendor),
      account: service.peek(owner, linuxUser, vendor),
    };
  }

  // The requester's own newest live session for a vendor whose query handle can
  // answer an account usage request (Claude). Ownership is re-derived from the
  // session record, never from the socket's claim.
  function accountSession(owner, vendor) {
    if (vendor !== "claude" || !sm || !sm.sessions || typeof sm.sessions.forEach !== "function") return null;
    var found = null;
    sm.sessions.forEach(function (session) {
      if ((session.vendor || "claude") !== vendor || sessionOwner(session) !== owner) return;
      var query = session.queryInstance;
      if (!query || typeof query.getAccountUsage !== "function") return;
      if (!found || (session.lastActivity || 0) >= (found.lastActivity || 0)) found = session;
    });
    return found;
  }

  function linuxUserOf(ws) {
    return typeof ctx.getLinuxUserForWs === "function" ? ctx.getLinuxUserForWs(ws) || null : null;
  }

  function overviewMessage(ws, requestId) {
    var owner = socketOwner(ws);
    var vendors = [];
    if (owner) {
      seed(owner);
      var installedMap = null;
      if (typeof ctx.getVendorAvailability === "function") {
        installedMap = Object.create(null);
        (ctx.getVendorAvailability(ws) || []).forEach(function (item) { installedMap[item.id] = item.installed === true; });
      }
      var registry = vendorRegistry.publicInfo();
      var linuxUser = linuxUserOf(ws);
      capabilities.VENDORS.forEach(function (vendor) {
        if (registry[vendor]) vendors.push(vendorMessage(owner, vendor, installedMap, linuxUser));
      });
    }
    var message = {
      type: "vendor_usage_overview", slug: slug, serverNowMs: now(), vendors: vendors,
      userId: ws && ws._clayUser && ws._clayUser.id ? ws._clayUser.id : null,
    };
    if (!owner) message.error = "Not authorized for this project.";
    if (requestId !== undefined) message.requestId = requestId;
    return message;
  }

  // Recipients are revalidated at send time, not when they connected.
  function publish(owner) {
    clients.forEach(function (ws) {
      if (socketOwner(ws) !== owner) return;
      sendTo(ws, overviewMessage(ws));
    });
  }

  function observe(session, message, observedAtMs) {
    var owner = sessionOwner(session);
    if (!owner) return;
    // Seed before the first live observation so older history cannot appear to
    // postdate it, then fold the new one in.
    seed(owner);
    if (apply(owner, (message && message.vendor) || session.vendor || "claude", session, message, observedAtMs, "live")) publish(owner);
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "vendor_usage_get") return false;
    var requestId = typeof msg.requestId === "string" && msg.requestId.length <= 64 ? msg.requestId : undefined;
    if (msg.slug !== undefined && msg.slug !== slug) {
      var wrong = overviewMessage(null, requestId);
      wrong.vendors = [];
      wrong.error = "This request belongs to a different project.";
      sendTo(ws, wrong);
      return true;
    }
    sendTo(ws, overviewMessage(ws, requestId));
    if (msg.refresh === true) refreshAccounts(ws, requestId, msg);
    return true;
  }

  // Starts account reads for installed, query-capable vendors and sends an
  // updated overview, echoing the same requestId, as each one settles. A result
  // is dropped when the socket's live owner or the account changed meanwhile.
  function refreshAccounts(ws, requestId, msg) {
    var owner = socketOwner(ws);
    if (!owner) return;
    var userId = ws._clayUser && ws._clayUser.id ? ws._clayUser.id : null;
    var linuxUser = linuxUserOf(ws);
    var installedMap = null;
    if (typeof ctx.getVendorAvailability === "function") {
      installedMap = Object.create(null);
      (ctx.getVendorAvailability(ws) || []).forEach(function (item) { installedMap[item.id] = item.installed === true; });
    }
    var wanted = typeof msg.vendor === "string" ? [msg.vendor] : capabilities.VENDORS;
    wanted.forEach(function (vendor) {
      if (capabilities.VENDORS.indexOf(vendor) === -1 || capabilities.capabilityFor(vendor).mode !== "query") return;
      if (installedMap && installedMap[vendor] !== true) return;
      var session = accountSession(owner, vendor);
      // Refused and unintegrated vendors are already described by the immediate reply.
      var refused = service.refusal(vendor, linuxUser, !!session);
      if (refused) return;
      function isCurrent() { return socketOwner(ws) === owner && linuxUserOf(ws) === linuxUser && (ws._clayUser && ws._clayUser.id ? ws._clayUser.id : null) === userId; }
      service.read({ owner: owner, linuxUser: linuxUser, vendor: vendor, session: session, force: msg.force === true, isCurrent: isCurrent }).then(function (result) {
        if (result && isCurrent()) sendTo(ws, overviewMessage(ws, requestId));
      }, function () {});
    });
  }

  // Read-only account usage for a canonical caller that has no socket. The
  // caller supplies the already-authorized owner and OS user plus a liveness
  // check; the same service, identity rules and caches apply. Resolves to the
  // per-vendor entries, or null if the caller stopped being current.
  async function readForOwner(request) {
    var owner = request.owner;
    if (!owner || sessionOwnerKey(owner) === null) return null;
    var isCurrent = typeof request.isCurrent === "function" ? request.isCurrent : function () { return true; };
    var installedMap = request.installed || null;
    var linuxUser = request.linuxUser || null;
    seed(owner);
    var jobs = [];
    capabilities.VENDORS.forEach(function (vendor) {
      if (capabilities.capabilityFor(vendor).mode !== "query") return;
      if (installedMap && installedMap[vendor] !== true) return;
      var session = accountSession(owner, vendor);
      if (service.refusal(vendor, linuxUser, !!session)) return;
      jobs.push(service.read({ owner: owner, linuxUser: linuxUser, vendor: vendor, session: session, force: request.force === true, isCurrent: isCurrent }));
    });
    var results = await Promise.all(jobs.map(function (job) { return job.then(function (value) { return value; }, function () { return undefined; }); }));
    if (!isCurrent() || results.indexOf(null) !== -1) return null;
    var registry = vendorRegistry.publicInfo();
    return capabilities.VENDORS.filter(function (vendor) { return registry[vendor] && (!installedMap || installedMap[vendor] === true); }).map(function (vendor) {
      var entry = vendorMessage(owner, vendor, installedMap, linuxUser);
      return { vendor: vendor, capability: entry.capability, account: entry.account, observed: { windows: entry.windows, lastObservedAtMs: entry.lastObservedAtMs } };
    });
  }

  function sessionOwnerKey(owner) { return multiUser() ? (owner && owner !== DEFAULT_OWNER ? owner : null) : DEFAULT_OWNER; }

  // Account changes (a vendor login) drop every cached account read.
  function invalidateAll() {
    Object.keys(owners).concat(Object.keys(seeded), [DEFAULT_OWNER]).forEach(function (owner) { service.invalidate(owner); });
    clients.forEach(function (ws) { var owner = socketOwner(ws); if (owner) service.invalidate(owner); });
  }

  if (sm) {
    quotaSnapshots.attachQuotaObservers(sm);
    sm.addOnQuotaObserved(observe);
  }
  return { handleMessage: handleMessage, observe: observe, overviewMessage: overviewMessage, invalidateAll: invalidateAll, readForOwner: readForOwner, service: service };
}

module.exports = { attachVendorUsageOverview: attachVendorUsageOverview };
