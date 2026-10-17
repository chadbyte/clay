// Product transcript slicing for providers that include a completed turn.
function endIndex(session, uuid, boundary) {
  if (boundary === undefined) return undefined;
  if (boundary !== "completed-turn-inclusive") throw new Error("Unsupported local fork history boundary");
  var history = session.history || [];
  var markers = (session.messageUUIDs || []).filter(function(marker) { return marker.uuid === uuid && marker.type === "user"; });
  var marker = markers.length === 1 && markers[0];
  var index = marker && marker.historyIndex;
  var entry = Number.isInteger(index) && history[index];
  if (!entry || entry.type !== "message_uuid" || entry.uuid !== uuid) throw new Error("Cannot safely represent this completed-turn fork boundary in local history");
  for (var i = index + 1; i < history.length; i++) {
    entry = history[i];
    if (entry.type === "user_message" || entry.type === "message_uuid" && entry.messageType === "user") break;
    if (entry.type === "done") {
      if (entry.code === 0) return i + 1;
      break;
    }
  }
  throw new Error("Cannot safely represent this completed-turn fork boundary in local history");
}
module.exports = { endIndex: endIndex };
