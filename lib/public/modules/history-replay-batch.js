import { store } from './store.js';

// Recovery bounds for a replay whose history_done never arrives. Either limit
// restores everything received so far and lets later messages through, so a
// lost terminator cannot capture live output indefinitely.
export var HISTORY_REPLAY_TIMEOUT_MS = 20000;
export var HISTORY_REPLAY_MAX_EVENTS = 200000;
export var HISTORY_REPLAY_MAX_TEXT = 16 * 1024 * 1024;
var MAX_LOGGED_FAILURES = 5;

function cancelTimer(batch) {
  if (batch && batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
}

export function resetHistoryReplayBatch() {
  cancelTimer(store.get('historyReplayBatch'));
  store.set({ historyReplayBatch: null, replayingHistory: false });
}

function canCombine(previous, message) {
  if (!previous || previous.type !== message.type || typeof previous.text !== 'string' || typeof message.text !== 'string') return false;
  if (message.type !== 'delta' && message.type !== 'thinking_delta') return false;
  // Keep identity/metadata boundaries intact. Timestamps on individual tokens
  // can differ; the first token still supplies the message's display time.
  var keys = Object.keys(previous).concat(Object.keys(message));
  return keys.every(function (key) {
    return key === 'text' || key === '_ts' || previous[key] === message[key];
  });
}

function finishText(batch) {
  if (!batch.textParts) return;
  batch.items[batch.items.length - 1].text = batch.textParts.join('');
  batch.textParts = null;
}

// Diagnostics name the entry type and code location only. Error messages
// can quote transcript content, so the message and the stack header that
// repeats it are never logged; only a strictly parsed frame location is.
var STACK_FRAME = /^\s*(?:at\s+(?:[^\s(]+\s+\()?|[^\s@]*@)((?:https?|file|blob):\/\/[^\s()]+):(\d+):(\d+)\)?\s*$/;

function frameLocation(err) {
  if (!err || typeof err.stack !== 'string') return '';
  var stack = err.stack;
  var name = typeof err.name === 'string' ? err.name : '';
  var message = typeof err.message === 'string' ? err.message : '';
  var header = message ? name + ': ' + message : name;
  if (header && stack.indexOf(header) === 0) stack = stack.slice(header.length);
  var lines = stack.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var match = STACK_FRAME.exec(lines[i]);
    if (match) return ' at ' + match[1].split(/[?#]/)[0].split('/').pop().slice(0, 80) + ':' + match[2] + ':' + match[3];
  }
  return '';
}

function describeFailure(msg, err) {
  var type = msg && typeof msg.type === 'string' ? msg.type.slice(0, 64) : 'unknown';
  var name = err && typeof err.name === 'string' && /^[A-Za-z]{1,64}$/.test(err.name) ? err.name : 'Error';
  return type + ' entry failed with ' + name + frameLocation(err);
}

function deliver(batch, done, dispatch) {
  cancelTimer(batch);
  finishText(batch);
  if (store.get('historyReplayBatch') === batch) store.set({ historyReplayBatch: null });
  var entries = batch.items.concat([done]);
  var failures = 0;
  try {
    // Each entry is isolated like a separate socket message: one bad record
    // must not discard the rest of the transcript or history_done cleanup.
    for (var i = 0; i < entries.length; i++) {
      try {
        dispatch(entries[i]);
      } catch (err) {
        failures++;
        if (failures <= MAX_LOGGED_FAILURES) {
          console.error('[history-replay] Restored history ' + (i + 1) + '/' + entries.length + ': ' + describeFailure(entries[i], err));
        }
      }
    }
    if (failures > MAX_LOGGED_FAILURES) {
      console.error('[history-replay] ' + (failures - MAX_LOGGED_FAILURES) + ' more restored history failures were not logged.');
    }
  } finally {
    store.set({ replayingHistory: false });
  }
}

function recover(batch, reason, dispatch) {
  if (store.get('historyReplayBatch') !== batch) return;
  console.warn('[history-replay] history_done missing after ' + batch.received + ' events (' + reason + '); restoring received history.');
  deliver(batch, { type: 'history_done', replayRecovered: true }, dispatch);
}

// WebSocket history arrives across many browser tasks. Collect it before
// calling the normal handlers so the browser cannot paint intermediate tools,
// Thinking segments or old answers between those tasks.
export function receiveHistoryReplay(msg, dispatch) {
  if (msg.type === 'session_switched' || msg.type === 'project_info') resetHistoryReplayBatch();
  if (msg.type === 'history_meta') {
    cancelTimer(store.get('historyReplayBatch'));
    var started = { items: [msg], textParts: null, received: 1, text: 0, timer: null };
    started.timer = setTimeout(function () { recover(started, 'timeout', dispatch); }, HISTORY_REPLAY_TIMEOUT_MS);
    store.set({ historyReplayBatch: started });
    return;
  }
  var batch = store.get('historyReplayBatch');
  if (!batch) {
    dispatch(msg);
    return;
  }
  if (msg.type === 'history_done') {
    deliver(batch, msg, dispatch);
    return;
  }
  batch.received++;
  if (typeof msg.text === 'string') batch.text += msg.text.length;
  var previous = batch.items[batch.items.length - 1];
  if (canCombine(previous, msg)) {
    if (!batch.textParts) batch.textParts = [previous.text];
    batch.textParts.push(msg.text);
  } else {
    finishText(batch);
    batch.items.push(Object.assign({}, msg));
  }
  if (batch.received >= HISTORY_REPLAY_MAX_EVENTS || batch.text >= HISTORY_REPLAY_MAX_TEXT) recover(batch, 'size', dispatch);
}
