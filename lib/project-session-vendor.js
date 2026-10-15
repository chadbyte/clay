var yoke = require('./yoke');
function attachSessionVendor(ctx) {
  function verifyIdentity(session, vendor) {
    if (!ctx.osUsers) return;
    var info = yoke.getVendorInfo(vendor), linuxUser = ctx.getLinuxUserForSession(session);
    if (!info || !info.osUserIsolation || !linuxUser) throw new Error('The provider requires an authorized mapped OS identity.');
    var identity = require('./os-users').resolveOsUserInfo(linuxUser);
    if (!Number.isInteger(identity.uid) || identity.uid < 0 || !Number.isInteger(identity.gid) || identity.gid < 0) throw new Error('The mapped OS identity is unavailable.');
  }
  function setVendor(session, vendor, revalidate) {
    if (!session || ctx.sm.sessions.get(session.localId) !== session) throw new Error('The Driver was deleted or replaced.');
    if (revalidate) revalidate();
    if (!(ctx.adapters || {})[vendor] || (ctx.sm.availableVendors || []).indexOf(vendor) < 0) throw new Error('This provider is unavailable in the project runtime.');
    verifyIdentity(session, vendor);
    if (session.cliSessionId || session.queryInstance || session.isProcessing || session._queryStarting || (session.history || []).length || (session.runtimeMode || session.mode || 'gui') !== 'gui') throw new Error('Provider selection requires a fresh idle GUI Driver without a provider thread or transcript.');
    if (session.taskStopRequested || session._pendingMessageDrainPaused || ctx.isPendingQueuePaused && ctx.isPendingQueuePaused(session)) throw new Error('A stopped Driver requires an explicit separate resume action.');
    var previous = { vendor: session.vendor, model: session.model, effort: session.effort, permissionMode: session.permissionMode, effectivePermissionMode: session.effectivePermissionMode };
    session.vendor = vendor;
    session.model = null;
    session.effort = yoke.clampEffort(vendor, session.effort) || null;
    var modes = yoke.sessionTools.contract(ctx.adapters[vendor]).permissionModes;
    if (session.permissionMode === 'auto' && (!Array.isArray(modes) || modes.indexOf('auto') < 0)) session.permissionMode = 'default';
    session.effectivePermissionMode = null;
    try { if (ctx.sm.saveSessionFile(session) !== true) throw new Error('Could not persist the provider selection.'); }
    catch (error) { Object.assign(session, previous); throw error; }
    try {
      ctx.sm.broadcastSessionList();
      ctx.sm.sendToSession(session, { type: 'model_info', vendor: vendor, sessionId: session.localId, model: '', models: (ctx.sm.modelsByVendor || {})[vendor] || [], availableVendors: ctx.sm.availableVendors || [], installedVendors: ctx.sm.installedVendors || [] });
      ctx.sm.sendToSession(session, { type: 'config_state', vendor: vendor, sessionId: session.localId, model: '', effort: session.effort, mode: session.permissionMode || ctx.sm.currentPermissionMode || 'default' });
    } catch (error) { return { status: 'failed', outcome: 'partial', persisted: true, runtimeEffect: 'none', vendor: vendor, error: 'Provider selection saved, but publication failed: ' + error.message }; }
    return { status: 'completed', persisted: true, runtimeEffect: 'none', vendor: vendor };
  }
  function newSession(source, vendor, revalidate) {
    revalidate();
    if (!(ctx.adapters || {})[vendor] || (ctx.sm.availableVendors || []).indexOf(vendor) < 0) throw new Error('This provider is unavailable in the project runtime.');
    if (source.isProcessing || source._queryStarting || source.taskStopRequested || source._pendingMessageDrainPaused || ctx.isPendingQueuePaused && ctx.isPendingQueuePaused(source)) throw new Error('Create a replacement provider session only from an idle, unstopped Driver.');
    verifyIdentity(source, vendor);
    revalidate();
    var created = ctx.sm.createSessionRaw({ ownerId: source.ownerId || null, vendor: vendor, mode: 'gui', sessionVisibility: 'private' });
    var ref = require('./workspace-query-service').sessionRef(ctx.slug, created), persisted = false;
    try {
      revalidate();
      if (ctx.sm.saveSessionFile(created) !== true) throw new Error('Could not save the new provider session.');
      persisted = true;
      revalidate();
      ctx.sm.broadcastSessionList();
      return { status: 'completed', persisted: true, newSessionRef: ref, vendor: vendor, threadMigrated: false, originalRetained: true, executionStarted: false };
    } catch (error) {
      error.productControlResult = { status: 'failed', outcome: 'partial', persisted: persisted, retainedInMemory: true, newSessionRef: ref, threadMigrated: false, originalRetained: true, executionStarted: false, retrySafe: false };
      throw error;
    }
  }
  return { setVendor: setVendor, newSession: newSession };
}
module.exports = { attachSessionVendor: attachSessionVendor };
