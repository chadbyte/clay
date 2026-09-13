import { store } from './store.js';

function correlation(message) {
  if (!message || !message.jobId || !message.revision) return null;
  return { jobId: message.jobId, revision: message.revision };
}

function sameCorrelation(left, right) {
  return !!left && !!right && left.jobId === right.jobId && left.revision === right.revision;
}

export function applyScheduledMessageQueued(message, actions) {
  store.set({ scheduledMessageCorrelation: correlation(message) });
  actions.add(message.text, message.resetsAt, message);
  actions.setDisabled(true);
}

export function applyScheduledMessageTerminal(message, actions) {
  var current = store.get('scheduledMessageCorrelation');
  if (current && !sameCorrelation(current, correlation(message))) return false;
  store.set({ scheduledMessageCorrelation: null });
  actions.remove();
  actions.setDisabled(false);
  return true;
}

export function applyScheduledMessageState(message, actions) {
  actions.remove();
  actions.setDisabled(false);
  var pending = message && message.scheduledMessage;
  store.set({ scheduledMessageCorrelation: correlation(pending) });
  if (!pending && message && message.interrupted && actions.interrupted) actions.interrupted(message.interrupted);
  if (!pending) return false;
  actions.add(pending.text, pending.resetsAt, pending);
  actions.setDisabled(true);
  return true;
}

export function scheduledMessageControl(type, correlation) {
  var message = { type: type };
  if (correlation && correlation.jobId && correlation.revision) {
    message.jobId = correlation.jobId;
    message.revision = correlation.revision;
  }
  return message;
}
