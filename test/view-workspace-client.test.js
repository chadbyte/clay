var test=require('node:test'),assert=require('node:assert/strict');
// Pure production client modules: no DOM, storage, providers or transports.
test('client workspace DTO validation and mutations retain bindings and exact revisions',async function(){
  var state=await import('../lib/public/modules/view-workspace-state.js'),validation=await import('../lib/public/modules/view-workspace-validation.js'),store=(await import('../lib/public/modules/store.js')).store;
  var a={id:'a',revision:3,sessions:[{sessionOriginId:'origin-a'}],tree:{id:'origin-a'},activeSessionOriginId:'origin-a'};
  a.workspace=state.recomposeWorkspace(null,a.tree,'origin-a');
  a.workspace.panes.push({instanceId:'file-a',kind:'file',open:true,placement:'docked',resource:{path:'docs/file.md',mode:'pin',rendered:true}});
  a.workspace.tree={axis:'horizontal',ratio:.3,left:a.workspace.tree,right:{id:'file-a'}};
  assert.equal(validation.validWorkspaceView(a),true);
  var empty=state.recomposeWorkspace(a.workspace,null,null);
  assert.deepEqual(empty.tree,{id:'file-a'});assert.equal(empty.panes[0].resource.mode,'pin');
  assert.equal(validation.validWorkspaceView({sessions:[],tree:null,workspace:empty}),true);
  var broken=JSON.parse(JSON.stringify(a));broken.workspace.panes[1].resource.path='../foreign';assert.equal(validation.validWorkspaceView(broken),false);
  broken=JSON.parse(JSON.stringify(a));broken.workspace.panes[1].kind='shell';assert.equal(validation.validWorkspaceView(broken),false);
  var b={id:'b',revision:9,sessions:[],tree:null,workspace:state.recomposeWorkspace(null,null,null)};
  store.set({myUserId:'owner',currentSlug:'project',currentProjectOwnerId:'owner',projectSplitViewSocketGeneration:4,projectSplitViews:[a,b]});
  var oldKey=state.workspaceKey(a);store.set({projectSplitViewSocketGeneration:5});assert.notEqual(state.workspaceKey(a),oldKey);
  var message=state.prepareViewMutation('project_split_view_move',{sourceViewId:'a',targetViewId:'b',sourceSessionOriginId:'origin-a',tree:{id:'origin-a'},activeSessionOriginId:'origin-a'});
  assert.equal(message.expectedViewRevision,3);assert.equal(message.expectedTargetViewRevision,9);assert.equal(message.accountId,'owner');assert.equal(message.projectSlug,'project');
  assert.equal(message.targetWorkspace.panes[0].instanceId,a.workspace.panes[0].instanceId);
  assert.equal(a.workspace.panes.length,2,'preparing a mutation never mutates source state');
  var before = state.displayTree(a.workspace);
  state.replacePaneIdentity(a.workspace, a.workspace.panes[1]);
  assert.deepEqual(state.displayTree(a.workspace), Object.assign({}, before, { right: { id: 'tool-file-' + a.workspace.panes[1].instanceId } }), 'rebinding a file changes only its display identity, retaining its layout slot');
  assert.equal(validation.validWorkspaceView(a), true);
});

test('production controller refuses stale queued edits, delayed context restores and unload writes',async function(){
  var fs=require('node:fs'),vm=require('node:vm'),queued=[],sent=[],events={},resolveApi,resets=0;
  var s={connected:true,projectSplitViewHydrated:true,myUserId:'owner',currentSlug:'project',currentProjectOwnerId:'owner',projectSplitViewSocketGeneration:1,projectSplitViewActiveId:'view',projectSplitViewSavedActiveId:'view'};
  var store={get:function(key){return s[key];},set:function(value){Object.assign(s,value);},snap:function(){return s;},subscribe:function(){}};
  var context=vm.createContext({WORKBENCH_PANELS:{},store:store,JSON:JSON,crypto:require('node:crypto'),queueMicrotask:function(fn){queued.push(fn);},document:{addEventListener:function(name,fn){events[name]=fn;}},window:{addEventListener:function(name,fn){events[name]=fn;}},mutation:function(type,message){sent.push(message);return true;},loadApi:function(){return new Promise(function(resolve){resolveApi=resolve;});}});
  function load(name){var source=fs.readFileSync('lib/public/modules/'+name+'.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/import\(/g,'loadApi(');vm.runInContext(source,context);}
  load('split-view-layout-client');load('view-workspace-state');load('tool-pane-tree');load('view-workspace-controller');
  var view={id:'view',revision:1,sessions:[],tree:null,workspace:{version:1,panes:[],tree:null,activePaneId:null}};
  s.projectSplitViews=[view];
  var run={key:context.workspaceKey(view),restoring:true,restored:{},cancelled:{},unavailable:{},desired:null};s.savedWorkspaceRuntime=run;
  var pending=context.restore(view,run);s.currentSlug='different';resolveApi({resetRightWorkbench:function(){resets++;}});await pending;assert.equal(resets,0,'late import cannot reset another project');
  s.currentSlug='project';run.restoring=false;run.desired=JSON.parse(JSON.stringify(view.workspace));run.desiredBase='stale workspace';
  context.flush();assert.equal(sent.length,0);assert.match(s.projectSplitViewError,/changed/);assert.equal(s.savedWorkspaceRuntime.desired,null);
  s.projectSplitViewError='';context.initSavedWorkspace();events.beforeunload();
  context.capture();assert.equal(sent.length,0,'unload never persists cleanup');
  assert.equal(s.savedWorkspaceLeaving,true);
});

test('fresh Browser open waits only for an unsent command and cancels on changed context',function(){
  var fs=require('node:fs'),vm=require('node:vm'),sent=[],ready=false,ws={},values={connected:true,sharedBrowserOpen:true,myUserId:'owner',currentSlug:'project',projectSplitViewActiveId:'view',sessionOriginId:'origin',projectSplitViewSocketGeneration:1};
  var store={get:function(key){return values[key];},set:function(next){Object.assign(values,next);},subscribe:function(){}};
  var context=vm.createContext({store:store,JSON:JSON,Date:Date,registerRightWorkbench:function(){},getWs:function(){return ws;},ensureBrowserPaneSource:function(){return ready;},hasBrowserPaneHost:function(){return true;},sendBrowserPaneCommand:function(type){if(!ready)return false;sent.push(type);return true;}});
  vm.runInContext(fs.readFileSync('lib/public/modules/shared-browser.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
  context.sendOrQueueBrowserOpen();assert.ok(values.pendingBrowserOpen);assert.deepEqual(sent,[]);
  ready=true;context.resumePendingBrowserOpen();assert.deepEqual(sent,['open']);assert.equal(values.pendingBrowserOpen,null);
  context.resumePendingBrowserOpen();assert.deepEqual(sent,['open'],'a delivered opening is never replayed');
  ready=false;context.sendOrQueueBrowserOpen();values.projectSplitViewActiveId='different';ready=true;context.resumePendingBrowserOpen();assert.deepEqual(sent,['open']);assert.equal(values.pendingBrowserOpen,null);
  ready=false;context.sendOrQueueBrowserOpen();values.sharedBrowserOpen=false;ready=true;context.resumePendingBrowserOpen();assert.deepEqual(sent,['open']);
  values.sharedBrowserOpen=true;
  ['myUserId','currentSlug','sessionOriginId','projectSplitViewSocketGeneration'].forEach(function(key){
    ready=false;context.sendOrQueueBrowserOpen();var previous=values[key];values[key]=String(previous)+'-changed';
    ready=true;context.resumePendingBrowserOpen();assert.equal(values.pendingBrowserOpen,null);assert.deepEqual(sent,['open'],key+' change cancels an unsent opening');values[key]=previous;
  });
  ready=false;context.sendOrQueueBrowserOpen();ws={};ready=true;context.resumePendingBrowserOpen();assert.equal(values.pendingBrowserOpen,null);assert.deepEqual(sent,['open'],'a replacement socket cannot replay the opening');
  ready=false;context.sendOrQueueBrowserOpen();values.connected=false;ready=true;context.resumePendingBrowserOpen();values.connected=true;context.resumePendingBrowserOpen();assert.deepEqual(sent,['open'],'reconnection cannot revive a cancelled opening');
  ready=false;context.sendOrQueueBrowserOpen();values.pendingBrowserOpen.expires=0;ready=true;context.resumePendingBrowserOpen();assert.equal(values.pendingBrowserOpen,null);assert.deepEqual(sent,['open'],'an expired opening cannot run later');
  values.sharedBrowserOpen=true;values.savedViewBrowserListReady=false;context.restoreExistingBrowser({id:'saved'});assert.deepEqual(sent,['open','state_request'],'restore requests state and never creates a browser');
});
