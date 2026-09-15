export function scheduledTaskExecutionLabel(record) {
  if (record.activeRun) {
    if (record.activeRun.status === "needs-input") return "Needs input";
    if (record.activeRun.status === "waiting-worker") return "Waiting for Worker";
    if (record.activeRun.status === "reviewing") return "Driver reviewing";
    return "Running";
  }
  if (!record.execution) return "Needs setup";
  if (record.readiness && record.readiness.ok === false) return "Unavailable";
  return record.enabled === false ? "Paused" : "Active";
}

export function scheduledTaskOpenRunLabel(record) {
  return record.activeRun && record.activeRun.status === "needs-input" ? "Open blocked run" : "Open run";
}
