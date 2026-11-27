var test = require('node:test');
var assert = require('node:assert/strict');
var Manager = require('../lib/yoke/acp-process-manager').AcpProcessManager;
var KiroServer = require('../lib/yoke/kiro-acp-server').KiroAcpServer;
var createGeneric = require('../lib/yoke/acp-query-handle').createAcpQueryHandle;
var createKiro = require('../lib/yoke/adapters/kiro').contractTestKit.createQueryHandle;
function tick() { return new Promise(function(resolve) { setImmediate(resolve); }); }
function fixture(vendor, options) {
  options = options || {};
  var server = vendor === 'kiro' ? new KiroServer('/fixture/kiro', {}) : new Manager('/fixture/acp', {});
  var replies = [], calls = [], reviews = [], prompts = [];
  server.started = true;
  server.proc = { stdin: { write: function() { return true; }, end: function() {} }, kill: function() {} };
  server._write = function(msg) { replies.push(msg); return true; };
  server.send = function(method, params) {
    calls.push({method: method, params: params});
    if (method === 'session/new' || method === 'session/load' || method === 'session/resume') return Promise.resolve({sessionId: 's'});
    if (method === 'session/prompt') return new Promise(function(resolve, reject) { prompts.push({resolve: resolve, reject: reject}); });
    return Promise.resolve({});
  };
  var bridge = [{name:'clay-tools',command:'/fixture/node',args:['--session','7','--query-generation','2']}];
  function make(resume) {
    return (vendor === 'kiro' ? createKiro : createGeneric)(server, {
      vendor: 'qwen', engine: 'v3', cwd: '/fixture', resumeSessionId: resume ? 's' : null, canLoadSession: true,
      mcpServers: bridge, driver: {permissionModeGuaranteed: true},
      canUseTool: options.malformedCallback ? {} : options.missing ? null : function(name, input, opts) {
        if (options.throwing) throw new Error('Reviewer unavailable');
        return new Promise(function(resolve, reject) { reviews.push({resolve:resolve,reject:reject,signal:opts.signal}); });
      },
    });
  }
  var handle = make(options.resume);
  function request(id, choices, overrides) {
    server._handleMessage({jsonrpc:'2.0', id:id, method:'session/request_permission', params:Object.assign({
      sessionId:'s',toolCall:{toolCallId:'tool-'+id,kind:'execute',rawInput:{command:'echo fixture'}},
      options: choices === undefined ? [{optionId:'always',kind:'allow_always'}, {optionId:'once',kind:'allow_once'}, {optionId:'deny',kind:'reject_once'}] : choices,
    }, overrides || {})});
  }
  return {server:server, handle:handle, request:request, replies:replies, calls:calls, reviews:reviews, prompts:prompts, make:make, bridge:bridge};
}
function selected(f) { return f.replies.filter(function(msg) { return msg.result && msg.result.outcome && msg.result.outcome.outcome === 'selected'; }); }
['qwen','kiro'].forEach(function(vendor) {
  ['Stop','close','end','failed','disconnect','rebind','removed'].forEach(function(boundary) {
    test(vendor+': real router retires pending approvals on '+boundary, async function() {
      var f = fixture(vendor); f.handle.pushMessage('first'); await tick();
      f.request(1); await tick(); assert.equal(f.reviews.length,1);
      if (boundary === 'Stop') await f.handle.abort();
      if (boundary === 'close') f.handle.close();
      if (boundary === 'end') { f.prompts[0].resolve({stopReason:'end_turn'}); await tick(); f.handle.pushMessage('next'); await tick(); }
      if (boundary === 'failed') f.prompts[0].reject(new Error('Prompt failed'));
      if (boundary === 'disconnect') f.server._disconnect(new Error('Fixture disconnected'));
      if (boundary === 'rebind') f.server.handlers[0].sessionId = 'replacement';
      if (boundary === 'removed') f.server.removeHandler(f.server.handlers[0]);
      await tick(); f.reviews[0].resolve({behavior:'allow'}); await tick();
      assert.equal(selected(f).length,0);
      if (boundary !== 'disconnect') assert.equal(f.replies.filter(function(msg) {return msg.id===1;}).length,1);
      assert.equal(f.reviews[0].signal.aborted,true);
      f.handle.close();
    });
  });
  test(vendor+': idle, rebound and replaced-process handles cannot cancel another turn', async function() {
    var f=fixture(vendor,{resume:true});f.handle.close();await tick();assert.equal(f.replies.length,0);
    f.handle=f.make(true);f.handle.pushMessage('active');await tick();
    f.server.handlers[0].sessionId='replacement';f.handle.abort();await tick();
    assert.equal(f.replies.some(function(frame){return frame.method==='session/cancel';}),false);
    f.handle=f.make(true);f.handle.pushMessage('active');await tick();
    f.server.proc={stdin:{write:function(){return true;},end:function(){}},kill:function(){}};f.server._processGeneration++;
    f.handle.abort();await tick();assert.equal(f.replies.some(function(frame){return frame.method==='session/cancel';}),false);
  });
  test(vendor+': real router deduplicates across settled turns and replacement queries', async function() {
    var f=fixture(vendor);f.handle.pushMessage('first');await tick();f.request(9);f.request(9);await tick();
    assert.equal(f.reviews.length,1);f.reviews[0].resolve({behavior:'allow'});await tick();
    assert.equal(selected(f)[0].result.outcome.optionId,'once');
    f.prompts[0].resolve({stopReason:'end_turn'});await tick();f.handle.pushMessage('second');await tick();f.request(9);await tick();assert.equal(f.reviews.length,1);
    f.handle.close();await tick();f.handle=f.make(true);f.handle.pushMessage('resume');await tick();f.request(9);await tick();assert.equal(f.reviews.length,1);
    assert.equal(f.replies.filter(function(msg){return msg.id===9;}).length,1);f.handle.close();
  });
  test(vendor+': malformed and persistent-only permissions never reach a reviewer', async function() {
    var f=fixture(vendor);f.handle.pushMessage('start');await tick();
    [null,{},[],[null],[{optionId:'x',kind:'unknown'}],[{optionId:'x',kind:'allow_once'},{optionId:'x',kind:'reject_once'}],
      [{optionId:'always',kind:'allow_always'}]].forEach(function(choices,i){f.request(20+i,choices);});
    f.request(27,undefined,{options:undefined});f.request(28,undefined,{toolCall:null});f.request(29,undefined,{sessionId:'foreign'});await tick();
    assert.equal(f.reviews.length,0);assert.equal(selected(f).length,0);assert.equal(f.replies.length,10);f.handle.close();
  });
  test(vendor+': non-function approval callback fails closed', async function() {
    var f=fixture(vendor,{malformedCallback:true});f.handle.pushMessage('start');await tick();f.request(31);await tick();
    assert.equal(f.replies.length,1);assert.equal(f.replies[0].result.outcome.optionId,'deny');f.handle.close();
  });
  [true,false].forEach(function(missing) {
    test(vendor+': '+(missing?'missing':'throwing')+' reviewer fails closed', async function() {
      var f=fixture(vendor,{missing:missing,throwing:!missing});f.handle.pushMessage('start');await tick();f.request(30);await tick();
      assert.equal(f.replies.length,1);assert.notEqual(f.replies[0].result.outcome.optionId,'once');f.handle.close();
    });
  });
  test(vendor+': query capacity stops without evicting earlier receipts', async function() {
    var f=fixture(vendor,{missing:true});f.handle.pushMessage('start');await tick();
    for(var i=0;i<1025;i++) f.request(100+i);
    await tick();assert.equal(f.handle.pushMessage('must not replay'),false);assert.equal(selected(f).length,0);
    f.request(100);await tick();assert.equal(f.replies.filter(function(msg){return msg.id===100;}).length,1);
    var events=[];for await(var event of f.handle)events.push(event);
    assert.ok(events.some(function(event){return event.yokeType==='error' && /tracking limit/.test(event.text);}));
  });
  test(vendor+': fresh and resumed bridges retain exact inputs and ask policy', async function() {
    var f=fixture(vendor);f.handle.pushMessage('fresh');await tick();f.request(40);await tick();assert.equal(f.reviews.length,1);
    f.handle.close();await tick();f.handle=f.make(true);f.handle.pushMessage('resume');await tick();f.request(41);await tick();assert.equal(f.reviews.length,2);
    assert.deepEqual(f.calls.find(function(call){return call.method==='session/new';}).params.mcpServers,f.bridge);
    assert.deepEqual(f.calls.find(function(call){return call.method==='session/load';}).params.mcpServers,f.bridge);f.handle.close();
  });
  test(vendor+': disconnected process callbacks cannot answer a replacement process', async function() {
    var f=fixture(vendor);f.handle.pushMessage('first');await tick();f.request(50);await tick();f.server._disconnect(new Error('lost'));await tick();
    f.server.proc={stdin:{write:function(){return true;},end:function(){}},kill:function(){}};f.server._processGeneration++;f.server.started=true;
    f.handle=f.make(true);f.handle.pushMessage('replacement');await tick();f.request(50);await tick();
    f.reviews[0].resolve({behavior:'allow'});await tick();assert.equal(selected(f).length,0);
    f.reviews[1].resolve({behavior:'allow'});await tick();assert.equal(selected(f).length,1);f.handle.close();
  });
});
test('real ACP router rejects unknown methods exactly once and fences direct callbacks', async function() {
  var f=fixture('qwen');f.handle.pushMessage('start');await tick();
  var msg={jsonrpc:'2.0',id:60,method:'terminal/create',params:{sessionId:'s'}};f.server._handleMessage(msg);f.server._handleMessage(msg);
  assert.equal(f.replies.length,1);assert.equal(f.replies[0].error.code,-32601);
  var release;f.server.addRequestHandler('fixture/delayed',function(){return new Promise(function(resolve){release=resolve;});});
  f.server._handleMessage({jsonrpc:'2.0',id:61,method:'fixture/delayed'});await tick();f.server._disconnect(new Error('lost'));
  f.server.proc={stdin:{write:function(){return true;},end:function(){}},kill:function(){}};f.server._processGeneration++;f.server.started=true;release({secret:'fixture'});await tick();
  assert.equal(f.replies.filter(function(reply){return reply.id===61;}).length,0);f.handle.close();
});
test('real ACP router closes at its process receipt limit without replay', function() {
  var f=fixture('qwen');
  for(var i=0;i<4097;i++)f.server._handleMessage({jsonrpc:'2.0',id:i,method:'fixture/unknown'});
  assert.equal(f.server.started,false);assert.equal(f.replies.length,4097);assert.match(f.replies[4096].error.message,/tracking limit/);
  f.server._handleMessage({jsonrpc:'2.0',id:1,method:'fixture/unknown'});assert.equal(f.replies.length,4097);f.handle.close();
});

test('generic allow-all remains query-local and cannot grant persistent options', async function() {
  var f=fixture('qwen');await f.handle.setToolPolicy('allow-all');f.handle.pushMessage('first');await tick();f.request(70);await tick();
  assert.equal(f.reviews.length,0);assert.equal(selected(f)[0].result.outcome.optionId,'once');
  f.request(71,[{optionId:'always',kind:'allow_always'}]);await tick();assert.equal(selected(f).length,1);
  f.handle.close();await tick();f.handle=f.make(true);f.handle.pushMessage('resume');await tick();f.request(72);await tick();assert.equal(f.reviews.length,1);f.handle.close();
});

test('Kiro rejects unadvertised elicitation instead of leaving a routed request pending', async function() {
  var f=fixture('kiro');f.handle.pushMessage('start');await tick();
  var msg={jsonrpc:'2.0',id:80,method:'elicitation/create',params:{sessionId:'s',mode:'form',message:'Question'}};
  f.server._handleMessage(msg);f.server._handleMessage(msg);assert.equal(f.replies.length,1);assert.equal(f.replies[0].error.code,-32601);f.handle.close();
});

test('generic allow-all with no approval callback still fails closed', async function() {
  var f=fixture('qwen',{missing:true});await f.handle.setToolPolicy('allow-all');f.handle.pushMessage('start');await tick();f.request(90);await tick();
  assert.equal(f.replies.length,1);assert.equal(f.replies[0].result.outcome.optionId,'deny');f.handle.close();
});
