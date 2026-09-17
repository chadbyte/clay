function snapshots(changes) {
  return changes.map(function (change) {
    var values = {};
    var present = {};
    Object.keys(change.patch).forEach(function (key) {
      present[key] = Object.prototype.hasOwnProperty.call(change.target, key);
      values[key] = change.target[key];
    });
    return { target: change.target, values: values, present: present };
  });
}

function restore(items) {
  items.forEach(function (item) {
    Object.keys(item.values).forEach(function (key) {
      if (item.present[key]) item.target[key] = item.values[key];
      else delete item.target[key];
    });
  });
}

function persist(changes, save) {
  var before = snapshots(changes);
  changes.forEach(function (change) { Object.assign(change.target, change.patch); });
  try {
    if (save() !== true) {
      restore(before);
      return { ok: false, error: "Persistence returned false." };
    }
  } catch (error) {
    restore(before);
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true };
}

function accepted(sourceProposal, targetRelation) {
  return !!(sourceProposal && targetRelation && sourceProposal.status === "accepted" &&
    targetRelation.status === "accepted" && sourceProposal.transactionId &&
    sourceProposal.transactionId === targetRelation.transactionId);
}

function appendPersisted(session, event, save) {
  session.history.push(event);
  try {
    if (save() === true) return { ok: true };
  } catch (error) {
    session.history.pop();
    return { ok: false, error: error.message || String(error) };
  }
  session.history.pop();
  return { ok: false, error: "Persistence returned false." };
}

function saveObserved(save) {
  try { return save() === true; }
  catch (error) { return false; }
}

module.exports = { persist: persist, accepted: accepted, appendPersisted: appendPersisted,
  saveObserved: saveObserved };
