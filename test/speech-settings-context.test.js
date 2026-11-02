var test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  var state={myUserId:'alice',connected:true,currentSlug:'project',speechSettingsContextGeneration:1},listeners=[],requests=[],socket={readyState:1};
  var store={get:function(key){return state[key];},set:function(patch){var prev=state;state=Object.assign({},state,patch);listeners.forEach(function(fn){fn(state,prev);});},subscribe:function(fn){listeners.push(fn);}};
  var context={store:store,getWs:function(){return socket;},stopSTT:function(){},JSON:JSON,window:{top:{document:{dispatchEvent:function(){}},Event:function(){}}},fetch:function(){return new Promise(function(resolve,reject){requests.push({resolve:resolve,reject:reject});});}};
  vm.createContext(context);var source=fs.readFileSync(require.resolve('../lib/public/modules/stt-settings.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
  return {api:context,store:store,requests:requests,switchSocket:function(){socket={readyState:1};},reply:function(index,value,ok){requests[index].resolve({ok:ok!==false,json:async function(){return value;}});}};
}
test('newest speech load wins and network failure retains the authorized collection',async function(){
  var f=fixture(),a=f.api.loadSpeechSettings(),b=f.api.loadSpeechSettings();f.reply(1,{selected:'browser',language:'ko-KR',configured:[],providers:[],models:[]});await b;
  f.reply(0,{selected:'browser',language:'en-US',configured:['old']});await a;assert.equal(f.store.get('speechLang'),'ko-KR');
  var c=f.api.loadSpeechSettings();f.requests[2].reject(new Error('network'));await c;assert.equal(f.store.get('speechLang'),'ko-KR');assert.match(f.store.get('speechSettingsError'),/unavailable/);
});
['myUserId','currentSlug','projectSplitViewSocketGeneration','connected'].forEach(function(key){
  test('late speech read and save cannot publish after '+key+' changes',async function(){
    var f=fixture(),read=f.api.loadSpeechSettings();var patch={};patch[key]=key==='connected'?false:'changed';f.store.set(patch);
    f.reply(0,{selected:'browser',language:'fr-FR',configured:['groq']});await read;assert.equal(f.store.get('speechSettings'),null);
    f=fixture();var saving=f.api.saveSpeechSettings({provider:'groq',key:'synthetic-only'});f.store.set(patch);f.reply(0,{selected:'browser',language:'fr-FR',configured:['groq']});await assert.rejects(saving,/changed/);assert.equal(f.store.get('speechSettings'),null);assert.equal(f.store.get('speechSettingsSaving'),false);
  });
});
test('socket replacement alone fences a late speech result',async function(){var f=fixture(),read=f.api.loadSpeechSettings();f.switchSocket();f.reply(0,{selected:'browser',language:'fr-FR'});await read;assert.equal(f.store.get('speechSettings'),undefined);});

test('authorization loss hides the old speech collection and invalidates secret drafts',async function(){var f=fixture();f.store.set({speechSettings:{configured:['groq']}});var read=f.api.loadSpeechSettings();f.requests[0].resolve({ok:false,status:401,json:async function(){return {error:'Unauthorized'};}});await read;assert.equal(f.store.get('speechSettings'),null);assert.equal(f.store.get('speechSettingsContextGeneration'),2);assert.match(f.store.get('speechSettingsError'),/Sign in again/);});
