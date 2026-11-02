// Personal provider discovery and sign-in authority. No credential files are read.
var crypto = require('crypto');
var os = require('os');
var registry = require('./yoke/vendor-registry');
var protocol = require('./yoke/login-protocol');
var installRecipes = require('./yoke/provider-install-recipes');
var LIFETIME = 5 * 60 * 1000;
function attach(ctx) {
  var receipts = new WeakMap();
  function actor(ws) {
    if (!ws || ws.readyState !== 1 || ws._clayPaneActivation || ws._clayPane || ctx.clients && !ctx.clients.has(ws)) throw new Error('Open Personal settings in the connected workspace.');
    if (ctx.requestAccess && !ctx.requestAccess.canAccessProject(ws, ctx.slug)) throw new Error('Project access changed. Reopen Personal settings.');
    var users = ctx.usersModule;
    var user = ws._clayUser;
    if (users && users.isMultiUser() && (!user || !users.findUserById(user.id))) throw new Error('Sign in again to manage providers.');
    if (user && users && users.findUserById) user = users.findUserById(user.id);
    if (ws._clayUser && !user) throw new Error('This account is no longer available.');
    if (ctx.osUsers && (!user || !user.linuxUser)) throw new Error('Your mapped OS identity is unavailable.');
    var info = ctx.osUsers ? (ctx.resolveOsUserInfo ? ctx.resolveOsUserInfo(user.linuxUser) : ctx.getOsUserInfoForWs({ _clayUser: user })) : null;
    if (ctx.osUsers && (!info || !info.user || !info.home)) throw new Error('Your mapped OS identity is unavailable. Ask the server administrator to check the mapping.');
    return { accountName:user ? user.displayName || user.username || String(user.id) : 'Personal account', role: user ? user.role : 'admin', runtime: info || {user:os.userInfo().username,uid:os.userInfo().uid,gid:os.userInfo().gid,home:os.homedir()}, owner: user ? String(user.id) : 'default', identity: { linuxUser: info ? info.user : null, osUserInfo: info } };
  }
  function signature() {
    return JSON.stringify(Object.keys(registry.VENDOR_REGISTRY).map(function (id) {
      var info = registry.getVendorInfo(id);
      return [id, info.loginCommand, info.terminalLoginCommand, info.browserLoginCommand, info.oauthHosts, info.osUserIsolation, info.installRecipe];
    }));
  }
  function current(ws, receipt) {
    if (!receipt) return false;
    try { return Object.keys(receipt.registry).length === Object.keys(registry.VENDOR_REGISTRY).length && Object.keys(receipt.registry).every(function (id) { return receipt.registry[id] === registry.getVendorInfo(id) && receipt.resolvers[id] === registry.getVendorInfo(id).resolveExecutable; }) && receipt.commands === signature() && receipts.get(ws) === receipt && receipt.expires > Date.now() && JSON.stringify(actor(ws)) === receipt.actor; }
    catch (error) { return false; }
  }
  function catalog(ws, requestId) {
    var target = actor(ws);
    var receipt = { registry: Object.assign({}, registry.VENDOR_REGISTRY), resolvers: {}, commands: signature(), id: crypto.randomUUID(), actor: JSON.stringify(target), expires: Date.now() + LIFETIME };
    Object.keys(receipt.registry).forEach(function (id) { receipt.resolvers[id] = receipt.registry[id].resolveExecutable; });
    receipts.set(ws, receipt);
    var info = target.identity.osUserInfo;
    var scope = info ? 'Mapped OS account ' + info.user + ' · HOME ' + info.home :
      'Shared server OS account ' + os.userInfo().username + ' · HOME ' + os.homedir() + '. Provider credentials are shared by processes using this HOME; they are not isolated by Clay Studio account.';
    var rows = Object.keys(registry.VENDOR_REGISTRY).map(function (id) {
      var provider = registry.getVendorInfo(id);
      var supported = !ctx.osUsers || provider.osUserIsolation === true;
      var installed = null, reason = '';
      if (!supported) reason = 'This provider does not support mapped OS accounts in Clay Studio.';
      else {
        try { installed = !!provider.resolveExecutable({ user: target.identity.linuxUser }); }
        catch (error) { reason = 'Installation discovery failed. Check the server setup, then refresh status.'; }
      }
      var installReason = installRecipes.eligible(provider.installRecipe, target.runtime);
      if (!ctx.osUsers && target.role !== 'admin') installReason = 'Only the server administrator can install into the shared runtime HOME.';
      var login = false;
      try { protocol.command(id, false); login = true; } catch (error) {}
      var permitted = !ctx.requestAccess || ctx.requestAccess.hasPermission(ws, 'terminal');
      var canInstall = supported && installed === false && permitted && !installReason;
      return { id: id, name: provider.displayName, icon: provider.avatar, setupUrl: provider.setupUrl, installed: installed,
        authentication: 'unknown', tested: false, browser: !!provider.browserLoginCommand,
        canSignIn: supported && installed === true && login && permitted,
        canInstall: canInstall, installReason: installReason,
        reason: reason || (!permitted ? 'Terminal permission is required for provider installation and sign-in.' : ''),
        setup: canInstall ? 'Review the official installer for the runtime account shown above. Installation does not sign in or run a task.' : (installed === null ? (reason || 'Installation status is unknown. Refresh status before reviewing an installation.') : installReason || 'Review the registered installer before running it.') + ' Ask the server operator to install ' + provider.binaryName + ' for the runtime OS account shown above, using the provider’s official setup instructions. Then refresh status.',
        loginCommand: supported && permitted && login ? protocol.command(id, false) : null };
    });
    if (!current(ws, receipt)) throw new Error('Provider account context changed. Refresh status.');
    return { type: 'vendor_login_catalog', requestId: requestId, revision: receipt.id, owner: target.owner, accountName:target.accountName, runtime:Object.assign({shared:!info},target.runtime), scope: scope, providers: rows };
  }
  function resolve(ws, msg) {
    var receipt = receipts.get(ws), info = registry.getVendorInfo(msg.vendor);
    if (!current(ws, receipt) || msg.personalRequestId !== receipt.id || msg.sessionId || msg.workerAuthRequestId ||
        !info || ctx.osUsers && info.osUserIsolation !== true || ctx.requestAccess && !ctx.requestAccess.hasPermission(ws, 'terminal')) {
      throw new Error('Personal provider context expired or is no longer permitted. Refresh status before signing in.');
    }
    var target = actor(ws);
    if (!info.resolveExecutable({user:target.identity.linuxUser})) throw new Error('Install this provider for the runtime OS account, then refresh status.');
    return { identity: target.identity, validate: function (peer) {
      return peer === ws && current(ws, receipt) && (!ctx.requestAccess || ctx.requestAccess.hasPermission(ws, 'terminal'));
    } };
  }
  function resolveInstall(ws, msg) {
    var receipt = receipts.get(ws), provider = registry.getVendorInfo(msg.vendor);
    if (!current(ws, receipt) || msg.personalRequestId !== receipt.id || msg.sessionId || msg.workerAuthRequestId || !provider || ctx.osUsers && provider.osUserIsolation !== true || ctx.requestAccess && !ctx.requestAccess.hasPermission(ws, 'terminal')) throw new Error('Installation context expired or permission changed. Refresh status.');
    var target = actor(ws), recipe = provider.installRecipe;
    var reason = installRecipes.eligible(recipe, target.runtime);
    if (!ctx.osUsers && target.role !== 'admin') reason = 'Only the server administrator can install into the shared runtime HOME.';
    if (reason) throw new Error(reason);
    if (provider.resolveExecutable({user:target.identity.linuxUser})) throw new Error('This provider is already installed. Refresh status.');
    return { recipe:recipe, runtime:target.runtime, identity:target.identity, validate:function () {
      try { return current(ws, receipt) && provider === registry.getVendorInfo(msg.vendor) && recipe === provider.installRecipe && (!ctx.requestAccess || ctx.requestAccess.hasPermission(ws,'terminal')) && !installRecipes.eligible(recipe,actor(ws).runtime); } catch(error) { return false; }
    } };
  }
  return { catalog: catalog, resolve: resolve, resolveInstall:resolveInstall, release: function (ws) { receipts.delete(ws); } };
}
module.exports = { attach: attach };
