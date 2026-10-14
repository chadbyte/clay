// Isolated browser fixture: production registry, Mate update handler and settings UI.
var fs = require('fs');
var path = require('path');
var http = require('http');
var os = require('os');
var home = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-avatar-browser-'));
process.env.CLAY_HOME = home; process.env.CLAY_CONFIG = path.join(home, 'daemon.json'); process.env.CLAY_DEV = '';
var mates = require('../../lib/mates');
var owner = {userId:'avatar-fixture-owner',multiUser:true,linuxUser:null};
var mate = mates.createMate(owner,{vendor:'codex'});
var lead = mates.createBuiltinMate(owner,'clay');
var second = mates.createMate(owner,{vendor:'codex'});
mates.updateMate(owner,second.id,{name:'Bea',profile:Object.assign({},second.profile,{displayName:'Bea',avatarCustom:'/fixture/custom.png'})});
var locked = mates.createMate(owner,{vendor:'codex'});
mates.updateMate(owner,locked.id,{name:'Locked',profile:Object.assign({},locked.profile,{displayName:'Locked',avatarLocked:true})});
// Start from a legacy face to exercise deliberate migration.
mates.updateMate(owner,mate.id,{name:'Ari',bio:'A thoughtful partner for product design.',status:'ready',profile:{displayName:'Ari',avatarStyle:'bottts',avatarSeed:'fixture-legacy'}});
var handler = require('../../lib/server-mates').attachMates({users:{isMultiUser:function(){return true;}},mates:Object.assign({},mates,{buildMateCtx:function(){return owner;}}),projects:new Map()});
var publicRoot = path.resolve(__dirname,'../../lib/public');
var harness = path.resolve(__dirname,'session-folders-dom');
var script = fs.readFileSync(path.join(harness,'mate-settings.js'),'utf8');
var start = script.indexOf('var mate ='); var end = script.indexOf('createStore(',start);
script = script.slice(0,start) + "var mate = await fetch('/fixture/mate'+location.search).then(function(r){return r.json();});\n" + script.slice(end);
start = script.indexOf('var ws ='); end = script.indexOf('setWs(ws);',start);
script = script.slice(0,start) + [
  "var ws={readyState:1,send:function(raw){var msg=JSON.parse(raw);window.__sent.push(msg);",
  "if(window.__fail && msg.type==='mate_update') msg.updates.profile.avatarCatalogId='B99';",
  "fetch('/fixture/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(msg)}).then(function(r){return r.json();}).then(function(r){",
  "if(r.type==='mate_error')handleHomeMateAvatarError(r);",
  "if(r.type==='mate_updated'){mate=r.mate;store.set({cachedMatesList:(store.get('cachedMatesList')||[]).map(function(item){return item.id===r.mate.id?r.mate:item;})});syncHomeMateSettingsTarget(r);}",
  "});}};\n"
].join('\n') + script.slice(end);
script += "\nvar bar=document.querySelector('.home-mate-settings-header');[['Fixture offline',function(){window.__offline(ws.readyState===1);}],['Fixture invalid save',function(){window.__fail=window.__fail?'':'invalid';}],['Fixture theme',function(){document.documentElement.classList.toggle('light-theme');}]].forEach(function(entry){var b=document.createElement('button');b.textContent=entry[0];b.addEventListener('click',entry[1]);bar.appendChild(b);});";
script += [
  "if(new URLSearchParams(location.search).has('strip')){",
  "var settings=await import('/modules/home-mate-settings.js');settings.closeHomeMateSettings(true);",
  "window.__opened=[];window.__panelCloses=[];",
  "var sidebar=await import('/modules/sidebar.js');sidebar.initSidebar({sessionListEl:document.getElementById('session-list'),projectName:'',headerTitleEl:document.getElementById('header-title'),sidebar:document.getElementById('sidebar'),sidebarOverlay:document.getElementById('sidebar-overlay'),hamburgerBtn:document.getElementById('hamburger-btn'),sidebarToggleBtn:document.getElementById('sidebar-toggle-btn'),sidebarExpandBtn:document.getElementById('sidebar-expand-btn'),$:function(id){return document.getElementById(id);}});",
  "var all=await fetch('/fixture/mates').then(function(r){return r.json();});",
  "store.set({cachedMatesList:all,currentSlug:'fixture-project',activeProjectSlug:'fixture-project',projectsHubList:[{slug:'fixture-project',name:'Fixture project'}],homeShellVisible:false,dmMode:false});window.store=store;",
  "var rail=document.getElementById('icon-strip-projects');rail.replaceChildren();",
  "var ordinary=document.createElement('button');ordinary.type='button';ordinary.className='icon-strip-item';ordinary.dataset.slug='fixture-project';ordinary.setAttribute('aria-label','Fixture project');ordinary.textContent='P';rail.appendChild(ordinary);",
  "var projects=await import('/modules/sidebar-projects.js');ordinary.addEventListener('contextmenu',function(e){e.preventDefault();projects.showProjectCtxMenu(ordinary,'fixture-project','Fixture project');});",
  "var navigation=await import('/modules/project-mate-navigation.js');navigation.initProjectMateNavigation();document.getElementById('header-title').replaceChildren(createHomeMateSettingsTrigger(all.find(function(m){return m.name==='Ari';})));window.__stripReady=true;",
  "var requestedMenu=new URLSearchParams(location.search).get('avatarMenu');var menuMate=all.find(function(m){return m.name===requestedMenu;});if(menuMate){var menuAnchor=rail.querySelector('[data-mate-id=\"'+menuMate.id+'\"]');menuAnchor.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));}",
  "}"
].join('\n');
var types = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
var server=http.createServer(function(req,res){
  var url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture/mates'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mates.getAllMates(owner)));return;}
  if(url.pathname==='/fixture/custom.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync(path.join(publicRoot,'mate-avatars/B07.png')));return;}
  if(url.pathname==='/fixture/mate'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(mates.getMate(owner,url.searchParams.get('lead')==='1'?lead.id:mate.id)));return;}
  if(url.pathname==='/fixture/message' && req.method==='POST'){
    var bytes=''; req.on('data',function(chunk){bytes+=chunk;});req.on('end',function(){
      try{var msg=JSON.parse(bytes);var ws={readyState:1,_clayUser:{id:owner.userId},send:function(raw){res.setHeader('Content-Type','application/json');res.end(raw);}};if(!handler.handleMessage(ws,msg)){res.writeHead(400);res.end('{}');}}
      catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
    });return;
  }
  if(url.pathname==='/mate-settings.js'){res.setHeader('Content-Type','text/javascript');res.end(script);return;}
  if(url.pathname==='/api/generated-avatar'){
    require('../../lib/dicebear-avatar').renderAvatar(url.searchParams.get('style'),url.searchParams.get('seed'),52).then(function(svg){res.setHeader('Content-Type','image/svg+xml');res.end(svg);}).catch(function(){res.writeHead(400);res.end();});return;
  }
  if(url.pathname==='/clay-primary-stubs.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(harness,'clay-primary-stubs.js')));return;}
  var file=url.pathname==='/' || url.pathname==='/mate-settings.html'?path.join(harness,'mate-settings.html'):path.resolve(publicRoot,'.'+url.pathname);
  if(file.indexOf(publicRoot+path.sep)!==0 && file!==path.join(harness,'mate-settings.html')){res.writeHead(403);res.end();return;}
  fs.readFile(file,function(err,data){if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
});
server.listen(Number(process.argv[2]||27150),'127.0.0.1',function(){console.log('Avatar fixture http://127.0.0.1:'+server.address().port+' (pid '+process.pid+')');});
function stop(){server.close(function(){fs.rmSync(home,{recursive:true,force:true});process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
