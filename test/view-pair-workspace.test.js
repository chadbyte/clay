var test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
test('linked Worker layout is validated independently of ordinary membership and exact live pair authority', async function () {
  var workspace=require('../lib/project-view-workspace'), pair=require('../lib/project-view-pair');
  var view={sessionRefs:[{originId:'driver'}],tree:{id:'driver'},activeSessionOriginId:'driver'}, value=workspace.legacy(view), session=value.panes[0].instanceId;
  value.linkedPair={groupId:'pair',driverOriginId:'driver',workerOrigins:['worker'],tree:{axis:'horizontal',ratio:.37,left:{id:'driver'},right:{id:'worker'}}};
  assert.equal(workspace.validate(value,view).ok,true);
  var client=await import('../lib/public/modules/view-workspace-validation.js'); assert.equal(client.validWorkspaceView({sessions:[{sessionOriginId:'driver'}],tree:view.tree,workspace:value}),true);
  assert.equal(value.panes.length,1); assert.equal(value.panes[0].instanceId,session);
  var d={localId:1,ownerId:'owner',sessionOriginId:'driver'}, w={localId:2,ownerId:'owner',sessionOriginId:'worker',sessionProvenance:{kind:'worker',parentSessionOriginId:'driver'}};
  var group={id:'pair',pair:{driverId:1,workerIds:[2]}}, ctx={sm:{sessions:new Map([[1,d],[2,w]])},getViewPairGroup:function(){return group;},canAccessSession:function(){return true;}}, ws={_clayUser:{id:'owner'}};
  assert.equal(pair.authorized(ctx,ws,value.linkedPair),true); w.sessionOriginId='replacement'; assert.equal(pair.authorized(ctx,ws,value.linkedPair),false); w.sessionOriginId='worker';
  assert.equal(pair.authorized(ctx,{_clayUser:{id:'foreign'}},value.linkedPair),false);
  value.linkedPair.workerOrigins.push('driver'); assert.equal(workspace.validate(value,view).ok,false); value.linkedPair.workerOrigins.pop();
  value.linkedPair.tree.right.id='foreign'; assert.equal(workspace.validate(value,view).ok,false);
});
test('deferred production coordinate migration waits for bindings and retains exact tool positions and ratios', function () {
  var s={connected:true,projectSplitViewHydrated:true,myUserId:'owner',currentSlug:'project',currentProjectOwnerId:'owner',projectSplitViewSocketGeneration:1,projectSplitViewActiveId:'v',projectSplitViewSavedActiveId:'v',rightWorkbenchDockedOwners:[]};
  var store={get:function(k){return s[k];},set:function(v){Object.assign(s,v);},snap:function(){return s;},subscribe:function(){}};
  var c=vm.createContext({store:store,JSON:JSON,crypto:require('node:crypto'),queueMicrotask:function(){},filePaneStates:function(){return {};},document:{},window:{}});
  function load(n){vm.runInContext(fs.readFileSync('lib/public/modules/'+n+'.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),c);}
  load('split-view-layout-client');load('view-workspace-state');load('tool-pane-tree');load('view-legacy-coordinates');load('view-presentation-state');load('view-workspace-controller');
  var view={id:'v',sessions:[{sessionOriginId:'driver'}],tree:{id:'driver'},activeSessionOriginId:'driver'}; view.workspace=c.recomposeWorkspace(null,view.tree,'driver');s.projectSplitViews=[view];
  var record={base:{id:'driver'},tree:{axis:'vertical',ratio:.28,left:{id:'tool-terminal'},right:{axis:'horizontal',ratio:.73,left:{id:'driver'},right:{id:'tool-browser'}}}};
  s.workbenchLayoutPreference={ready:true,layouts:{}};s.workbenchLayoutPreference.layouts[JSON.stringify(['project','owner','driver'])]=record;
  var run={key:c.workspaceKey(view),restoring:false,restored:{},cancelled:{},unavailable:{},legacyEligible:true,migrated:false};s.savedWorkspaceRuntime=run;
  c.migrateCoordinates(view,run); assert.equal(run.migrated,false);assert.deepEqual(JSON.parse(JSON.stringify(s.savedWorkspaceLegacyLayout.record)),record);
  s.rightWorkbenchDockedOwners=['terminal']; c.migrateCoordinates(view,run);assert.equal(run.migrated,false,'dock intent without a resource is insufficient');
  s.savedViewTerminalResource={id:1,identity:'pty',runtimeId:'runtime'};c.capture(); assert.equal(s.savedWorkspaceRuntime.desired.panes.length,2);
  // A later Browser identity completes the same deferred record, not a default layout.
  s.rightWorkbenchDockedOwners=['terminal','browser'];s.sharedBrowser={id:'browser'};s.controlRuntimeId='runtime';s.sessionOriginId='driver';
  c.migrateCoordinates(view,s.savedWorkspaceRuntime); assert.equal(s.savedWorkspaceRuntime.migrated,true);
  assert.deepEqual(JSON.parse(JSON.stringify(c.displayTree(s.savedWorkspaceRuntime.desired))),record.tree);
  assert.equal(s.savedWorkspaceRuntime.desired.panes.length,3);
});
test('legacy singleton Files coordinates wait for a real binding and map only the unique docked instance',async function(){
  var api=await import('../lib/public/modules/view-legacy-coordinates.js');
  var record={base:{id:'driver'},tree:{axis:'horizontal',ratio:.31,left:{id:'tool-file-viewer'},right:{id:'driver'}}},value={panes:[]};
  assert.equal(api.legacyCoordinatesReady(record,value),false);
  value.panes.push({instanceId:'file1',kind:'file',open:true,placement:'docked'});
  assert.equal(api.legacyCoordinatesReady(record,value),true);var mapped=api.boundLegacyCoordinates(record,value);assert.equal(mapped.tree.left.id,'tool-file-file1');assert.equal(mapped.tree.ratio,.31);assert.equal(record.tree.left.id,'tool-file-viewer');
});
