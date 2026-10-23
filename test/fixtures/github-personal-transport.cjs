// Imported only by the isolated settings fixture, before server/terminal services.
var EventEmitter=require('node:events'),cp=require('node:child_process');
var state='authenticated',account={id:123,login:'octo-fixture'},terminals=[],calls=[],failSave=false;
var execute=cp.execFile;
cp.execFile=function(command,args,opts,done){
  if(command!=='gh')return execute.apply(cp,arguments);
  calls.push(args);
  var error=null;
  if(state==='missing' || args[0]!=='--version' && state!=='authenticated')error=Object.assign(new Error('Synthetic GitHub failure'),{code:state==='missing'?'ENOENT':state==='unauthenticated'?4:1});
  setImmediate(function(){done(error,args[0]==='--version'?'gh fixture':JSON.stringify(account));});
  return {stdin:{on:function(){},end:function(){}}};
};
var ptyFile=require.resolve('@lydell/node-pty');
require.cache[ptyFile]={id:ptyFile,filename:ptyFile,loaded:true,exports:{spawn:function(command,args,opts){
  if(command!=='gh')throw new Error('Only synthetic GitHub login PTYs are allowed.');
  var pty=new EventEmitter(),dataHook,exitHook;pty.alive=true;pty.args=args;
  pty.onData=function(hook){dataHook=hook;setImmediate(function(){hook('Fixture GitHub CLI. No provider is contacted.\r\n! Your one-time code: FAKE-CODE\r\nOpen https://github.com/login/device on any device.\r\nPress Enter to continue.\r\n');});};
  pty.onExit=function(hook){exitHook=hook;};pty.write=function(input){if(dataHook)dataHook(input);};pty.resize=function(){};
  pty.exit=function(code){if(!pty.alive)return;pty.alive=false;if(exitHook)exitHook({exitCode:code});};pty.kill=function(){setImmediate(function(){pty.exit(130);});};terminals.push(pty);return pty;
}}};
var storage=require('../../lib/github-connection-store'),attach=storage.attach;
storage.attach=function(root){var service=attach(root),save=service.save;service.save=function(){if(failSave)throw new Error('Synthetic GitHub storage unavailable.');return save.apply(service,arguments);};return service;};
module.exports={handle:function(req,res){
  if(!req.url.startsWith('/__fixture/github'))return false;
  var url=new URL(req.url,'http://fixture.invalid');
  if(url.searchParams.has('state'))state=url.searchParams.get('state');
  if(url.searchParams.has('account'))account=url.searchParams.get('account')==='other'?{id:456,login:'other-fixture'}:{id:123,login:'octo-fixture'};
  if(url.searchParams.has('failSave'))failSave=url.searchParams.get('failSave')==='true';
  if(url.searchParams.has('finish'))terminals.forEach(function(terminal){terminal.exit(0);});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:state,account:account,terminals:terminals.filter(function(t){return t.alive;}).length,calls:calls}));return true;
}};
