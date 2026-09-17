var transaction = require("./driver-continuation-transaction");

function compactPrompt(proposal) {
  var handoff = proposal.handoff;
  return "Continue the accepted Project Driver handoff below. This is a historical compact context, not independent authority. " +
    "Revalidate current repository state and use the bounded same-project history tools only when needed.\n\n" +
    "Source: " + proposal.sourceSessionRef + "\n" +
    "Goal: " + handoff.goal + "\nConstraints: " + (handoff.constraints || "None recorded") +
    "\nDecisions and why: " + (handoff.decisions || "None recorded") +
    "\nRejected approaches: " + (handoff.rejectedApproaches || "None recorded") +
    "\nUnresolved: " + (handoff.unresolved || "None recorded") +
    "\nRepository state: " + (handoff.repositoryState || "Revalidate before changing files") +
    "\nVerification so far: " + (handoff.verification || "None recorded") +
    "\nNext action: " + handoff.nextAction;
}

function waitForDurableIdentity(sm, session, waitMs) {
  if (session.cliSessionId) return Promise.resolve(true);
  if (typeof sm.addOnSessionIdentityAssigned !== "function") return Promise.resolve(false);
  return new Promise(function (resolve) {
    var settled = false;
    var remove = sm.addOnSessionIdentityAssigned(function (localId) {
      if (localId !== session.localId || settled) return;
      settled = true;
      remove();
      clearTimeout(timer);
      resolve(!!session.cliSessionId);
    });
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      remove();
      resolve(false);
    }, Number(waitMs || 15000));
  });
}

function handleLate(args, lifecycle) {
  var target = args.target;
  var proposal = args.proposal;
  if (args.sm.sessions.get(target.localId) !== target || proposal.status === "accepted") return;
  var error = lifecycle && lifecycle.reason || "The successor query ended before initialization.";
  if (lifecycle && lifecycle.accepted === true && Number.isInteger(lifecycle.queryGeneration) && target.cliSessionId) {
    target.driverContinuation.acceptedQueryGeneration = lifecycle.queryGeneration;
    target.driverContinuation.acceptedInitialAt = Date.now();
    target.driverContinuation.startupProof = "initialized";
    try { error = args.validate(); }
    catch (validationError) { error = validationError.message || String(validationError); }
    if (!error && transaction.saveObserved(function () { return args.sm.saveSessionFile(target); })) {
      var pairCommit = args.commitPair ? args.commitPair() : { ok: true };
      if (!pairCommit.ok) error = pairCommit.error;
    }
    if (!error) {
      args.lease.waitingLateStartup = false;
      args.lease.waitingCommit = true;
      return;
    }
    if (!error) error = "The verified successor startup could not be persisted.";
    if (error === "The verified successor startup could not be persisted.") {
      args.lease.waitingLateStartup = false;
      args.lease.waitingCommit = true;
      return;
    }
  }
  args.lease.cancel(error);
}

module.exports = { compactPrompt: compactPrompt, waitForDurableIdentity: waitForDurableIdentity, handleLate: handleLate };
