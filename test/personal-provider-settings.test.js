var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-personal-providers-'));
process.env.HOME = temporary; process.env.CLAY_HOME = path.join(temporary,'.clay'); process.env.CODEX_HOME = path.join(temporary,'.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var test = require('node:test'), assert = require('node:assert/strict'), EventEmitter = require('node:events');
var registry = require('../lib/yoke/vendor-registry'), attach = require('../lib/project-vendor-login').attachVendorLogin;
test.after(function () { fs.rmSync(temporary,{recursive:true,force:true}); });
function fixture(t, isolated) {
  var user = {id:'owner',role:'admin',linuxUser:'owner-os'}, permitted = true, access = true, live = true, refreshes = [];
  var identity = {user:'owner-os',home:'/home/owner-os',uid:1001,gid:1001};
  var cachedIdentity=Object.assign({},identity);
  var ws = new EventEmitter(); ws.readyState = 1; ws._clayUser = user; ws._clayActiveSession = 99;
  var other = new EventEmitter(); other.readyState = 1; other._clayUser = {id:'other'};
  var clients = new Set([ws,other]), messages = [], terminals = [], browsers = [];
  var originals = {}, missing = false, discovery = null;
  Object.keys(registry.VENDOR_REGISTRY).forEach(function(id){originals[id]=registry.getVendorInfo(id).resolveExecutable;registry.getVendorInfo(id).resolveExecutable=function(options){if(discovery)discovery();return missing || options.user && options.user!=='owner-os' ? null : id==='kiro' ? null : '/fixture/'+id;};});
  var tm = {create:function(cols,rows,info,peer,options){var terminal={id:terminals.length+1,identity:'terminal-'+terminals.length,osInfo:info,peer:peer,options:options,alive:true};terminals.push(terminal);return terminal;},has:function(id){return terminals[id-1].alive;},close:function(id){terminals[id-1].alive=false;},closeAndWait:async function(id,control){control.revalidate();assert.equal(control.identity,terminals[id-1].identity);terminals[id-1].alive=false;},list:function(){return [];},attach:function(){}};
  var login = attach({slug:'fixture',clients:clients,tm:tm,osUsers:isolated,sm:{sessions:new Map([[99,{ownerId:'foreign',vendor:'claude'}]])},
    requestAccess:{canAccessProject:function(){return access;},hasPermission:function(){return permitted;}},
    usersModule:{isMultiUser:function(){return true;},findUserById:function(id){return live && id==='owner' ? user : null;}},
    resolveOsUserInfo:function(name){return name===user.linuxUser ? identity : null;},
    getOsUserInfoForWs:function(peer){return peer._clayUser.id==='owner' ? cachedIdentity : null;},
    getLinuxUserForSession:function(){throw new Error('Personal login must never use the selected Driver.');},
    send:function(){},sendTo:function(peer,message){messages.push({peer:peer,message:message});},
    refreshVendorAuthEverywhere:function(vendor,linuxUser){refreshes.push([vendor,linuxUser]);return Promise.resolve(true);},
    createLoginBrowser:function(){var browser={id:'browser-'+browsers.length,env:{},close:function(){browser.closed=true;},output:function(){},attach:function(){},input:function(){}};browsers.push(browser);return browser;}});
  t.after(function(){login.destroy();Object.keys(originals).forEach(function(id){registry.getVendorInfo(id).resolveExecutable=originals[id];});});
  function send(message,peer){login.handleVendorLoginMessage(peer||ws,message);return messages.filter(function(entry){return entry.peer===(peer||ws);}).map(function(entry){return entry.message;});}
  function catalog(){return send({type:'vendor_login_catalog_request',requestId:'request'}).filter(function(msg){return msg.type==='vendor_login_catalog';}).pop();}
  function start(revision,vendor,mode){return send({type:'vendor_login_start',vendor:vendor||'codex',personalRequestId:revision,sessionId:null,mode:mode||'terminal'});}
  return {ws:ws,other:other,clients:clients,identity:identity,catalog:catalog,start:start,send:send,terminals:terminals,tm:tm,browsers:browsers,messages:messages,refreshes:refreshes,
    discovery:function(callback){discovery=callback;},name:function(display,username){user.displayName=display;user.username=username;},missing:function(){missing=true;},role:function(role){user.role=role;},revoke:function(){permitted=false;},remove:function(){live=false;},revokeProject:function(){access=false;}};
}
test('registry catalog includes every provider, distinct installed/auth/tested state and truthful unsupported installation',function(t){
  var f=fixture(t,false), catalog=f.catalog();
  assert.equal(catalog.providers.length,Object.keys(registry.VENDOR_REGISTRY).length);assert.equal(catalog.providers.length,11);
  assert.match(catalog.scope,/Shared server OS account.*HOME.*not isolated/);assert.equal(catalog.owner,'owner');
  catalog.providers.forEach(function(provider){assert.equal(provider.authentication,'unknown');assert.equal(provider.tested,false);assert.equal(typeof provider.setup,'string');assert.match(provider.setupUrl,/^https:\/\//);assert.equal('key' in provider,false);});
  assert.equal(catalog.providers.find(function(p){return p.id==='kiro';}).installed,false);
});
test('mapped catalog never borrows daemon installation or credentials for unsupported providers',function(t){
  var f=fixture(t,true), catalog=f.catalog();assert.match(catalog.scope,/owner-os.*HOME \/home\/owner-os/);
  catalog.providers.forEach(function(provider){if(registry.getVendorInfo(provider.id).osUserIsolation!==true){assert.equal(provider.installed,null);assert.equal(provider.canSignIn,false);assert.match(provider.reason,/does not support mapped/);}});
  assert.equal(f.start(catalog.revision,'muse').pop().type,'vendor_login_error');assert.equal(f.terminals.length,0);
});
test('Personal terminal sign-in uses the owner identity independently of selected foreign Driver and dedupes',function(t){
  var f=fixture(t,true), catalog=f.catalog();f.start(catalog.revision);f.start(catalog.revision);
  assert.equal(f.terminals.length,1);assert.deepEqual(f.terminals[0].osInfo,f.identity);assert.equal(f.terminals[0].options.initialInput,'codex login --device-auth\n');
  f.send({type:'vendor_login_cancel',vendor:'codex',personalRequestId:catalog.revision});assert.equal(f.terminals[0].alive,false);assert.deepEqual(f.refreshes,[]);
});
test('Personal browser flow shares exact cancel and navigation release with existing coordinator',function(t){
  var f=fixture(t,true), catalog=f.catalog();f.start(catalog.revision,'codex','browser');
  assert.equal(f.browsers.length,1);assert.equal(f.terminals[0].options.initialInput,'codex login\n');
  f.send({type:'vendor_login_personal_release'});assert.equal(f.terminals[0].alive,false);assert.equal(f.browsers[0].closed,true);
  f.start(catalog.revision);assert.equal(f.terminals.length,1);
});
['owner','permission','identity','socket','project','revision','provider'].forEach(function(change){test('Personal sign-in refuses changed '+change+' without starting a provider',function(t){
  var f=fixture(t,true), catalog=f.catalog();
  if(change==='owner')f.remove();if(change==='permission')f.revoke();if(change==='identity')f.identity.uid++;
  if(change==='socket')f.clients.delete(f.ws);if(change==='project')f.revokeProject();
  var original=registry.VENDOR_REGISTRY.codex;
  if(change==='revision')f.catalog();if(change==='provider')registry.VENDOR_REGISTRY.codex=Object.assign({},registry.VENDOR_REGISTRY.codex);
  try {assert.equal(f.start(catalog.revision).pop().type,'vendor_login_error');assert.equal(f.terminals.length,0);}
  finally {if(change==='provider') registry.VENDOR_REGISTRY.codex=original;}
});});
test('async permission revocation cancels flow before completion or credential runtime refresh',async function(t){
  var f=fixture(t,true), catalog=f.catalog();f.start(catalog.revision);f.revoke();
  f.terminals[0].options.onData('Successfully logged in');f.terminals[0].options.onExit();
  await new Promise(function(resolve){setImmediate(resolve);});assert.equal(f.terminals[0].alive,false);assert.deepEqual(f.refreshes,[]);
});
test('foreign receipt, caller commands, unknown and missing providers never broaden the allowlist',function(t){
  var f=fixture(t,false), catalog=f.catalog();
  f.start(catalog.revision,'kiro');f.start(catalog.revision,'unknown');
  f.send({type:'vendor_login_start',vendor:'codex',personalRequestId:catalog.revision,sessionId:null},f.other);assert.equal(f.terminals.length,0);
  f.send({type:'vendor_login_start',vendor:'codex',personalRequestId:catalog.revision,command:'touch /forbidden',sessionId:null});
  assert.equal(f.terminals.length,1);assert.equal(f.terminals[0].options.initialInput,'codex login --device-auth\n');
});

function installReview(f,vendor) {
  f.missing();var catalog=f.catalog();
  var messages=f.send({type:'personal_provider_install_review',vendor:vendor||'claude',personalRequestId:catalog.revision});
  return {catalog:catalog,review:messages[messages.length-1]};
}
function installStart(f,r,extra) { return f.send(Object.assign({type:'personal_provider_install_start',vendor:r.review.vendor,personalRequestId:r.catalog.revision,reviewId:r.review.reviewId},extra||{})).pop(); }
['claude','codex'].forEach(function(vendor){test('reviewed '+vendor+' installation uses registry recipe and exact mapped owner; no sign-in or task replay',function(t){
  var f=fixture(t,true),r=installReview(f,vendor);assert.equal(r.review.state,'review');assert.equal(f.terminals.length,0);assert.equal(r.review.runtime.uid,1001);
  assert.equal(r.review.command,registry.getVendorInfo(vendor).installRecipe.command);
  assert.equal(installStart(f,r,{command:'forbidden',initialInput:'forbidden'}).state,'started');
  assert.equal(f.terminals[0].options.providerInstall,vendor);assert.equal(f.terminals[0].options.initialInput,undefined);assert.deepEqual(f.terminals[0].osInfo,f.identity);
  assert.equal(installStart(f,r).state,'refused');assert.equal(f.terminals.length,1);
  f.terminals[0].options.onExit({exitCode:0});assert.equal(f.messages[f.messages.length-1].message.state,'completed');assert.equal(f.messages[f.messages.length-1].message.installed,false);assert.deepEqual(f.refreshes,[]);
});});
['permission','identity','role','registry','revision','owner','foreign','cancel','root'].forEach(function(change){test('installation review refuses '+change+' changes before executing',function(t){
  var f=fixture(t,change!=='role'),r=installReview(f);var original=registry.getVendorInfo('claude').installRecipe;
  if(change==='permission')f.revoke();if(change==='identity')f.identity.uid++;if(change==='role')f.role('user');if(change==='registry')registry.getVendorInfo('claude').installRecipe=Object.assign({},original);if(change==='revision')f.catalog();if(change==='owner')f.remove();if(change==='root')f.identity.uid=0;
  if(change==='cancel')f.send({type:'personal_provider_install_cancel',vendor:'claude',reviewId:r.review.reviewId,personalRequestId:r.catalog.revision});
  try {if(change==='foreign')f.send({type:'personal_provider_install_start',vendor:'claude',reviewId:r.review.reviewId,personalRequestId:r.catalog.revision},f.other);else installStart(f,r);assert.equal(f.terminals.length,0);}finally{registry.getVendorInfo('claude').installRecipe=original;}
});});
test('Stop waits for exact terminal exit and never replays installation',async function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);f.send({type:'personal_provider_install_stop',vendor:'claude',personalRequestId:r.catalog.revision});await new Promise(function(resolve){setImmediate(resolve);});assert.equal(f.terminals[0].alive,false);assert.equal(f.messages[f.messages.length-1].message.state,'stopped');assert.equal(installStart(f,r).state,'refused');});
test('running installation stops when live OS identity is revoked',async function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);f.identity.uid++;await new Promise(function(resolve){setTimeout(resolve,300);});assert.equal(f.terminals[0].alive,false);assert.equal(f.messages[f.messages.length-1].message.state,'stopped');});
test('navigation invalidates pending install review and stops its running terminal',async function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);f.send({type:'vendor_login_personal_release'});await new Promise(function(resolve){setImmediate(resolve);});assert.equal(f.terminals[0].alive,false);assert.equal(installStart(f,r).state,'refused');});
test('unknown providers and unmapped root runtime expose instructions, never executable installation',function(t){var f=fixture(t,true);f.missing();f.identity.uid=0;var c=f.catalog();assert.equal(c.providers.find(function(p){return p.id==='claude';}).canInstall,false);assert.match(c.providers.find(function(p){return p.id==='claude';}).installReason,/non-root/);assert.equal(f.send({type:'personal_provider_install_review',vendor:'unknown',personalRequestId:c.revision}).pop().state,'refused');assert.equal(f.terminals.length,0);});

test('two authenticated owner sockets cannot run duplicate installations for the same OS scope',function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);var peer=new EventEmitter();peer.readyState=1;peer._clayUser=f.ws._clayUser;f.clients.add(peer);var catalog=f.send({type:'vendor_login_catalog_request',requestId:'other-owner-window'},peer).filter(function(msg){return msg.type==='vendor_login_catalog';}).pop();var result=f.send({type:'personal_provider_install_review',vendor:'claude',personalRequestId:catalog.revision},peer).pop();assert.equal(result.state,'refused');assert.match(result.message,/already running/);assert.equal(f.terminals.length,1);f.terminals[0].options.onExit({exitCode:1});assert.equal(f.messages[f.messages.length-1].message.state,'failed');});
test('review expiry and shutdown uncertainty never authorize a blind retry',async function(t){var f=fixture(t,true);f.identity.home+='-uncertain';var r=installReview(f);var now=Date.now;try{Date.now=function(){return now()+121000;};assert.equal(installStart(f,r).state,'refused');assert.equal(f.terminals.length,0);}finally{Date.now=now;}r=installReview(f);installStart(f,r);f.tm.closeAndWait=async function(){throw new Error('Synthetic exit timeout');};f.send({type:'personal_provider_install_stop',vendor:'claude',personalRequestId:r.catalog.revision});await new Promise(function(resolve){setImmediate(resolve);});assert.equal(f.messages[f.messages.length-1].message.state,'unknown');assert.equal(installStart(f,r).state,'refused');assert.equal(f.terminals.length,1);});

test('installation completion revalidates authority after fresh discovery',function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);f.discovery(function(){f.revoke();});f.terminals[0].options.onExit({exitCode:0});var result=f.messages[f.messages.length-1].message;assert.equal(result.state,'unknown');assert.equal(result.installed,undefined);});
test('successful installer exit never turns a discovery error into a not-installed assertion',function(t){var f=fixture(t,true),r=installReview(f);installStart(f,r);f.discovery(function(){throw new Error('Synthetic discovery failure');});f.terminals[0].options.onExit({exitCode:0});var result=f.messages[f.messages.length-1].message;assert.equal(result.state,'completed');assert.equal(result.installed,null);assert.match(result.message,/discovery is unavailable/);});

test('catalog uses a human account name with username and id fallbacks, preserving exact runtime metadata',function(t){var f=fixture(t,true);f.name('Owner Name','owner-login');var catalog=f.catalog();assert.equal(catalog.accountName,'Owner Name');assert.equal(catalog.runtime.shared,false);assert.equal(catalog.runtime.home,'/home/owner-os');assert.equal(catalog.runtime.user,'owner-os');f.name('','owner-login');assert.equal(f.catalog().accountName,'owner-login');f.name('','');assert.equal(f.catalog().accountName,'owner');});
