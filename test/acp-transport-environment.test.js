var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
test('ACP/Kiro launch and OpenCode wrappers preserve defaults and replace explicit environments', function(t) {
  var root=fs.mkdtempSync(path.join(os.tmpdir(),'clay-acp-env-'));
  t.after(function(){fs.rmSync(root,{recursive:true,force:true});});
  var script = [
    'var assert=require("node:assert/strict"),cp=require("node:child_process"),EventEmitter=require("node:events"),PassThrough=require("node:stream").PassThrough;',
    'var captured=[], children=[]; process.env.CLAY_ACP_AMBIENT_SENTINEL="fixture";',
    'cp.spawn=function(binary,args,opts){captured.push(opts);var p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=function(){};children.push(p);return p;};',
    'var Manager=require("./lib/yoke/acp-process-manager").AcpProcessManager,Kiro=require("./lib/yoke/kiro-acp-server").KiroAcpServer,profile=require("./lib/yoke/acp-agent-profiles").getAcpAgentProfile("opencode");',
    '(async function(){for(var Ctor of [Manager,Kiro])for(var supplied of [undefined,null,{}, {PATH:"/scoped",SCOPED:"fixture"}]){',
    'var m=new Ctor("/fixture/process",{env:supplied});await m.start();var env=captured[captured.length-1].env;',
    'assert.equal(env.CLAY_ACP_AMBIENT_SENTINEL,supplied==null?"fixture":undefined);if(supplied && supplied.SCOPED)assert.equal(env.SCOPED,"fixture");m.stop();}',
    'for(var supplied of [undefined,null,{}, {PATH:"/scoped",SCOPED:"fixture"}]){var base=profile.buildProcessOptions({driverState:{agentNames:[]}}, {env:supplied});assert.equal(base.env.CLAY_ACP_AMBIENT_SENTINEL,supplied==null?"fixture":undefined);assert.equal(JSON.parse(base.env.OPENCODE_CONFIG_CONTENT).permission,"ask");}',
    'var m=new Manager("/fixture/process",{});await m.start();var old=children[children.length-1];m.stop();await m.start();old.emit("exit",1);assert.equal(m.started,true);m.stop();',
    'var probes=[];cp.execFile=function(binary,args,opts,callback){probes.push(opts.env);callback(null,JSON.stringify(args.indexOf("get-kas-token")>=0?{kind:"getKasToken",data:{accessToken:"fixture"}}:{models:[{model_id:"auto"}],default_model:"auto"}));};',
    'function FakeServer(){this.started=false;this.proc=null;} FakeServer.prototype.start=function(){this.started=true;return Promise.resolve();};FakeServer.prototype.addRequestHandler=function(method,fn){this.token=fn;};FakeServer.prototype.send=function(){return this.token().then(function(){return {protocolVersion:1};});};FakeServer.prototype.stop=function(){this.started=false;};',
    'var adapter=require("./lib/yoke/adapters/kiro").createKiroAdapter({_binaryPath:"/fixture/kiro",_AcpServerCtor:FakeServer});await adapter.init({env:{SCOPED:"fixture"}});assert.equal(probes.length,2);probes.forEach(function(env){assert.equal(env.CLAY_ACP_AMBIENT_SENTINEL,undefined);assert.equal(env.SCOPED,"fixture");});await adapter.shutdown();',
    'console.log("environment and stale-process checks passed");})().catch(function(error){console.error(error);process.exitCode=1;});',
  ].join('\n');
  var result=cp.spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),env:Object.assign({},process.env,{HOME:root,CLAY_HOME:path.join(root,'.clay'),CLAY_CONFIG:path.join(root,'config.json')}),encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/environment and stale-process checks passed/);
});
