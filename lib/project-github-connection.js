// Human-only Personal Integrations flow, bound to live account and runtime identity.
var crypto = require('crypto'), os = require('os');
var runtime = require('./github-runtime');
var LOGIN_ARGS = ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https', '--skip-ssh-key'];
function attach(ctx) {
  var drafts = new Map(), flows = new Map(), watched = new WeakSet();
  function actor(ws) {
    if (ws && ws._clayAuthCheck && !ws._clayAuthCheck()) throw new Error('Sign in again to manage GitHub.');
    if (!ws || ws.readyState !== 1 || !ctx.clients.has(ws) || ws._clayPane || ws._clayPaneActivation || !ctx.requestAccess.canAccessProject(ws, ctx.slug)) throw new Error('Reopen Personal settings in your connected workspace.');
    var user = ws._clayUser && ctx.usersModule.findUserById(ws._clayUser.id);
    if (ctx.usersModule.isMultiUser() && !user || ws._clayUser && !user) throw new Error('This account is no longer available.');
    if (!ctx.requestAccess.hasPermission(ws, 'terminal')) throw new Error('Terminal permission is required to inspect or connect GitHub.');
    var identity = ctx.osUsers ? user && user.linuxUser && ctx.resolveOsUserInfo(user.linuxUser) : null;
    if (ctx.osUsers && (!identity || !identity.user || !identity.home || !Number.isInteger(identity.uid) || !Number.isInteger(identity.gid))) throw new Error('Your mapped OS account is unavailable.');
    var info = os.userInfo(), env = runtime.environment(identity);
    return { owner: user ? String(user.id) : 'default', user: user ? JSON.stringify(user) : null, identity: identity,
      shared: !identity, canLogin: !!identity || !user || user.role === 'admin',
      runtime: identity || { user: info.username, uid: info.uid, gid: info.gid, home: env.HOME }, binding: runtime.binding(identity) };
  }
  function valid(ws, item) {
    if (!item) return false;
    try { return drafts.get(ws) === item && JSON.stringify(actor(ws)) === item.signature && (!item.expires || Date.now() < item.expires); } catch (error) { return false; }
  }
  function send(ws, request, value) {
    if (ws.readyState === 1) ctx.sendTo(ws, Object.assign({type:'personal_github', requestId:request.requestId, contextId:request.contextId}, value));
  }
  function requireCurrent(ws, item) { if (!valid(ws, item)) throw new Error('GitHub account context changed. Refresh before continuing.'); }
  function snapshot(item, state, extra) {
    return Object.assign({state:state, saved:ctx.storage.read(item.actor.owner), observed:item.observed || null,
      runtime:Object.assign({shared:item.actor.shared},item.actor.runtime), canLogin:item.actor.canLogin && !(item.observed && item.observed.overridden), reviewId:item.reviewId},extra || {});
  }
  function releaseLock(item) { if (item.unlock) { item.unlock(); item.unlock = null; } }
  async function stop(ws, item) {
    if (item.stopping) return;
    item.stopping = true; item.reviewId = null;
    send(ws,item.request,{state:'stopping',message:'Waiting for the GitHub login terminal to exit…'});
    clearInterval(item.timer);
    try {
      if (!item.terminal) throw new Error('Launch outcome is unknown.');
      await ctx.tm.closeAndWait(item.terminal.id,{identity:item.terminal.identity,revalidate:function () {
        if (flows.get(ws) !== item) throw new Error('The login terminal changed.');
      }});
      flows.delete(ws); releaseLock(item); drafts.delete(ws);
      send(ws,item.request,{state:'stopped',message:'Login terminal exited. GitHub CLI credentials may have changed; refresh before another explicit attempt. Your saved Clay Studio connection was retained.'});
    } catch (error) {
      send(ws,item.request,{state:'unknown',message:'Terminal shutdown could not be confirmed. Ask the server operator to inspect this login before retrying. No attempt will replay automatically.'});
    }
  }
  function release(ws) {
    var flow = flows.get(ws);
    if (flow) { drafts.delete(ws); stop(ws,flow); }
    else drafts.delete(ws);
  }
  function sameAccount(left,right) { return !!left && !!right && left.id === right.id && left.login === right.login && left.host === right.host; }
  async function inspect(ws,item) {
    var observed = await runtime.inspect(item.actor.identity,ctx.execute);
    requireCurrent(ws,item); item.observed = observed;
    item.reviewId = crypto.randomUUID(); item.expires = Date.now()+120000;
    item.saved = ctx.storage.read(item.actor.owner);
    send(ws,item.request,snapshot(item,'ready'));
  }
  async function run(ws,msg) {
    if (msg.type === 'personal_github_release' || msg.type === 'personal_github_stop') {
      var active = drafts.get(ws) || flows.get(ws);
      if (active && active.request.contextId === msg.contextId) release(ws);
      return;
    }
    if (msg.type === 'personal_github_get') {
      if (flows.has(ws)) throw new Error('Finish or stop the current GitHub login before refreshing.');
      var target = actor(ws);
      var item = {actor:target,signature:JSON.stringify(target),request:msg,saved:ctx.storage.read(target.owner)};
      drafts.set(ws,item);
      if (!watched.has(ws)) { watched.add(ws); ws.once('close',function () { watched.delete(ws); release(ws); }); }
      // Publish the saved record independently of a possibly unavailable network check.
      send(ws,msg,snapshot(item,'checking'));
      await inspect(ws,item); return;
    }
    var item = drafts.get(ws);
    requireCurrent(ws,item);
    if (!item.reviewId || item.reviewId !== msg.reviewId || item.busy) throw new Error('This GitHub review expired or was already used. Refresh status.');
    if (item.request.contextId !== msg.contextId) throw new Error('GitHub context changed.');
    item.request = msg;
    item.busy = true;
    try {
      if (msg.type === 'personal_github_disconnect') {
        if (!item.saved.connection) throw new Error('There is no saved GitHub connection.');
        requireCurrent(ws,item);
        var removed = ctx.storage.save(item.actor.owner,item.saved.revision,null);
        item.saved = removed; item.reviewId = null;
        send(ws,msg,snapshot(item,'saved',{message:'Clay Studio association removed. GitHub CLI credentials and existing CLI-backed tools are retained.'})); return;
      }
      if (msg.type !== 'personal_github_connect' && msg.type !== 'personal_github_login') throw new Error('Unsupported GitHub connection operation.');
      var fresh = await runtime.inspect(item.actor.identity,ctx.execute);
      requireCurrent(ws,item);
      if (ctx.storage.read(item.actor.owner).revision !== item.saved.revision) throw new Error('Saved connection changed. Refresh before confirming again.');
      if (fresh.status !== item.observed.status || fresh.overridden !== item.observed.overridden || fresh.status === 'authenticated' && !sameAccount(fresh.account,item.observed.account)) throw new Error('The GitHub CLI account changed. Refresh and confirm the exact account again.');
      if (msg.type === 'personal_github_connect') {
        if (fresh.status !== 'authenticated') throw new Error('Verify an authenticated GitHub account before connecting.');
        requireCurrent(ws,item);
        var saved = ctx.storage.save(item.actor.owner,item.saved.revision,{account:fresh.account,runtime:item.actor.runtime,shared:item.actor.shared,checkedAt:fresh.checkedAt,connectedAt:Date.now()});
        item.saved = saved; item.observed = fresh; item.reviewId = null;
        send(ws,msg,snapshot(item,'saved',{message:'GitHub association saved for the verified CLI account.'})); return;
      }
      if (!item.actor.canLogin || fresh.overridden) throw new Error('Browser login cannot replace environment credentials. Only an administrator may replace shared runtime credentials.');
      if (fresh.status !== 'authenticated' && fresh.status !== 'unauthenticated') throw new Error('Authentication is unknown. Resolve the CLI installation or network problem before starting login.');
      item.reviewId = null;
      item.unlock = ctx.storage.reserve(JSON.stringify([item.actor.runtime.uid,item.actor.runtime.gid,item.actor.runtime.home]));
      item.attachKey = crypto.randomUUID(); item.expires = null; flows.set(ws,item);
      try {
        item.terminal = ctx.tm.create(100,24,item.actor.identity,ws,{kind:'github-login',title:'GitHub sign in',githubLogin:true,
          revalidateGithub:function () { requireCurrent(ws,item); },
          onExit:function (terminal) {
            if (item.stopping) return;
            clearInterval(item.timer);
            // Defer until create() has assigned the exact terminal identity.
            Promise.resolve().then(async function () {
              if (flows.get(ws) !== item) return;
              try {
                await ctx.tm.closeAndWait(terminal.id,{identity:terminal.identity,revalidate:function () { if (flows.get(ws) !== item) throw new Error('Login changed.'); }});
                flows.delete(ws); releaseLock(item);
                requireCurrent(ws,item);
                send(ws,item.request,{state:'verifying',message:'Login terminal exited. Checking the actual GitHub API identity…'});
                await inspect(ws,item);
              } catch (error) { send(ws,item.request,{state:'unknown',message:'Login ended, but verification or cleanup could not be confirmed. Refresh status before explicitly continuing.'}); }
            });
          }});
        if (!item.terminal) { flows.delete(ws); releaseLock(item); throw new Error('The GitHub login terminal is unavailable.'); }
        item.timer = setInterval(function () { if (!valid(ws,item)) stop(ws,item); },250); item.timer.unref();
        send(ws,item.request,snapshot(item,'started',{terminalId:item.terminal.id,attachKey:item.attachKey,slug:ctx.slug,message:'Use the code and github.com device page shown in the terminal. You may approve on another device. Stop waits for terminal exit; it cannot undo credentials already saved by gh.'}));
      } catch (error) {
        if (flows.has(ws)) send(ws,item.request,{state:'unknown',message:'Login launch outcome is uncertain. Ask the server operator to inspect it before retrying.'});
        else throw error;
      }
    } finally { item.busy = false; }
  }
  function terminalMessage(ws,msg) {
    var terminal = msg.id && ctx.tm.inspect(msg.id);
    if (!/^term_/.test(msg.type || '')) return false;
    if (!terminal || terminal.kind !== 'github-login') return !!msg.githubAttachKey;
    var item, owner;
    flows.forEach(function (flow,peer) { if (flow.terminal && flow.terminal.id === msg.id && flow.terminal.identity === terminal.identity) { item = flow; owner = peer; } });
    try {
      if (!item || item.stopping) return true;
      requireCurrent(owner,item);
      if (JSON.stringify(actor(ws)) !== item.signature || msg.githubAttachKey !== item.attachKey) return true;
      if (msg.type === 'term_attach') {
        if (item.peer && item.peer !== ws) return true;
        if (!item.peer) ws.once('close',function () { if (flows.get(owner) === item) stop(owner,item); });
        item.peer = ws; ctx.tm.attach(msg.id,ws);
      } else if (item.peer === ws && msg.type === 'term_input') {
        if (typeof msg.data === 'string' && /^[ynYN\r\n\x03\x1b\[AB]*$/.test(msg.data) && msg.data.length <= 16) ctx.tm.writeGithub(msg.id,msg.data,terminal.identity);
      } else if (item.peer === ws && msg.type === 'term_resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows) && msg.cols >= 20 && msg.cols <= 240 && msg.rows >= 5 && msg.rows <= 100) {
        ctx.tm.resizeExact(msg.id,msg.cols,msg.rows,terminal.identity,function () { requireCurrent(owner,item); });
      } else if (item.peer === ws && (msg.type === 'term_close' || msg.type === 'term_detach')) stop(owner,item);
    } catch (error) { if (item) stop(owner,item); }
    return true;
  }
  return {handle:function (ws,msg) {
    if (terminalMessage(ws,msg)) return true;
    if (!/^personal_github_/.test(msg.type || '')) return false;
    run(ws,msg).catch(function (error) { send(ws,msg,{state:'error',message:error.message}); }); return true;
  }, destroy:function () { flows.forEach(function (item,ws) { release(ws); }); drafts.clear(); }};
}
module.exports = { attach: attach, LOGIN_ARGS: LOGIN_ARGS };
