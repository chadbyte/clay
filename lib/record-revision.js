function nextRevision(record) {
  return Math.max(Date.now(), Number(record && record.updatedAt || 0) + 1);
}

function restoreRecord(record, snapshot) {
  var keys = Object.keys(record);
  for (var i = 0; i < keys.length; i++) if (!Object.prototype.hasOwnProperty.call(snapshot, keys[i])) delete record[keys[i]];
  Object.assign(record, snapshot);
}

module.exports = { nextRevision: nextRevision, restoreRecord: restoreRecord };
