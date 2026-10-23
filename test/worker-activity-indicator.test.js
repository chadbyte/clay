var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function load(name, context) { vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context); }
function fixture() {
  var now = 0, callbacks = [], sent = [], recorded = [];
  var socket = { readyState: 1, send: function (data) { sent.push(JSON.parse(data)); } };
  var worker = { id: 2, sessionRole: 'worker', sessionOriginId: 'worker', parentSessionId: 1, parentAvailable: true, workerGeneration: 1, ownerId: 'owner', isProcessing: true };
  var sessions = [{ id: 1, sessionRole: 'driver', sessionOriginId: 'driver', ownerId: 'owner' },worker];
  var icon = { style: {}, dataset: {}, setAttribute: function (name,value) { this[name] = value; } };
  var chip = { dataset: { workerParent:'driver',workerOrigin:'worker',workerGeneration:'1' }, getClientRects:function(){return hidden ? []:[{}];},closest:function(){return hidden ? {}:null;},querySelector:function(){return icon;} }, hidden=false;
  var document = { hidden: false, readyState:'complete',querySelectorAll:function(){return [chip];},getElementById:function(){return null;},addEventListener:function(){} };
  var context = vm.createContext({ performance:{now:function(){return now;}},document:document,MutationObserver:function(){this.observe=function(){};},
    crypto:{randomUUID:function(){return 'request-'+sent.length;}},requestAnimationFrame:function(callback){callbacks.push(callback);},getWs:function(){return socket;},
    getCachedSessions:function(){return sessions;},iconHtml:function(){return '';},messagePreviewKey:function(kind,ids){return JSON.stringify([context.store.get('currentSlug'),context.store.get('myUserId'),kind,ids]);},
    bindAgentMessageBubble:function(node,key){node.dataset.messagePreview=key;},rememberAgentMessage:function(){},rememberAgentActivity:function(key,value){recorded.push(value);},forgetAgentMessage:function(){},
  });
  load('store',context);context.createStore({ connected:true,currentSlug:'project',myUserId:'owner',projectSplitViewSocketGeneration:1,workerActivityIndicators:{} });
  load('worker-activity-indicator',context);load('worker-message-previews',context);
  function flush(){while(callbacks.length)callbacks.shift()();}
  context.syncWorkerMessagePreviews();flush();
  function receive(sequence,live,extra){var request=sent.at(-1);context.handleWorkerMessagePreview(Object.assign({requestId:request.requestId,parentSessionOriginId:'driver',workerSessionOriginId:'worker',generation:1,live:live,activity:sequence?{epoch:'epoch',sequence:sequence,queryGeneration:1,timestamp:1000,summary:'Running a command'}:null},extra||{}));}
  return {context:context,store:context.store,sessions:sessions,worker:worker,chip:chip,icon:icon,receive:receive,flush:flush,sent:sent,recorded:recorded,time:function(value){now=value;},hide:function(){hidden=true;},snapshot:function(){return context.store.get('workerActivityIndicators')[chip.dataset.messagePreview];}};
}
test('actual preview controller steps once per 350ms burst window, never animates replay or builds a backlog',function(){
  var f=fixture();f.receive(null,false);f.receive(1,true);assert.equal(f.snapshot().angle,30);
  f.time(100);for(var i=2;i<=20;i++)f.receive(i,true);assert.equal(f.snapshot().angle,30);assert.equal(f.snapshot().cursor.sequence,20);
  f.time(350);f.receive(21,true);assert.equal(f.snapshot().angle,60);
  f.receive(21,true);f.receive(20,true);assert.equal(f.snapshot().angle,60);
  f.time(100000);assert.equal(f.snapshot().angle,60,'elapsed time alone does not move icon');
  f.receive(22,false);assert.equal(f.snapshot().angle,60,'snapshot is not new activity');
  f.context.syncWorkerMessagePreviews();f.flush();assert.equal(f.snapshot().angle,60,'rerender does not advance');
  assert.equal(f.icon.dataset.state,'working','silence never infers idle');
});
test('context, ownership, exact generation, request and socket authority reject stale activity',function(){
  for(var change of ['owner','project','generation','request','socket']){
    var f=fixture();f.receive(null,false);
    if(change==='owner')f.store.set({myUserId:'foreign'});
    if(change==='project')f.store.set({currentSlug:'other'});
    if(change==='generation')f.worker.workerGeneration=2;
    if(change==='socket')f.store.set({projectSplitViewSocketGeneration:2});
    f.receive(1,true,change==='request'?{requestId:'old'}:{});
    assert.equal(f.snapshot().angle,0,change);
  }
});
test('hide, disconnect, generation replacement and owner retarget clear rotation and previews; reconnect snapshots stay still',function(){
  for(var change of ['hide','disconnect','generation','owner','removal','document']){
    var f=fixture();f.receive(null,false);f.receive(1,true);
    if(change==='hide')f.hide();
    if(change==='removal')f.sessions.splice(1);
    if(change==='document')f.context.document.hidden=true;
    if(change==='disconnect')f.store.set({connected:false});
    if(change==='generation'){f.worker.workerGeneration=2;f.chip.dataset.workerGeneration='2';}
    if(change==='owner')f.store.set({myUserId:'other'});
    f.context.syncWorkerMessagePreviews();f.flush();
    assert.equal(Object.keys(f.store.get('workerActivityIndicators')).length,0,change);
  }
  var f=fixture();f.receive(null,false);f.receive(1,true);f.store.set({connected:false});f.flush();
  f.store.set({connected:true,projectSplitViewSocketGeneration:2});f.flush();f.receive(50,false);assert.equal(f.snapshot().angle,0);
});
test('query generations reset rotation and reject late lower sequence or generation receipts',function(){
  var f=fixture();f.receive(null,false);f.receive(1,true);
  f.receive(2,true,{activity:{epoch:'epoch',sequence:2,queryGeneration:2,timestamp:2000,summary:'Thinking'}});
  assert.equal(f.snapshot().angle,30);assert.equal(f.snapshot().activity.queryGeneration,2);
  f.receive(3,true);assert.equal(f.snapshot().activity.queryGeneration,2);
  f.receive(null,false);f.receive(1,true);assert.equal(f.snapshot().angle,0);
});
test('preview recency follows observed server age and monotonic elapsed time rather than the browser wall clock',function(){
  var now=2000,line={textContent:''},node={querySelector:function(){return line;}},context=vm.createContext({
    performance:{now:function(){return now;}},Date:{now:function(){throw new Error('Browser wall clock must not determine activity age');}},
    document:{addEventListener:function(){}},window:{addEventListener:function(){}},store:{subscribe:function(){}},
  });
  load('agent-message-bubbles',context);
  context.renderActivity(node,{timestamp:1,summary:'Reading files'},true,{age:18000,received:1000});
  assert.equal(line.textContent,'Reading files · last activity 19s ago');
  now=42000;context.renderActivity(node,{timestamp:1,summary:'Reading files'},true,{age:18000,received:1000});
  assert.equal(line.textContent,'Reading files · last activity 59s ago');
  context.renderActivity(node,{timestamp:1,summary:'Reading files'},true,null);assert.match(line.textContent,/Activity time unavailable/);
  context.renderActivity(node,null,true,null);assert.equal(line.textContent,'Activity time unavailable');
});
test('authoritative runtime snapshots preserve running/idle status without advancing motion',function(){
  var f=fixture();f.receive(null,false);
  f.context.setWorkerActivityRuntime(f.chip.dataset.messagePreview,true);
  f.context.syncWorkerActivityIndicator(f.chip,{isProcessing:false});assert.equal(f.icon.dataset.state,'working');assert.equal(f.snapshot().angle,0);
  f.context.setWorkerActivityRuntime(f.chip.dataset.messagePreview,false);
  f.context.syncWorkerActivityIndicator(f.chip,{isProcessing:true});assert.equal(f.icon.dataset.state,'ready');assert.equal(f.snapshot().angle,0);
});
