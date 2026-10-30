var test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('delayed presentation restore cannot expand a pane in a replaced View or connection',async function(){
  for(var change of ['view','generation','revision','disconnected']){
    var current={id:'v',revision:2,workspace:{panes:[],presentation:{focusedSessionOriginId:null,expandedPaneId:null}}},generation=1,connected=true,called=0,resolvers=[];
    var context=vm.createContext({store:{get:function(k){return k==='connected'?connected:false;},set:function(){called++;}},activeSavedView:function(){return current;},workspaceKey:function(v){return v.id+':'+generation;},Promise:Promise,load:function(){return new Promise(function(resolve){resolvers.push(resolve);});}});
    vm.runInContext(fs.readFileSync('lib/public/modules/view-presentation-state.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/import\(/g,'load('),context);
    var pending=context.restoreViewPresentation(current,'v:1');
    if(change==='view')current=Object.assign({},current,{id:'other'});else if(change==='revision')current=Object.assign({},current,{revision:3});else if(change==='generation')generation=2;else connected=false;
    resolvers.forEach(function(resolve){resolve({});});assert.equal(await pending,false);assert.equal(called,0,change);
  }
});
test('a saved expansion is skipped when that pane restored as unavailable',async function(){
  var source=fs.readFileSync('lib/public/modules/view-presentation-state.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/import\(/g,'load(');
  for(var unavailable of [true,false]){
    var calls=[],sets=[],run={key:'v:1',unavailable:{terminal:unavailable}};
    var view={id:'v',revision:2,workspace:{panes:[{instanceId:'pane-t',kind:'terminal',open:true,placement:'overlay',resource:{id:1,identity:'shell',runtimeId:'runtime:old'}}],presentation:{focusedSessionOriginId:null,expandedPaneId:'pane-t'}}};
    var context=vm.createContext({WORKBENCH_PANELS:{},setWorkbenchExpanded:function(){},activeSavedView:function(){return view;},workspaceKey:function(v){return v.id+':1';},paneOwner:function(p){return p.kind;},workspaceChanged:function(){},Promise:Promise,
      store:{get:function(k){return k==='connected'?true:k==='savedWorkspaceRuntime'?run:k==='savedWorkspaceLeaving'?false:undefined;},set:function(v){sets.push(v);}},
      load:function(name){return Promise.resolve(name.indexOf('terminal')>=0?{setTerminalExpanded:function(e){calls.push(['terminal',e]);}}:name.indexOf('browser')>=0?{setBrowserExpanded:function(e){calls.push(['browser',e]);}}:name.indexOf('file-pane')>=0?{filePaneStates:function(){return {};},filePaneState:function(){return null;},updateFilePaneState:function(){},repaintFilePane:function(){}}:{renderPresentationSplitView:function(){}});}});
    vm.runInContext(source,context);
    assert.equal(await context.restoreViewPresentation(view,'v:1'),true);
    assert.deepEqual(calls,[['terminal',!unavailable],['browser',false]],String(unavailable));
    assert.equal(sets.some(function(v){return 'savedViewExpandedOwner' in v&&v.savedViewExpandedOwner===(unavailable?null:'terminal');}),true,String(unavailable));
  }
});
