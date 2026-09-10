// Split-group pair creation.
//
// Extracted from project-session-pair.js, which operates a pair once it
// exists; this module is only about how one comes into being. Both the
// explicit "Add Split Worker", accepted proposal, and transactional replacement
// flows land here, so vendor validation, owner derivation and the group record
// are written in exactly one place.
//
// Ownership always comes from the connection or the Driver session, never from
// the incoming message.
//
// CONTEXT CONTRACT: this module reads `sm`, `splitStore`, `isMate`,
// `usersModule` and `sendTo` off its own argument, all at the top level.
// attachSessionPair's context already carries all five, so it is passed
// through unchanged. Re-wrapping it (it was once `{ sm, splitStore, ctx }`)
// leaves `isMate`, `usersModule` and `sendTo` undefined, which silently
// disables the Mate guard, breaks the pair_session_create reply, and throws
// "Cannot read properties of undefined (reading 'isMultiUser')" the moment a
// pair is created for an owned session — single-user installs escape it only
// because a Driver with no ownerId short-circuits that expression. Add any new
// dependency as a top-level field of that same context.
//
// Two ordering rules matter and are load-bearing:
//
//   1. Nothing is created until everything is validated. Driver capability and
//      both runtime requests are settled first, so a rejected request leaves no
//      orphan session behind. Any installed, available model may be the Driver;
//      model choice is the user's rather than a server-side tier policy.
//   2. `preflightRuntime` is side-effect free, so a caller that is about to
//      destroy something (replacement dissolving a live pair) can validate the
//      replacement first and abort while the old pair is still intact.

var driverEligibility = require("./session-driver-eligibility");
var models = require("./project-models");
var yoke = require("./yoke");
var sessionProvenance = require("./session-provenance");

function attachPairFactory(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;

  function validateVendor(vendor) {
    var installed = sm.installedVendors || [];
    if (!vendor || installed.indexOf(vendor) === -1) throw new Error("vendor is not installed: " + (vendor || "unknown"));
    if (Array.isArray(sm.availableVendors) && sm.availableVendors.indexOf(vendor) === -1) {
      throw new Error("vendor runtime is temporarily unavailable: " + vendor);
    }
    return vendor;
  }

  // An explicitly requested model must exist in the server's own catalog for
  // that vendor, matched through the repo's canonical matcher so an alias, an
  // id or a resolvedModel all count. Caller text is never taken on trust: if
  // the catalog is not populated we cannot confirm the model, so an explicit
  // request fails closed rather than being forwarded blindly.
  function validateModel(vendor, model) {
    var requested = typeof model === "string" ? model.trim() : "";
    if (!requested) return null;
    var catalog = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
    if (catalog.length === 0) {
      throw new Error("no models are available yet for vendor \"" + vendor +
        "\", so model \"" + requested + "\" cannot be confirmed");
    }
    for (var i = 0; i < catalog.length; i++) {
      if (models.modelEntryMatches(catalog[i], requested)) return requested;
    }
    throw new Error("model is not available for vendor \"" + vendor + "\": " + requested);
  }

  function validateEffort(vendor, effort) {
    var requested = typeof effort === "string" ? effort.trim() : "";
    var fallback = (sm.currentEffortByVendor && sm.currentEffortByVendor[vendor]) || sm.currentEffort || "medium";
    var clamped = yoke.clampEffort(vendor, requested || fallback) || null;
    if (requested && !clamped) {
      throw new Error("reasoning effort is not supported for vendor \"" + vendor + "\": " + requested);
    }
    return clamped;
  }

  // Resolve and validate one session runtime request without creating
  // anything. Throws on the first unusable field.
  function preflightRuntime(spec, defaultVendor) {
    var request = spec || {};
    var vendor = validateVendor((typeof request.vendor === "string" && request.vendor.trim()) || defaultVendor);
    return {
      vendor: vendor,
      model: validateModel(vendor, request.model),
      effort: validateEffort(vendor, request.effort),
      explicitEffort: !!(typeof request.effort === "string" && request.effort.trim()),
    };
  }

  // The default Worker vendor for an accepted proposal or replacement prefers
  // a different engine from the Driver's own, so the pair does not double up.
  function defaultWorkerVendorFor(driver) {
    var installed = sm.installedVendors || [];
    if (installed.length === 0) throw new Error("no coding agent is installed for a Split Worker session");
    if (installed.indexOf("codex") !== -1 && driver.vendor !== "codex") return "codex";
    for (var i = 0; i < installed.length; i++) {
      if (installed[i] !== driver.vendor) return installed[i];
    }
    return installed[0];
  }

  // Side-effect-free check that this exact Driver could create this exact
  // Worker right now. Used by replacement before it touches anything.
  function preflightWorkerForDriver(driver, args) {
    if (ctx.isMate) throw new Error("Pair sessions are only available in projects");
    if (!driver) throw new Error("driver session not found");
    var verdict = driverEligibility.evaluateDriverSession(driver, sm);
    if (!verdict.ok) throw new Error(verdict.error);
    var options = args || {};
    var vendor = typeof options.workerVendor === "string" ? options.workerVendor.trim() : "";
    return preflightRuntime({
      vendor: vendor || defaultWorkerVendorFor(driver),
      model: options.workerModel,
      effort: options.workerEffort,
    }, null);
  }

  function createPairRecord(ws, msg) {
    if (ctx.isMate) throw new Error("Pair sessions are only available in projects");
    var driverSpec = msg.driver || {};
    var workerSpec = msg.worker || {};
    var ownerId = ws._clayUser && ctx.usersModule.isMultiUser() ? ws._clayUser.id : null;

    // --- Validate everything first; create nothing yet. ---

    var workerRuntime = preflightRuntime(workerSpec, sm.lastVendor || "codex");

    var existingDriver = null;
    var driverRuntime = null;
    var groupName;
    if (Number.isInteger(driverSpec.sessionId)) {
      // "Add Split Worker" on an existing session: the current session becomes
      // the Driver with its full conversation context intact.
      existingDriver = sm.sessions.get(driverSpec.sessionId);
      if (!existingDriver) throw new Error("driver session not found");
      if ((existingDriver.ownerId || null) !== ownerId) throw new Error("driver session access denied");
      if (store.groupForMember(existingDriver.localId)) throw new Error("this session is already in a split group");
      var existingVerdict = driverEligibility.evaluateDriverSession(existingDriver, sm);
      if (!existingVerdict.ok) throw new Error(existingVerdict.error);
      groupName = undefined; // auto name from member titles
    } else {
      driverRuntime = preflightRuntime(driverSpec, "claude");
      groupName = "Agent pair";
    }

    // --- Everything is valid; now create. ---

    var driver = existingDriver;
    var createdDriver = null;
    if (!driver) {
      driver = sm.createSessionRaw({
        ownerId: ownerId,
        vendor: driverRuntime.vendor,
        model: driverRuntime.model,
        effort: driverRuntime.effort,
      });
      createdDriver = driver;
      driver.title = "Driver · " + ((yoke.getVendorInfo(driverRuntime.vendor) || {}).displayName || driverRuntime.vendor);
      if (driverRuntime.explicitEffort) driver.loopSettings = { effort: driverRuntime.effort };
    }

    var worker = sm.createSessionRaw({
      ownerId: ownerId,
      vendor: workerRuntime.vendor,
      model: workerRuntime.model,
      effort: workerRuntime.effort,
    });
    worker.title = "Split Worker · " + ((yoke.getVendorInfo(workerRuntime.vendor) || {}).displayName || workerRuntime.vendor);
    if (workerRuntime.explicitEffort) worker.loopSettings = { effort: workerRuntime.effort };

    var result;
    try {
      // Creation provenance is durable and independent from the active split
      // group. Persist both ends before the group's broadcast so the Worker
      // never flashes as unrelated and survives a restart with its parentage.
      sessionProvenance.markWorker(driver, worker, sm.sessions);
      if (typeof sm.saveSessionFile === "function") {
        sm.saveSessionFile(driver);
        sm.saveSessionFile(worker);
      }

      result = store.create(ws, {
        members: [driver.localId, worker.localId],
        pair: { driverId: driver.localId, workerId: worker.localId },
        name: groupName,
      });
      if (!result.ok) throw new Error(result.error);
    } catch (e) {
      // Any failure after session creation must remove exactly the sessions
      // made by this call. An existing Driver is never removed.
      removeCreated(worker);
      removeCreated(createdDriver);
      throw e;
    }
    sm.broadcastSessionList();
    return { driver: driver, worker: worker, group: result.group };
  }

  function removeCreated(session) {
    if (!session) return;
    if (typeof sm.deleteSessionQuiet === "function") {
      try { sm.deleteSessionQuiet(session.localId); return; } catch (e) {}
    }
    try { sm.sessions.delete(session.localId); } catch (e) {}
  }

  function createWorkerForDriver(driver, args) {
    // Validates the Driver's capability and the whole Worker runtime before
    // any session is made, so a rejection creates nothing.
    var runtime = preflightWorkerForDriver(driver, args);
    var ws = {
      _clayActiveSession: driver.localId,
      _clayUser: driver.ownerId ? { id: driver.ownerId } : null,
    };
    var created = createPairRecord(ws, {
      driver: { sessionId: driver.localId },
      worker: {
        vendor: runtime.vendor,
        model: runtime.model || "",
        effort: runtime.explicitEffort ? (args && args.workerEffort) || "" : "",
      },
    });
    sm.sendToSession(driver, { type: "pair_session_created", ok: true, group: created.group });
    return created;
  }

  function createPair(ws, msg) {
    try {
      var created = createPairRecord(ws, msg);
      ctx.sendTo(ws, { type: "pair_session_created", ok: true, group: created.group });
    } catch (e) {
      ctx.sendTo(ws, { type: "pair_session_created", ok: false, error: e.message || String(e) });
    }
  }

  return {
    createPair: createPair,
    createPairRecord: createPairRecord,
    createWorkerForDriver: createWorkerForDriver,
    preflightRuntime: preflightRuntime,
    preflightWorkerForDriver: preflightWorkerForDriver,
    validateModel: validateModel,
    validateVendor: validateVendor,
  };
}

module.exports = { attachPairFactory: attachPairFactory };
