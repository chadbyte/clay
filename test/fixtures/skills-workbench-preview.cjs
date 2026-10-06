// Production Skills UI with sample inventory and simulated installation events.
var http = require('http'), fs = require('fs'), path = require('path');
var root = path.resolve(__dirname, '../../lib/public');
var index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var sections = index.slice(index.indexOf('<div id="skills-modal"'), index.indexOf('<!-- Debate Modal'));
var installed = {
  'clay-agent-browser': { scope: 'global', source: 'clay-builtin', description: 'Browse websites together in Clay and check your work in the live Browser panel.' },
  'frontend-design': { scope: 'project', source: 'agents-project', description: 'Create thoughtful interfaces with careful typography, layout, and interaction design.', path: '/example/project/.agents/skills/frontend-design' },
  'release-checklist': { scope: 'global', source: 'agents-global', description: 'Review release notes, compatibility, and checks before publishing a new version.' }
};
var events = [];
var catalog = [{ name: 'Accessibility review', skillId: 'accessibility-review', source: 'example/skills', installs: 12400, description: 'Review keyboard navigation, semantics, contrast, and screen reader support.' }, { name: 'Writing clearly', skillId: 'writing-clearly', source: 'example/skills', installs: 8500, description: 'Edit technical writing for clarity, structure, and useful detail.' }];
var script = `
import { createStore } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { initMcp, handleMcpServersState } from '/modules/mcp-ui.js';
import { initSkills, handleSkillInstalled, handleSkillUninstalled } from '/modules/skills.js';
createStore({ currentSlug:'preview', myUserId:'owner', activeSessionId:1, connected:true, permissions:{skills:true}, mcpSkillsWorkbench:{} });
setWs({readyState:1,send:function(){}});
initMcp(); initSkills(); handleMcpServersState({servers:[],slug:'preview'});
setInterval(function(){fetch('/preview-events').then(function(res){return res.json();}).then(function(events){events.forEach(function(event){if(event.type==='skill_installed')handleSkillInstalled(event);else handleSkillUninstalled(event);});});},300);
`;
var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1;padding:32px}#main-panels:has(.panel-fullscreen:not(.hidden))>#app{display:none}.preview-label{color:var(--text-muted);max-width:320px;line-height:1.8;font-size:13px}</style></head><body><div id="main-panels"><main id="app"><button id="mcp-btn">MCP / Skills</button><p class="preview-label">Skills workbench preview. Sample inventory only; installing and removing here does not change real skills.</p></main></div>' + sections + '<script src="https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js"></script><script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js"></script><script>window.addEventListener("error",function(e){var p=document.createElement("pre");p.textContent=e.message;document.body.appendChild(p);});</script><script type="module">' + script + '</script></body></html>';
var server = http.createServer(function (req,res) {
  var url = new URL(req.url,'http://localhost');
  function json(data) { res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data)); }
  if(url.pathname==='/') {res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(url.pathname==='/preview-events') {var next=events;events=[];json(next);return;}
  if(url.pathname==='/api/installed-skills') {json({installed:installed});return;}
  if(url.pathname==='/api/skills'||url.pathname==='/api/skills/search') {var q=(url.searchParams.get('q')||'').toLowerCase();json({skills:catalog.filter(function(item){return item.name.toLowerCase().includes(q);})});return;}
  if(url.pathname==='/api/skills/detail') {var row=catalog.find(function(item){return item.skillId===url.searchParams.get('skill');});json(Object.assign({},row,{skillMd:'<h2>Review the user experience</h2><p>Start with the essential tasks. Check keyboard access, visible focus, useful labels, and clear recovery from errors.</p><h3>How to use</h3><p>Ask your agent to review a screen before release.</p>',weeklyInstalls:'1.2K'}));return;}
  if(req.method==='POST'&&(url.pathname==='/api/install-skill'||url.pathname==='/api/uninstall-skill')) {
    var body='';req.on('data',function(chunk){body+=chunk;});req.on('end',function(){var data=JSON.parse(body);var add=url.pathname==='/api/install-skill';
      if(add){var row=catalog.find(function(item){return item.skillId===data.skill;});installed[data.skill]=Object.assign({},row,{scope:installed[data.skill]&&installed[data.skill].scope!==data.scope?'both':data.scope});}
      else if(installed[data.skill]&&installed[data.skill].scope==='both')installed[data.skill].scope=data.scope==='project'?'global':'project';else delete installed[data.skill];
      json({ok:true});setTimeout(function(){events.push({type:add?'skill_installed':'skill_uninstalled',skill:data.skill,scope:data.scope,success:true});},600);
    });return;
  }
  var file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,function(error,data){if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(data);});
});
server.listen(0,'127.0.0.1',function(){console.log('Preview: http://127.0.0.1:'+server.address().port);});
