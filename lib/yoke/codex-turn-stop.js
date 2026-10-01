// Stop only the turn owned by this query, including an in-flight turn/start.
function createTurnStop(server, onError) {
  var turnId = null;
  var threadId = null;
  var starting = false;
  var completed = false;
  var stopped = false;
  var sent = false;
  var resolveStop = null;
  var stopPromise = null;

  function settle() {
    if (resolveStop) { var resolve = resolveStop; resolveStop = null; resolve(); }
  }

  function interrupt() {
    if (!stopped || sent) return;
    if (!turnId) { if (!starting) settle(); return; }
    sent = true;
    var target = { threadId: threadId, turnId: turnId };
    Promise.resolve().then(function () {
      if (!server.started) throw new Error('Codex is disconnected; cancellation could not be confirmed.');
      return server.send('turn/interrupt', target, 5000);
    }).catch(function (error) {
      onError(error);
    }).finally(settle);
  }

  return {
    begin: function (id) { threadId = id; turnId = null; starting = true; completed = false; sent = false; },
    started: function (id) {
      if (!id || turnId || completed) return;
      turnId = id;
      starting = false;
      interrupt();
    },
    startSettled: function (id) {
      starting = false;
      if (id && !turnId && !completed) turnId = id;
      interrupt();
    },
    completed: function (id) {
      if (id && turnId && id !== turnId) return;
      turnId = null;
      completed = true;
      starting = false;
      if (!sent) settle();
    },
    abort: function () {
      if (stopPromise) return stopPromise;
      stopped = true;
      stopPromise = new Promise(function (resolve) { resolveStop = resolve; });
      interrupt();
      return stopPromise;
    },
  };
}

module.exports = { createTurnStop: createTurnStop };
