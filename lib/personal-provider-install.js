// Exact human-settings review, one-use receipts, and scoped installer lifecycle.
var crypto = require('crypto');
var locks = new Map();
function attach(ctx, personal) {
  var pending = new WeakMap(), running = new Map();
  function emit(ws, request, state, extra) {
    if (ws.readyState === 1) ctx.sendTo(ws, Object.assign({type:'personal_provider_install',vendor:request.vendor,personalRequestId:request.personalRequestId,state:state,requestId:request.requestId},extra || {}));
  }
  function valid(item) { return item.authority.validate() && Date.now() < item.expires; }
  function release(ws) {
    pending.delete(ws);
    var item = running.get(ws); if (item) stop(ws,item);
  }
  async function stop(ws,item) {
    if (item.stopping) return;
    item.stopping = true; clearInterval(item.timer);
    emit(ws,item.request,'stopping',{message:'Stopping the installation terminal…'});
    try {
      await ctx.tm.closeAndWait(item.terminal.id,{identity:item.terminal.identity,revalidate:function () { if (running.get(ws) !== item) throw new Error('Installation terminal changed.'); }});
      emit(ws,item.request,'stopped',{message:'Installation terminal exited. Partial files may remain. Refresh status before explicitly reviewing another attempt.'});
      locks.delete(item.key); running.delete(ws);
    } catch(error) {
      // Keep the lock: an uncertain effect must never be replayed automatically.
      emit(ws,item.request,'unknown',{message:'Terminal shutdown could not be confirmed. Ask the server operator to inspect it before trying again.'});
    }
  }
  function handle(ws,msg) {
    if (typeof msg.type !== 'string' || msg.type.indexOf('personal_provider_install_') !== 0) return false;
    try {
      if (msg.type === 'personal_provider_install_stop') {
        var active = running.get(ws);
        if (active && active.request.personalRequestId === msg.personalRequestId && active.request.vendor === msg.vendor) stop(ws,active);
        return true;
      }
      if (msg.type === 'personal_provider_install_cancel') {
        var review = pending.get(ws);
        if (review && review.token === msg.reviewId && review.request.personalRequestId === msg.personalRequestId && review.request.vendor === msg.vendor) pending.delete(ws);
        return true;
      }
      if (msg.type === 'personal_provider_install_review') {
        if (running.has(ws)) throw new Error('An installation is already running or its result is uncertain.');
        var authority = personal.resolveInstall(ws,msg);
        var key = JSON.stringify([authority.runtime.uid,authority.runtime.home,msg.vendor]);
        if (locks.has(key)) throw new Error('An installation for this runtime account is already running or needs inspection.');
        var item = {authority:authority,key:key,request:{vendor:msg.vendor,personalRequestId:msg.personalRequestId,requestId:msg.requestId},token:crypto.randomUUID(),expires:Date.now()+120000};
        pending.set(ws,item);
        emit(ws,msg,'review',{reviewId:item.token,command:authority.recipe.command,source:authority.recipe.source,effects:authority.recipe.effects,runtime:authority.runtime,message:'Review this exact installation. Review expires in two minutes; leaving settings cancels it.'});
        return true;
      }
      if (msg.type === 'personal_provider_install_start') {
        var item = pending.get(ws); pending.delete(ws);
        if (!item || item.token !== msg.reviewId || item.request.vendor !== msg.vendor || item.request.personalRequestId !== msg.personalRequestId || !valid(item) || locks.has(item.key)) throw new Error('Installation review expired, changed or was already used. Refresh status and review again.');
        var fresh = personal.resolveInstall(ws,msg);
        if (fresh.recipe !== item.authority.recipe || JSON.stringify(fresh.runtime) !== JSON.stringify(item.authority.runtime)) throw new Error('Installation target changed.');
        item.request.requestId = msg.requestId;
        locks.set(item.key,item); running.set(ws,item);
        var terminal;
        try {
          terminal = ctx.tm.create(100,24,item.authority.runtime,ws,{kind:'provider-install',title:'Install '+msg.vendor,providerInstall:msg.vendor,
            revalidateInstall:function () { if (!valid(item) || running.get(ws) !== item || locks.get(item.key) !== item) throw new Error('Installation permission or identity changed.'); },
            onExit:function (session) {
              if (item.stopping || running.get(ws) !== item) return;
              clearInterval(item.timer); running.delete(ws); locks.delete(item.key);
              if (!valid(item)) { emit(ws,item.request,'unknown',{message:'Installation terminal exited after account context changed. Refresh status; no task was replayed.'}); return; }
              var installed = null;
              try { installed = !!require('./yoke/vendor-registry').getVendorInfo(msg.vendor).resolveExecutable({user:item.authority.identity.linuxUser}); } catch(error) {}
              if (!valid(item)) { emit(ws,item.request,'unknown',{message:'Installation discovery ended after account context changed. Refresh status before continuing.'}); return; }
              emit(ws,item.request,session.exitCode === 0 ? 'completed' : 'failed',{installed:installed,exitCode:session.exitCode,message:session.exitCode === 0 ? (installed === null ? 'Installer exited successfully, but runtime discovery is unavailable. Refresh status to check the installation.' : installed ? 'Installer exited successfully; runtime discovery now finds this provider. Authentication remains unknown.' : 'Installer exited successfully, but runtime discovery has not found the provider. Check ~/.local/bin on the runtime PATH and refresh status.') : 'Installer did not report success. Refresh status and inspect the runtime setup before explicitly reviewing another attempt.'});
            }});
          if (!terminal) throw new Error('The installation terminal could not be created.');
          item.terminal = terminal;
          // Review expiry bounds launch, not a running install. Authority stays live.
          item.expires = Infinity;
          item.timer = setInterval(function () { if (!valid(item)) stop(ws,item); },250);
          item.timer.unref();
          emit(ws,msg,'started',{message:'Installation started in the reviewed runtime account. Waiting for terminal exit; downloads may be quiet.'});
        } catch(error) { emit(ws,item.request,'unknown',{message:'Installation launch could not be confirmed. Ask the server operator to inspect the runtime before retrying.'}); }
        return true;
      }
      throw new Error('Unsupported installation operation.');
    } catch(error) { emit(ws,msg,'refused',{message:error.message}); return true; }
  }
  return {handle:handle,release:release,destroy:function () { pending = new WeakMap(); running.forEach(function(item,ws){stop(ws,item);}); }};
}
module.exports = {attach:attach};
