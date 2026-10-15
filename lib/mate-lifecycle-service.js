var crypto = require('crypto');
function attachMateLifecycleService(ctx) {
  var busy = new Set();
  function owner(userId) {
    if (ctx.users.isMultiUser() && (!userId || !ctx.users.findUserById(userId))) throw new Error('Mate owner is unavailable.');
    return ctx.mates.buildMateCtx(ctx.users.isMultiUser() ? userId : null);
  }
  function read(userId, id) {
    var mate = ctx.mates.getMate(owner(userId), id);
    if (!mate || ctx.users.isMultiUser() && mate.createdBy !== userId) throw new Error('Mate is unavailable or belongs to another owner.');
    return mate;
  }
  function validateReceipt(userId, id, allowMissing) {
    var mate = ctx.mates.getMate(owner(userId), id);
    if (!mate && allowMissing) return;
    if (!mate || ctx.users.isMultiUser() && mate.createdBy !== userId) throw new Error('Mate receipt access changed.');
  }
  function list(userId) {
    return ctx.mates.getAllMates(owner(userId)).filter(function (mate) { return !ctx.users.isMultiUser() || mate.createdBy === userId; });
  }
  function broadcast(userId, message, ws) {
    var seen = new Set();
    function send(socket) {
      if (!socket || seen.has(socket) || socket.readyState !== 1) return;
      if (ctx.users.isMultiUser() && (!socket._clayUser || socket._clayUser.id !== userId)) return;
      seen.add(socket); socket.send(JSON.stringify(message));
    }
    send(ws);
    ctx.projects.forEach(function (project) { project.forEachClient(send); });
  }
  function update(userId, id, updates, ws, requestId) {
    var mate = read(userId, id);
    if (Object.prototype.hasOwnProperty.call(updates, 'lifecycleDeletion')) throw new Error('Mate deletion state is server-managed.');
    if (busy.has(id) || mate.lifecycleDeletion) throw new Error('Mate deletion is pending.');
    var updated = ctx.mates.updateMate(owner(userId), id, updates);
    if (!updated || updated.error) throw new Error(updated && updated.error || 'Mate not found');
    try {
      broadcast(userId, { type: 'mate_updated', mate: updated, requestId: requestId }, ws);
      if (ctx.refresh) ctx.refresh(owner(userId));
    } catch (error) { error.productControlResult = { persisted: true, retrySafe: false }; throw error; }
    return updated;
  }
  function idle(project) {
    if (!project) return;
    if (project.inspectMateLifecycleRuntime && project.inspectMateLifecycleRuntime().some(function (t) { return !t.exited; })) throw new Error('Close the Mate terminals before deletion.');
    project.getSessionManager().sessions.forEach(function (session) {
      if (session.isProcessing || session._queryStarting || session.queryInstance || session.worker || session.terminalId || session.runtimeTerminalId || Object.keys(session._mentionSessions || {}).length) throw new Error('Wait for this Mate runtime to become idle before deletion.');
    });
  }
  async function closeRuntime(slug, validate) {
    var timer;
    try {
      return await Promise.race([Promise.resolve().then(function () { if (validate) validate(true); return ctx.removeProject(slug, true); }), new Promise(function (resolve, reject) {
        timer = setTimeout(function () { reject(new Error('Mate runtime cleanup timed out; deletion remains pending.')); }, 10000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function remove(userId, id, validate, ws) {
    var mate = read(userId, id), slug = 'mate-' + id, project = ctx.projects.get(slug);
    if (mate.primary || mate.builtinKey === 'clay') throw new Error('Canonical Clay and primary Mates cannot be deleted.');
    if (busy.has(id)) throw new Error('Another Mate lifecycle operation is applying.');
    idle(project);
    if (validate) validate();
    busy.add(id);
    var persisted = false, runtimeClosed = false;
    try {
      // Retain an owner-visible tombstone until every required cleanup is acknowledged.
      if (!mate.lifecycleDeletion) mate = ctx.mates.updateMate(owner(userId), id, { lifecycleDeletion: { id: crypto.randomUUID(), runtimeRequired: !!project, runtimeClosed: !project } });
      if (!mate || mate.error) throw new Error('Could not persist the pending Mate deletion.');
      persisted = true;
      if (mate.builtinKey) ctx.users.addDeletedBuiltinKey(userId, mate.builtinKey);
      if (!project && mate.lifecycleDeletion.runtimeRequired && !mate.lifecycleDeletion.runtimeClosed) throw new Error('Runtime cleanup proof is unavailable; retain the pending deletion for operator recovery.');
      if (project && await closeRuntime(slug, validate) !== true) throw new Error('Mate runtime cleanup was not acknowledged.');
      runtimeClosed = true;
      mate = ctx.mates.updateMate(owner(userId), id, { lifecycleDeletion: Object.assign({}, mate.lifecycleDeletion, { runtimeClosed: true }) });
      if (!mate || mate.error) throw new Error('Runtime closure proof could not be saved.');
      if (validate) validate(true);
      var current = read(userId, id);
      if (!current.lifecycleDeletion || current.lifecycleDeletion.id !== mate.lifecycleDeletion.id) throw new Error('Mate deletion identity changed.');
      var result = ctx.mates.deleteMate(owner(userId), id, { strictCleanup: true });
      if (!result || !result.ok) throw new Error(result && result.error || 'Mate deletion was not persisted.');
      var definitions = require('./builtin-mates');
      var available = ctx.mates.getMissingBuiltinKeys(owner(userId)).map(function (key) { var def = definitions.getBuiltinByKey(key); return def && { key: def.key, displayName: def.displayName, bio: def.bio, avatarCustom: def.avatarCustom || '', avatarStyle: def.avatarStyle || 'imprint', avatarColor: def.avatarColor || '' }; }).filter(Boolean);
      broadcast(userId, { type: 'mate_deleted', mateId: id, availableBuiltins: available }, ws);
      if (ctx.refresh) ctx.refresh(owner(userId));
      return { persisted: true, runtimeClosed: true, directoryRemoved: true };
    } catch (error) {
      error.productControlResult = { persisted: persisted, runtimeClosed: runtimeClosed, deletionPending: !!ctx.mates.getMate(owner(userId), id), retrySafe: false };
      throw error;
    } finally { busy.delete(id); }
  }
  return { read: read, validateReceipt: validateReceipt, list: list, update: update, remove: remove };
}
module.exports = { attachMateLifecycleService: attachMateLifecycleService };
