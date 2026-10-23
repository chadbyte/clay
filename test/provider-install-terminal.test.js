var fs=require('node:fs'),os=require('node:os'),path=require('node:path');
var temporary=fs.mkdtempSync(path.join(os.tmpdir(),'clay-install-transport-'));
process.env.HOME=temporary;process.env.CLAY_HOME=path.join(temporary,'.clay');process.env.CODEX_HOME=path.join(temporary,'.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var test=require('node:test'),assert=require('node:assert/strict');
// Replace the PTY and identity transport before importing production terminal code.
var calls=[],writes=[],checks=0;
var ptyPath=require.resolve('@lydell/node-pty'),osPath=require.resolve('../lib/os-users');
var originalPty=require.cache[ptyPath],originalOs=require.cache[osPath];
require.cache[ptyPath]={id:ptyPath,filename:ptyPath,loaded:true,exports:{spawn:function(command,args,options){calls.push({command:command,args:args,options:options});return {write:function(input){writes.push(input);},onData:function(){},onExit:function(){},kill:function(){}};}}};
require.cache[osPath]={id:osPath,filename:osPath,loaded:true,exports:{wrapSpawnAsUser:function(command,args,options){return {command:command,args:args,options:options};}}};
var create=require('../lib/terminal').createTerminal,recipes=require('../lib/yoke/provider-install-recipes');
test.after(function(){if(originalPty)require.cache[ptyPath]=originalPty;else delete require.cache[ptyPath];if(originalOs)require.cache[osPath]=originalOs;else delete require.cache[osPath];fs.rmSync(temporary,{recursive:true,force:true});});
['claude','codex'].forEach(function(vendor){test('production terminal launches only registered '+vendor+' recipe without login shell, commands or credential environment',function(){
  var identity={uid:1001,gid:1001,user:'fixture',home:temporary,shell:'/bin/zsh'};
  process.env.OPENAI_API_KEY='synthetic-secret';process.env.ANTHROPIC_API_KEY='synthetic-secret';
  create('/untrusted-project',80,24,identity,{kind:'provider-install',providerInstall:vendor,initialInput:'touch forbidden',revalidateInstall:function(){checks++;}});
  var call=calls[calls.length-1];assert.equal(call.command,'/bin/bash');assert.deepEqual(call.args,['--noprofile','--norc','-o','pipefail','-c',recipes[vendor].command]);assert.equal(call.options.cwd,temporary);assert.equal(call.options.uid,1001);assert.equal(call.options.gid,1001);assert.equal(call.options.env.HOME,temporary);assert.equal(call.options.env.OPENAI_API_KEY,undefined);assert.equal(call.options.env.ANTHROPIC_API_KEY,undefined);assert.equal(call.options.env.BASH_ENV,undefined);assert.deepEqual(writes,[]);delete process.env.OPENAI_API_KEY;delete process.env.ANTHROPIC_API_KEY;
});});
test('production transport refuses unknown recipes, root and missing or revoked authority before spawn',function(){var count=calls.length;var identity={uid:1001,gid:1001,user:'fixture',home:temporary};assert.throws(function(){create('/',80,24,identity,{providerInstall:'unknown',revalidateInstall:function(){}});});assert.throws(function(){create('/',80,24,identity,{providerInstall:'claude'});});assert.throws(function(){create('/',80,24,Object.assign({},identity,{uid:0}),{providerInstall:'claude',revalidateInstall:function(){}});});assert.throws(function(){create('/',80,24,identity,{providerInstall:'claude',revalidateInstall:function(){throw new Error('revoked');}});});assert.equal(calls.length,count);assert.equal(checks,2);});

test('production terminal manager prevents injected input while a registered installer runs',function(){var tm=require('../lib/terminal-manager').createTerminalManager({cwd:temporary,send:function(){},sendTo:function(){}});var terminal=tm.create(80,24,{uid:1001,gid:1001,user:'fixture',home:temporary},null,{kind:'provider-install',providerInstall:'claude',revalidateInstall:function(){}});tm.write(terminal.id,'touch forbidden\n');assert.deepEqual(writes,[]);tm.destroyAll();});
