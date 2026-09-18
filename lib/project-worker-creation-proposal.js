var crypto = require("crypto");
var driverEligibility = require("./session-driver-eligibility");
var multiWorkerFeature = require("./multi-worker-feature");
var proposalControl = require("./worker-proposal-control");
var splitRoles = require("./session-split-group-roles");

function generationOf(session) {
  return session && (session._pairGeneration ||
    session.sessionProvenance && session.sessionProvenance.generation) || null;
}

function captureMembership(sm, driver, group) {
  var roles = splitRoles.resolveLiveRoles(sm, group);
  if (!roles || roles.driver !== driver || roles.role.kind === "adhoc" || !driver.sessionOriginId) return null;
  var workers = [];
  for (var i = 0; i < roles.workers.length; i++) {
    if (!roles.workers[i].sessionOriginId || !Number.isInteger(generationOf(roles.workers[i]))) return null;
    workers.push({ id: roles.workers[i].localId, originId: roles.workers[i].sessionOriginId,
      generation: generationOf(roles.workers[i]) });
  }
  return { groupId: group.id, ownerId: driver.ownerId || null, driverId: driver.localId,
    driverOriginId: driver.sessionOriginId, workerIds: roles.role.workerIds.slice(), workers: workers };
}

function matchesMembership(sm, driver, group, snapshot) {
  if (!snapshot || !driver || !group || group.id !== snapshot.groupId || driver.localId !== snapshot.driverId ||
      (driver.ownerId || null) !== snapshot.ownerId || driver.sessionOriginId !== snapshot.driverOriginId) return false;
  var current = captureMembership(sm, driver, group);
  if (!current || current.workerIds.join(",") !== snapshot.workerIds.join(",")) return false;
  for (var i = 0; i < current.workers.length; i++) {
    var expected = snapshot.workers[i];
    if (!expected || current.workers[i].id !== expected.id || current.workers[i].originId !== expected.originId ||
        current.workers[i].generation !== expected.generation) return false;
  }
  return true;
}

function attachWorkerCreationProposal(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;

  function initialSnapshot(session) {
    if (!ctx.canOffer(session)) return { error: "Split Worker proposals require an eligible Driver session." };
    var group = store.groupForMember(session.localId);
    if (!group) return { kind: "initial", driver: session };
    if (!multiWorkerFeature.isEnabled(ctx.multiWorkerFeature)) {
      return { error: "This Driver already has a Split Worker." };
    }
    var roles = splitRoles.resolveLiveRoles(sm, group);
    if (!roles || roles.driver !== session || roles.role.kind === "adhoc") {
      return { error: "The exact Driver/Split Worker membership is not eligible for another Worker." };
    }
    if (roles.workers.length >= 2) return { error: "A Driver can have at most two Split Workers." };
    if (roles.workers.length !== 1) return { error: "The existing Split Worker membership is invalid." };
    if (!session.sessionOriginId || !roles.workers[0].sessionOriginId || !Number.isInteger(generationOf(roles.workers[0]))) {
      return { error: "The exact Driver and Split Worker identities are not durable enough to add another Worker." };
    }
    return {
      kind: "add",
      group: group,
      groupId: group.id,
      ownerId: session.ownerId || null,
      driverId: session.localId,
      driverOriginId: session.sessionOriginId || null,
      workerIds: roles.role.workerIds.slice(),
      workers: roles.workers.map(function (worker) {
        return { id: worker.localId, originId: worker.sessionOriginId || null, generation: generationOf(worker) };
      }),
    };
  }

  function validateSnapshot(session, snapshot, requireSameObject) {
    if (!snapshot || snapshot.kind === "initial") {
      return ctx.isEligible(session) ? { ok: true, group: null } : { ok: false };
    }
    if (!multiWorkerFeature.isEnabled(ctx.multiWorkerFeature) || !ctx.canOffer(session) ||
        (session.ownerId || null) !== snapshot.ownerId || session.localId !== snapshot.driverId ||
        (session.sessionOriginId || null) !== snapshot.driverOriginId) return { ok: false };
    var group = store.groupForMember(session.localId);
    if (!group || group.id !== snapshot.groupId || requireSameObject && group !== snapshot.group) return { ok: false };
    var roles = splitRoles.resolveLiveRoles(sm, group);
    if (!roles || roles.role.kind === "adhoc" || roles.driver !== session || roles.role.workerIds.length !== 1 ||
        roles.role.workerIds.join(",") !== snapshot.workerIds.join(",")) return { ok: false };
    for (var i = 0; i < snapshot.workers.length; i++) {
      var expected = snapshot.workers[i];
      var worker = sm.sessions.get(expected.id);
      if (!worker || roles.workers.indexOf(worker) === -1 ||
          (worker.ownerId || null) !== snapshot.ownerId ||
          (worker.sessionOriginId || null) !== expected.originId || generationOf(worker) !== expected.generation) {
        return { ok: false };
      }
    }
    return { ok: true, group: group, roles: roles };
  }

  function snapshotFromProposal(proposal) {
    if (!proposal || proposal.action !== "add") return { kind: "initial" };
    return {
      kind: "add",
      groupId: proposal.sourceGroupId,
      ownerId: proposal.sourceOwnerId || null,
      driverId: proposal.sourceDriverId,
      driverOriginId: proposal.sourceDriverOriginId || null,
      workerIds: Array.isArray(proposal.sourceWorkerIds) ? proposal.sourceWorkerIds.slice() : [],
      workers: Array.isArray(proposal.sourceWorkers) ? proposal.sourceWorkers.slice() : [],
    };
  }

  async function propose(args, session) {
    var snapshot = initialSnapshot(session);
    if (snapshot.error) return ctx.toolResult({ error: snapshot.error });
    var superseded = proposalControl.pendingProposal(session);
    var supersedeId = typeof args.supersedeProposalId === "string" ? args.supersedeProposalId.trim() : "";
    if (superseded && superseded.proposalId !== supersedeId) return ctx.toolResult({ error: "A Split Worker suggestion is already awaiting a decision. Inspect it or supply its exact id to supersede it." });
    if (!superseded && supersedeId) return ctx.toolResult({ error: "The Split Worker suggestion to supersede is no longer pending." });
    if (superseded && superseded.status !== "pending") return ctx.toolResult({ error: "The Split Worker suggestion is already starting and cannot be superseded." });
    var summary = typeof args.summary === "string" ? args.summary.trim() : "";
    var plan = typeof args.plan === "string" ? args.plan.trim() : "";
    var task = typeof args.message === "string" ? args.message.trim() : "";
    var rationale = typeof args.recommendationRationale === "string" ? args.recommendationRationale.trim() : "";
    if (!summary || !plan || !task || !rationale) return ctx.toolResult({ error: "summary, plan, message, and recommendationRationale are required." });
    if (task.length > ctx.maxTaskChars) return ctx.toolResult({ error: "The Split Worker task is too long." });
    await ctx.ensureModelCatalogs();
    if (!validateSnapshot(session, snapshot, true).ok) {
      return ctx.toolResult({ error: "The Driver/Split Worker membership changed while runtimes were loading." });
    }
    if (proposalControl.pendingProposal(session) !== superseded) return ctx.toolResult({ error: "The pending Split Worker suggestion changed while runtimes were loading." });
    var options = ctx.proposalOptions();
    if (options.installedVendors.length === 0) return ctx.toolResult({ error: "No coding agent is installed for a Split Worker session." });
    var recommendation = ctx.chooseRecommendation(args, session, options);
    var proposal = {
      type: "worker_proposal", proposalId: "worker_" + crypto.randomUUID(),
      summary: summary.slice(0, ctx.maxSummaryChars), plan: plan.slice(0, ctx.maxPlanChars), message: task,
      status: "pending", createdAt: Date.now(), recommendedVendor: recommendation.vendor,
      recommendedModel: recommendation.model, recommendedEffort: recommendation.effort,
      recommendationRationale: rationale.slice(0, ctx.maxRationaleChars), options: options,
    };
    if (snapshot.kind === "add") Object.assign(proposal, {
      action: "add", sourceGroupId: snapshot.groupId, sourceOwnerId: snapshot.ownerId,
      sourceDriverId: snapshot.driverId, sourceDriverOriginId: snapshot.driverOriginId,
      sourceWorkerIds: snapshot.workerIds.slice(), sourceWorkers: snapshot.workers.slice(),
    });
    if (superseded) ctx.updateProposal(session, superseded, { status: "superseded", supersededBy: proposal.proposalId });
    sm.sendAndRecord(session, proposal);
    if (ctx.skipPermissionsEnabled(session) && ctx.recommendationCanAutoAccept(args, recommendation, options)) {
      var accepted = await ctx.acceptProposal(session, proposal, {
        vendor: recommendation.vendor, model: recommendation.model, effort: recommendation.effort,
      }, ctx.autoAcceptanceWs(session), true);
      return ctx.toolResult({ status: accepted.ok ? "auto_accepted" : "posted", proposalId: proposal.proposalId,
        instruction: accepted.ok ? "The recorded Split Worker configuration was auto-accepted. End this turn while the exact Worker runs." :
          "The automatic decision failed closed. The configuration card remains pending for the user." });
    }
    return ctx.toolResult({ status: "posted", proposalId: proposal.proposalId,
      instruction: "The Split Worker suggestion is visible in the chat. End this turn now and wait for the user's decision." });
  }

  function canMountProposal(session) {
    if (!ctx.canOffer(session)) return false;
    var group = store.groupForMember(session.localId);
    if (!group) return true;
    if (!multiWorkerFeature.isEnabled(ctx.multiWorkerFeature)) return false;
    var roles = splitRoles.resolveLiveRoles(sm, group);
    return !!roles && roles.role.kind !== "adhoc" && roles.driver === session;
  }

  return {
    propose: propose,
    canMountProposal: canMountProposal,
    validateAcceptance: function (session, proposal) {
      return validateSnapshot(session, snapshotFromProposal(proposal), false);
    },
  };
}

module.exports = { attachWorkerCreationProposal: attachWorkerCreationProposal,
  captureMembership: captureMembership, matchesMembership: matchesMembership };
