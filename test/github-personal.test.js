var fs=require('node:fs'),os=require('node:os'),path=require('node:path');
var home=fs.mkdtempSync(path.join(os.tmpdir(),'clay-gh-personal-'));
process.env.HOME=home;process.env.CLAY_HOME=path.join(home,'.clay');process.env.CLAY_CONFIG=path.join(home,'config.json');process.env.CODEX_HOME=path.join(home,'.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var cp=require('node:child_process'),EventEmitter=require('node:events');
var test=require('node:test'),assert=require('node:assert/strict');
// Isolate every gh/PTY transport before importing production services.
var calls=[],execMode='ok',exitHooks=[],writes=[],killAck=true;
cp.execFile=function(command,args,opts,done){
  assert.equal(command,'gh');calls.push({args:args,opts:opts});
  var error=execMode==='ok' || args[0]==='--version' && execMode!=='missing' && execMode!=='mappedmissing'?null:Object.assign(new Error('synthetic-stderr-secret'),{code:execMode==='missing'?'ENOENT':execMode==='mappedmissing'?127:execMode==='unauthenticated'?4:1});
  setImmediate(function(){done(error,args[0]==='--version'?'gh version fixture':JSON.stringify({id:123,login:'octo',token:'must-not-return'}),'synthetic-stderr-secret');});
  return {stdin:{on:function(){},end:function(){}}};
};
var ptyFile=require.resolve('@lydell/node-pty');
require.cache[ptyFile]={id:ptyFile,filename:ptyFile,loaded:true,exports:{spawn:function(command,args,opts){
  calls.push({command:command,args:args,opts:opts});var exit;
  var terminal={onData:function(){},onExit:function(hook){exit=hook;exitHooks.push(hook);},write:function(data){writes.push(data);},kill:function(){if(killAck)setImmediate(function(){exit({exitCode:130});});}};return terminal;
}}};
var osFile=require.resolve('../lib/os-users');require.cache[osFile]={id:osFile,filename:osFile,loaded:true,exports:{wrapSpawnAsUser:function(command,args,options){return {command:command,args:args,options:options};}}};
var runtime=require('../lib/github-runtime'),storageModule=require('../lib/github-connection-store'),attach=require('../lib/project-github-connection').attach;
function flush(){return new Promise(function(resolve){setImmediate(function(){setImmediate(resolve);});});}
function fixture(t,mapped){
  var root=fs.mkdtempSync(path.join(home,'case-')),storage=storageModule.attach(root),messages=[];
  var user={id:'owner',role:'admin',linuxUser:'owner-os'},registered=user,permit=true,access=true;
  var identity={user:'owner-os',uid:1001,gid:1001,home:root,shell:'/bin/sh'};
  var ws=new EventEmitter();ws.readyState=1;ws._clayUser=user;ws.send=function(){};
  var clients=new Set([ws]);var tm=require('../lib/terminal-manager').createTerminalManager({cwd:root,send:function(){},sendTo:function(){}});
  var state='authenticated',account={id:123,login:'octo'},held=null;
  var ctx={slug:'sample',clients:clients,storage:storage,osUsers:!!mapped,usersModule:{isMultiUser:function(){return true;},findUserById:function(id){return registered && registered.id===id?registered:null;}},
    resolveOsUserInfo:function(){return identity;},requestAccess:{canAccessProject:function(){return access;},hasPermission:function(){return permit;}},tm:tm,
    sendTo:function(peer,message){messages.push(message);},execute:async function(id,args){
      if(held)await held;
      if(args[0]==='--version'){if(state==='missing')throw {kind:'missing'};return 'gh fixture';}
      if(state!=='authenticated')throw {kind:state};return JSON.stringify(account);
    }};
  var service=attach(ctx);
  async function send(action,extra,peer){var review=messages.filter(function(msg){return msg.reviewId;}).pop();service.handle(peer||ws,Object.assign({type:'personal_github_'+action,requestId:action,contextId:'context',reviewId:review && review.reviewId},extra||{}));await flush();return messages[messages.length-1];}
  t.after(async function(){service.destroy();await flush();tm.destroyAll();});
  return {ctx:ctx,ws:ws,tm:tm,clients:clients,storage:storage,messages:messages,identity:identity,send:send,service:service,
    state:function(value){state=value;},account:function(value){account=value;},revoke:function(){permit=false;},remove:function(){registered=null;},denyProject:function(){access=false;},role:function(value){user.role=value;},hold:function(promise){held=promise;}};
}
test.after(function(){fs.rmSync(home,{recursive:true,force:true});});
test('fixed read-only CLI probe projects numerical ID/login only and distinguishes missing, unauthenticated and unknown',async function(){
  for(var mode of ['ok','missing','mappedmissing','unauthenticated','offline']){execMode=mode;var result=await runtime.inspect(null);assert.equal(result.status,mode==='ok'?'authenticated':mode==='offline'?'unknown':mode==='mappedmissing'?'missing':mode);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('token'),false);}
  assert.deepEqual(calls[1].args,['api','--hostname','github.com','user','--jq','{id: .id, login: .login}']);execMode='ok';
});
test('shared environment is identical to session GitHub and mapped accounts never inherit daemon tokens',async function(){
  process.env.GH_TOKEN='synthetic-daemon-secret';process.env.GH_CONFIG_DIR='/synthetic-gh';
  assert.equal(runtime.overridden(null),true);assert.equal(runtime.overridden({home:home,user:'mapped',uid:1001,gid:1001}),false);
  var before=calls.length;await require('../lib/session-github').runGh(home,['api','user'],null);assert.equal(calls[before].opts.env.GH_TOKEN,'synthetic-daemon-secret');
  var env=runtime.environment({home:home,user:'mapped',uid:1001,gid:1001});assert.equal(env.GH_CONFIG_DIR,undefined);assert.equal(env.HOME,home);
  delete process.env.GH_TOKEN;delete process.env.GH_CONFIG_DIR;
});
test('only explicit exact-account confirmation persists; refresh and restart retain saved association',async function(t){var f=fixture(t,true);var view=await f.send('get');assert.equal(view.saved.connection,null);assert.equal(view.observed.account.id,123);assert.equal(f.tm.list().length,0);var saved=await f.send('connect');assert.equal(saved.state,'saved');assert.equal(storageModule.attach(path.dirname(path.join(f.identity.home,'dummy'))).read('owner').connection.account.id,123);var revision=saved.saved.revision;await f.send('get');assert.equal(f.storage.read('owner').revision,revision);});
test('reconnect never silently retargets changed numerical ID or login',async function(t){var f=fixture(t,true);await f.send('get');f.account({id:456,login:'octo'});assert.equal((await f.send('connect')).state,'error');assert.equal(f.storage.read('owner').connection,null);await f.send('get');assert.equal((await f.send('connect')).saved.connection.account.id,456);await f.send('get');f.account({id:456,login:'renamed'});assert.equal((await f.send('connect')).state,'error');assert.equal(f.storage.read('owner').connection.account.login,'octo');});
['revoke','remove','denyProject','identity','socket','home','environment','release'].forEach(function(change){test('authority is live across asynchronous confirmation: '+change,async function(t){var f=fixture(t,true);await f.send('get');var done;f.hold(new Promise(function(resolve){done=resolve;}));var pending=f.send('connect');if(change==='identity')f.identity.uid++;else if(change==='home')f.identity.home+='/changed';else if(change==='socket')f.clients.delete(f.ws);else if(change==='environment')process.env.PATH+=':/synthetic-change';else if(change==='release')await f.send('release');else f[change]();done();await pending;if(change==='environment')process.env.PATH=process.env.PATH.replace(/:\/synthetic-change$/,'');assert.equal(f.storage.read('owner').connection,null);assert.equal(f.tm.list().length,0);});});
test('foreign sockets and stale reviews cannot confirm; exact saved revision rejects concurrent saves',async function(t){var f=fixture(t,true);var review=await f.send('get');var peer=new EventEmitter();peer.readyState=1;peer._clayUser={id:'foreign'};f.clients.add(peer);assert.equal((await f.send('connect',null,peer)).state,'error');f.storage.save('owner',null,{account:{id:999,login:'other'}});assert.equal((await f.send('connect',{reviewId:review.reviewId})).state,'error');assert.equal(f.storage.read('owner').connection.account.id,999);});
test('save failure keeps review and metadata unpublished; explicit retry can succeed',async function(t){var f=fixture(t,true);await f.send('get');var save=f.storage.save;f.storage.save=function(){throw new Error('Synthetic save failure.');};assert.equal((await f.send('connect')).state,'error');assert.equal(f.storage.read('owner').connection,null);f.storage.save=save;assert.equal((await f.send('connect')).state,'saved');});
test('offline refresh keeps saved association; disconnect removes only Clay metadata',async function(t){var f=fixture(t,true);await f.send('get');await f.send('connect');f.state('unknown');var view=await f.send('get');assert.equal(view.observed.status,'unknown');assert.equal(view.saved.connection.account.login,'octo');var before=calls.length;assert.equal((await f.send('disconnect')).saved.connection,null);assert.equal(calls.length,before);assert.equal(f.tm.list().length,0);});
test('shared members may inspect/reuse observed auth but cannot replace host CLI login',async function(t){var f=fixture(t,false);f.role('user');var view=await f.send('get');assert.equal(view.canLogin,false);assert.equal((await f.send('login')).state,'error');assert.equal(f.tm.list().length,0);await f.send('get');assert.equal((await f.send('connect')).state,'saved');});
test('environment overrides are truthful and never returned; new browser login is refused',async function(t){var f=fixture(t,false);process.env.GITHUB_TOKEN='synthetic-private-value';t.after(function(){delete process.env.GITHUB_TOKEN;});var view=await f.send('get');assert.equal(view.observed.overridden,true);assert.equal(view.canLogin,false);assert.equal((await f.send('login')).state,'error');assert.equal(JSON.stringify(f.messages).includes('synthetic-private-value'),false);assert.equal(f.tm.list().length,0);});
test('login uses a fixed direct gh PTY and only the exact bound auxiliary socket may attach/input',async function(t){var f=fixture(t,true);f.state('unauthenticated');await f.send('get');var start=await f.send('login',{command:'forbidden',host:'evil.invalid'});assert.equal(start.state,'started');var call=calls[calls.length-1];assert.equal(call.command,'gh');assert.deepEqual(call.args,require('../lib/project-github-connection').LOGIN_ARGS);assert.equal(call.opts.cwd,f.identity.home);assert.equal(call.opts.uid,1001);assert.equal(call.opts.env.GH_BROWSER,'false');assert.equal(call.opts.env.GH_PROMPT_DISABLED,undefined);
  var peer=new EventEmitter();peer.readyState=1;peer._clayUser=f.ws._clayUser;peer.send=function(){};f.clients.add(peer);
  var count=writes.length;f.service.handle(peer,{type:'term_input',id:start.terminalId,data:'touch forbidden\n',githubAttachKey:start.attachKey});f.tm.write(start.terminalId,'touch forbidden\n');assert.equal(writes.length,count);
  f.service.handle(peer,{type:'term_attach',id:start.terminalId,githubAttachKey:'foreign'});assert.equal(f.tm.getScrollback(start.terminalId).content,'');
  f.service.handle(peer,{type:'term_attach',id:start.terminalId,githubAttachKey:start.attachKey});f.service.handle(peer,{type:'term_input',id:start.terminalId,data:'\r',githubAttachKey:start.attachKey});assert.equal(writes[writes.length-1],'\r');f.service.handle(peer,{type:'term_input',id:start.terminalId,data:'touch forbidden\n',githubAttachKey:start.attachKey});assert.equal(writes.length,count+1);
  await f.send('stop');await flush();assert.equal(f.tm.list().length,0);assert.equal(f.messages[f.messages.length-1].state,'stopped');
});
test('duplicate login is refused across project service instances sharing storage',async function(t){var f=fixture(t,true);f.state('unauthenticated');await f.send('get');await f.send('login');var other=attach(f.ctx);t.after(function(){other.destroy();});other.handle(f.ws,{type:'personal_github_get',requestId:'other',contextId:'other'});await flush();var review=f.messages[f.messages.length-1];other.handle(f.ws,{type:'personal_github_login',requestId:'login2',contextId:'other',reviewId:review.reviewId});await flush();assert.equal(f.messages[f.messages.length-1].state,'error');assert.equal(f.tm.list().length,1);});
test('exit zero still requires API verification and an explicit new account confirmation',async function(t){var f=fixture(t,true);f.state('unauthenticated');await f.send('get');await f.send('login');exitHooks[exitHooks.length-1]({exitCode:0});await flush();await flush();assert.equal(f.storage.read('owner').connection,null);assert.equal(f.messages[f.messages.length-1].observed.status,'unauthenticated');});
test('Stop/revocation waits for exit and prevents replay',async function(t){var f=fixture(t,true);f.state('unauthenticated');await f.send('get');var start=await f.send('login');f.revoke();await new Promise(function(resolve){setTimeout(resolve,280);});await flush();assert.equal(f.messages[f.messages.length-1].state,'stopped');assert.equal(f.tm.has(start.terminalId),false);assert.equal((await f.send('login')).state,'error');});
test('uncertain shutdown retains a durable runtime reservation and never launches again',async function(t){var f=fixture(t,true);f.state('unauthenticated');await f.send('get');await f.send('login');f.tm.closeAndWait=async function(){throw new Error('Synthetic unacknowledged exit');};assert.equal((await f.send('stop')).state,'unknown');assert.equal((await f.send('get')).state,'error');assert.equal(f.tm.list().length,1);assert.throws(function(){f.storage.reserve(JSON.stringify([f.identity.uid,f.identity.gid,f.identity.home]));},/already running/);});
test('store compares revisions across independently constructed stores and leaves previous record after failed rename',function(){var directory=fs.mkdtempSync(path.join(home,'store-'));var a=storageModule.attach(directory),b=storageModule.attach(directory);var first=a.save('owner',null,{account:{id:1,login:'one'}});assert.throws(function(){b.save('owner',null,null);});var rename=fs.renameSync;fs.renameSync=function(){throw new Error('disk failure');};try{assert.throws(function(){a.save('owner',first.revision,{account:{id:2,login:'two'}});});}finally{fs.renameSync=rename;}assert.deepEqual(b.read('owner'),first);assert.throws(function(){a.read('../foreign');});});

test('API identity projection rejects missing, non-numeric or unsafe IDs and foreign logins',async function(){for(var account of [{id:'123',login:'octo'},{id:0,login:'octo'},{id:9007199254740992,login:'octo'},{id:1,login:'evil/login'},{id:1}]){var result=await runtime.inspect(null,async function(identity,args){return args[0]==='--version'?'gh fixture':JSON.stringify(account);});assert.equal(result.status,'unknown');assert.equal(result.account,null);}});
test('expired reviews and stale scoped terminal messages never fall through to generic dispatch',async function(t){var f=fixture(t,true);await f.send('get');var now=Date.now;try{Date.now=function(){return now()+121000;};assert.equal((await f.send('connect')).state,'error');}finally{Date.now=now;}assert.equal(f.storage.read('owner').connection,null);assert.equal(f.service.handle(f.ws,{type:'term_input',id:999,githubAttachKey:'old-key',data:'forbidden'}),true);});
