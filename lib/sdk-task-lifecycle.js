function clearAll(session) {
  session.activeTaskToolIds = {};
  session.taskIdMap = {};
}

function clearForeground(session) {
  var backgroundIds = {};
  var backgroundTasks = Array.isArray(session.activeBackgroundTasks) ? session.activeBackgroundTasks : [];
  for (var i = 0; i < backgroundTasks.length; i++) {
    if (backgroundTasks[i] && backgroundTasks[i].task_id) backgroundIds[backgroundTasks[i].task_id] = true;
  }

  var keptTaskIds = {};
  var keptToolIds = {};
  var taskIdMap = session.taskIdMap || {};
  for (var parentToolId in taskIdMap) {
    var taskId = taskIdMap[parentToolId];
    if (!backgroundIds[taskId]) continue;
    keptTaskIds[parentToolId] = taskId;
    if (session.activeTaskToolIds && session.activeTaskToolIds[parentToolId]) keptToolIds[parentToolId] = true;
  }
  session.activeTaskToolIds = keptToolIds;
  session.taskIdMap = keptTaskIds;
}

function finish(session, parentToolId, taskId) {
  var parentId = parentToolId || null;
  var matched = false;

  if (parentId && session.activeTaskToolIds && session.activeTaskToolIds[parentId]) {
    matched = true;
    delete session.activeTaskToolIds[parentId];
  }
  if (parentId && session.taskIdMap && session.taskIdMap[parentId]) {
    matched = true;
    delete session.taskIdMap[parentId];
  }

  if (taskId && session.taskIdMap) {
    for (var key in session.taskIdMap) {
      if (session.taskIdMap[key] !== taskId) continue;
      matched = true;
      delete session.taskIdMap[key];
      if (session.activeTaskToolIds) delete session.activeTaskToolIds[key];
      if (!parentId) parentId = key;
    }
  }

  return { matched: matched, parentToolId: parentId };
}

module.exports = { clearAll: clearAll, clearForeground: clearForeground, finish: finish };
