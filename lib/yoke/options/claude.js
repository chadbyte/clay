function map(intent) {
  var options = { settingSources: intent.instructionSources || ["user", "project", "local"], includePartialMessages: true,
    enableFileCheckpointing: true, extraArgs: { "replay-user-messages": null }, promptSuggestions: true, agentProgressSummaries: true };
  if (intent.betas && intent.betas.length) options.betas = intent.betas;
  var thinking = intent.thinking || {};
  if (thinking.mode === "disabled") options.thinking = { type: "disabled" };
  else if (thinking.mode === "budget" && thinking.budget) options.thinking = { type: "enabled", budgetTokens: thinking.budget };
  else options.thinking = { type: "adaptive", display: "summarized" };
  if (intent.disableHooks !== undefined) options.settings = { disableAllHooks: intent.disableHooks };
  options.permissionMode = intent.nativePermissionMode || "default";
  if (intent.nativeBypass && !intent.readOnly) { options.permissionMode = "bypassPermissions"; options.allowDangerouslySkipPermissions = true; }
  if (intent.readOnly) { options.permissionMode = "default"; options.allowDangerouslySkipPermissions = false; }
  if (intent.resumeAt) options.resumeSessionAt = intent.resumeAt;
  if (intent.isolation && intent.isolation.user) {
    var isolation = intent.isolation;
    Object.assign(options, { linuxUser: isolation.user, originalHome: isolation.home, singleTurn: intent.singleTurn,
      projectPath: isolation.projectPath, _perfT0: intent.startedAt, _workerState: isolation.workerState });
  }
  return { CLAUDE: options };
}
module.exports = { map: map };
