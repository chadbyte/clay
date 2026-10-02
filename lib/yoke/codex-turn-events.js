// A resumed thread can still deliver notifications from its previous turn.
// Only turn/start's response authorizes tagged output for this query's turn.
function createTurnEvents(deliver) {
  var active = false;
  var starting = false;
  var turnId = null;
  var pending = [];
  function idOf(message) {
    var params = message.params || {};
    return params.turnId || params.turn_id || (params.turn && params.turn.id) || null;
  }
  return {
    begin: function () { active = true; starting = true; turnId = null; pending = []; },
    accept: function (message) {
      var id = idOf(message);
      var scoped = id || /^(turn\/|item\/)/.test(message.method || '');
      if (!scoped) return true;
      if (!active) return false;
      if (starting && id) { pending.push(message); return false; }
      return !id || !turnId || id === turnId;
    },
    ready: function (id) {
      turnId = id;
      starting = false;
      var buffered = pending;
      pending = [];
      buffered.forEach(function (message) { deliver(message); });
    },
    finish: function () { active = false; starting = false; pending = []; },
  };
}
module.exports = { createTurnEvents: createTurnEvents };
