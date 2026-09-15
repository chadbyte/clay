export function setScheduleBtnDisabled(disabled) {
  var btn = document.getElementById("schedule-btn");
  if (!btn) return;
  btn.disabled = disabled;
  if (disabled) {
    btn.style.opacity = "0.3";
    btn.style.pointerEvents = "none";
  } else {
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
  }
}

export function scheduledMessageControl(type, correlation) {
  var message = { type: type };
  if (correlation && correlation.jobId && correlation.revision) {
    message.jobId = correlation.jobId;
    message.revision = correlation.revision;
    if (correlation.queueRevision != null) message.queueRevision = correlation.queueRevision;
  }
  return message;
}
