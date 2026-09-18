var driverEligibility = require("./session-driver-eligibility");
var driverOrchestration = require("./session-driver-orchestration");
var prompts = require("./session-pair-prompts");

function attachSessionPairPrompt(ctx) {
  function getSystemPrompt(session) {
    var roles = ctx.rolesFor(session);
    if (roles && roles.workers.indexOf(session) !== -1) {
      var taskId = session._pairDelegation && session._pairDelegation.taskId || "unknown";
      return prompts.worker(taskId);
    }
    var group = ctx.store.groupForMember(session.localId);
    var result = "";
    if (group && group.pair && group.pair.driverId === session.localId) {
      result = prompts.DRIVER_CORE + " " + ctx.workerProposal().getSystemPrompt(session);
      if (driverOrchestration.isHighTierDriverSession(session, ctx.sm)) result += " " + prompts.DRIVER_DELEGATION;
    } else if (!group && !ctx.isMate && driverEligibility.isEligibleDriverSession(session, ctx.sm) &&
        driverOrchestration.isHighTierDriverSession(session, ctx.sm)) {
      result = prompts.UNPAIRED + " " + ctx.workerProposal().getSystemPrompt(session);
    }
    return result;
  }
  return { getSystemPrompt: getSystemPrompt };
}

module.exports = { attachSessionPairPrompt: attachSessionPairPrompt };
