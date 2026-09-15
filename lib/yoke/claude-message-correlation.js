// Match merged Claude replies to the messages admitted by this query.
var crypto = require("crypto");

function createCorrelation() {
  var pending = new Set();
  var submitted = 0;
  return {
    message: function(content) {
      return { type: "user", uuid: crypto.randomUUID(), message: { role: "user", content: content } };
    },
    accepted: function(message) { pending.add(message.uuid); submitted++; },
    submitted: function() { return submitted; },
    result: function(raw, event) {
      if (raw.type !== "result") return event;
      event.submittedMessageCount = submitted;
      var ids = Array.isArray(raw.user_message_uuids) ? raw.user_message_uuids : [];
      if (raw.user_message_uuid) ids = ids.concat(raw.user_message_uuid);
      var matched = 0;
      ids.forEach(function(id) {
        if (pending.delete(id)) matched++;
      });
      // Only count UUIDs admitted by this query, once each. Older providers
      // without correlation fields retain the bridge's legacy accounting.
      if (matched) event.answeredUserMessageCount = matched;
      else if (!ids.length && pending.size) pending.delete(pending.values().next().value);
      return event;
    },
  };
}

module.exports = { createCorrelation: createCorrelation };
