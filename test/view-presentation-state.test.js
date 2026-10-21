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
