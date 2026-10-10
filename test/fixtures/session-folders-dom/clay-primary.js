import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { initProjectMateNavigation } from '/modules/project-mate-navigation.js';
import { renderSessionList } from '/modules/sidebar-sessions.js';
import { initSidebar } from '/modules/sidebar.js';
import { initHeader } from '/modules/app-header.js';
import { initToolPalettes } from '/modules/tool-palette.js';
import { initMateKnowledgeWorkbench } from '/modules/mate-knowledge-workbench.js';
import { initDebatesWorkbench } from '/modules/debates-workbench.js';
import { initSTT } from '/modules/stt.js';
import { initWorkerPaneLock } from '/modules/worker-pane-lock.js';
import { createAssistantBubble, createUserBubble } from '/modules/chat-bubble-renderer.js';
import { avatarUrl } from '/modules/avatar.js';

var options = new URLSearchParams(location.search);
var source = await fetch('/index.html').then(function (response) { return response.text(); });
var shell = new DOMParser().parseFromString(source, 'text/html');
shell.querySelectorAll('script').forEach(function (script) { script.remove(); });
shell.querySelectorAll('head style').forEach(function (style) { document.head.appendChild(style); });
document.body.replaceChildren.apply(document.body, Array.from(shell.body.children));
document.body.className = shell.body.className;
document.body.classList.toggle('wide-view', options.get('layout') !== 'bubble');
document.documentElement.classList.toggle('light-theme', options.get('theme') !== 'dark');
document.getElementById('connect-overlay').classList.add('hidden');
document.getElementById('sidebar-column').style.width = (options.get('sidebar') || '280') + 'px';
document.getElementById('icon-strip-projects').replaceChildren();

var clay = { id: 'clay-built-in', builtinKey: 'clay', name: 'Clay', vendor: 'codex', profile: { displayName: 'Clay', bio: 'A thoughtful partner for everything you are building.', avatarCustom: '/clay-studio-symbol.png' } };
var designer = { id: 'designer', name: 'Ari', vendor: 'claude', profile: { displayName: 'Ari', bio: 'Product design and thoughtful interfaces.' } };
var quiet = { id: 'quiet', name: 'Quiet' };
var namedClay = { id: 'named-clay', name: 'Clay', profile: { displayName: 'Clay', bio: 'An ordinary Mate named Clay.' } };
var now = Date.now();
var sessions = ['Make room for the next idea', 'A calmer morning routine', 'Map the launch week', 'Notes from our design review', 'The questions worth asking', 'A reading list for October', 'An idea for the weekend', 'Plan the next small step', 'Organize the research', 'Find a name that feels right', 'Thinking through the tradeoffs', 'What we want to build next'].map(function (title, index) {
  return { id: 801 + index, title: title, vendor: index % 3 === 1 ? 'claude' : 'codex', sessionRole: 'driver', lastActivity: now - index * 3600000, createdAt: now - index * 3600000, active: index === 0, unread: index === 3 ? 1 : 0, isProcessing: false };
});
sessions.push({ id: 850, title: 'Explore the workspace surfaces', vendor: 'codex', sessionRole: 'worker', parentSessionId: 801, parentAvailable: true, workerGeneration: 2, lastActivity: now, createdAt: now, isProcessing: false });
sessions.push({ id: 851, title: 'Earlier visual exploration', vendor: 'codex', sessionRole: 'worker', parentSessionId: 801, parentAvailable: true, workerGeneration: 1, lastActivity: now - 3600000, createdAt: now - 3600000, isProcessing: false });
window.__opened = [];
window.__panelCloses = [];
window.__sent = [];
window.__store = store;
var initialSlug = options.get('workspace') === 'clay' ? 'mate-clay-built-in' : 'project';
createStore({
  cachedMatesList: [], currentSlug: initialSlug, activeProjectSlug: initialSlug, activeProjectMateId: null,
  activeSessionId: 801, activeSessionMode: 'gui', currentVendor: 'codex', connected: true, dmMode: false, homeShellVisible: false,
  projectsHubList: [{slug: 'project', title: 'Studio', icon: ''}], dmUnread: {}, projectMateFilterActivated: true,
  splitPanes: null, splitGroups: [{ id: 'preview-pair', members: [801, 850], pair: {version: 2, driverId: 801, workerIds: [850]} }],
  sessionFolders: null, sessionFolderLayouts: {}, sessionSearch: null, sessionPresence: {}, permissions: {},
  sessionCreate: null, sessionCreateOptions: null, sessionCreateLocks: {}, sidebarCreationEffects: []
});
setWs({ readyState: 1, send: function (raw) { window.__sent.push(JSON.parse(raw)); } });
initToolPalettes();
initMateKnowledgeWorkbench();
initDebatesWorkbench();
initSTT();
document.getElementById('stt-btn').addEventListener('click', function (event) { event.stopImmediatePropagation(); }, true);
initSidebar({
  sessionListEl: document.getElementById('session-list'), projectName: '',
  headerTitleEl: document.getElementById('header-title'), sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebar-overlay'), hamburgerBtn: document.getElementById('hamburger-btn'),
  sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'), sidebarExpandBtn: document.getElementById('sidebar-expand-btn'),
  $: function (id) { return document.getElementById(id); }
});
renderSessionList(sessions);
initHeader();
initProjectMateNavigation();
window.__loadMates = function () { store.set({ cachedMatesList: [clay, designer, quiet, namedClay] }); };
if (!options.has('late')) window.__loadMates();

var project = document.createElement('button');
project.type = 'button';
project.className = 'icon-strip-item icon-strip-project-mate';
project.dataset.slug = 'project';
project.setAttribute('aria-label', 'Open Studio project');
project.innerHTML = '<span class="icon-strip-label">ST</span><span class="icon-strip-pill"></span>';
project.addEventListener('click', function () { store.set({currentSlug: 'project', activeProjectSlug: 'project', homeShellVisible: false, dmMode: false}); });
document.getElementById('icon-strip-projects').prepend(project);
document.getElementById('header-title').textContent = sessions[0].title;
document.getElementById('input').placeholder = 'Message Clay...';
document.getElementById('input').value = 'Let’s start with the workspace.';
document.getElementById('send-btn').disabled = false;
document.querySelector('.user-island-name').textContent = 'Chad';
document.querySelector('.user-island-avatar-letter').textContent = 'C';
document.getElementById('config-chip-wrap').classList.remove('hidden');
document.getElementById('active-vendor-indicator').classList.remove('hidden');
document.getElementById('active-vendor-icon').src = '/codex-avatar.png';
document.getElementById('config-chip-label').textContent = 'GPT-6 Astra';

function addAssistant(html, time, worker) {
  var bubble = createAssistantBubble({name: worker ? 'Codex' : 'Clay', avatarUrl: worker ? '/codex-avatar.png' : '/clay-studio-symbol.png', time: time});
  bubble.querySelector('.md-content').innerHTML = html;
  document.getElementById('messages').appendChild(bubble);
}
function addUser(text, time) {
  document.getElementById('messages').appendChild(createUserBubble({name: 'Chad', avatarUrl: avatarUrl('imprint', 'preview-person', 34), time: time, text: text}));
}
addUser('I have a few ideas competing for attention. Help me find a clear starting point for the week.', '9:41');
addAssistant('<p>Let’s give each idea a place, then choose one thing to move forward.</p><p>From our conversations, three threads keep coming back:</p><ul><li><strong>The workspace:</strong> make the everyday experience feel calm and intentional.</li><li><strong>The launch:</strong> explain what Clay makes possible through a few real examples.</li><li><strong>The rhythm:</strong> leave room to think between rounds of building.</li></ul>', '9:42');
addUser('The workspace is the one I keep returning to. It should feel like somewhere I can settle in, without making everything bigger.', '9:44');
addAssistant('<p>Then that is our starting point. We can keep the familiar proportions and let the surrounding surfaces do more of the work.</p><p>I’ll keep the conversation easy to read, the session list close at hand, and the tools where you already expect them.</p>', '9:44');
var evidence = document.createElement('details');
evidence.className = 'tool-group done collapsed';
evidence.innerHTML = '<summary class="tool-group-header"><span class="tool-group-chevron"><i data-lucide="chevron-right"></i></span><span class="tool-group-label">Reviewed 3 references</span><span class="tool-group-status-icon"><i data-lucide="check"></i></span></summary><div class="tool-group-body">Workspace surfaces · Conversation proportions · Session list</div>';
document.getElementById('messages').appendChild(evidence);
addAssistant('<p>We can start with one small change today, then see how it feels in daily use. I’ve kept the other ideas here so we can come back to them when you’re ready.</p>', '9:45');

if (options.get('pane')) {
  document.body.classList.add('pane-mode');
  store.set({ paneMode: true, paneSessionId: 850, activeSessionId: 850 });
  document.getElementById('messages').replaceChildren();
  addAssistant('<p>I’ve checked the existing layout. The session list stays compact, and the conversation keeps its current reading width.</p><p>The first pass is ready to review with the rest of the workspace.</p><ul><li>Keep the original rail artwork.</li><li>Preserve the bio below the Mate name.</li><li>Keep all controls in their existing positions.</li></ul>', '9:46', true);
  initWorkerPaneLock();
} else if (options.has('split')) {
  var host = document.createElement('div');
  host.id = 'split-host';
  host.className = 'visible';
  var app = document.getElementById('app');
  var driver = document.createElement('div');
  driver.className = 'split-pane split-pane-role-driver';
  driver.innerHTML = '<div class="split-pane-header"><img class="split-pane-vendor" src="/clay-studio-symbol.png" alt=""><span class="split-pane-title">Make room for the next idea</span><span class="split-pair-role split-pair-role-driver">Driver</span></div>';
  driver.appendChild(app);
  var worker = document.createElement('div');
  worker.className = 'split-pane split-pane-role-worker';
  worker.innerHTML = '<div class="split-pane-header"><img class="split-pane-vendor" src="/codex-avatar.png" alt=""><span class="split-pane-title">Workspace exploration</span><span class="split-pair-role split-pair-role-split-worker">Split Worker</span><button class="split-pane-close" aria-label="Close Worker preview"><i data-lucide="x"></i></button></div>';
  var frame = document.createElement('iframe');
  frame.className = 'split-pane-frame';
  frame.title = 'Worker preview';
  frame.src = '/clay-primary.html?workspace=clay&pane=worker&theme=' + (options.get('theme') || 'light');
  worker.appendChild(frame);
  host.append(driver, worker);
  document.getElementById('main-panels').prepend(host);
  store.set({ splitPanes: {groupId: 'preview-pair', panes: [{sessionId: 801, slug: initialSlug}, {sessionId: 850, slug: initialSlug}]} });
  worker.querySelector('button').addEventListener('click', function () { worker.remove(); store.set({splitPanes: null}); });
}
window.lucide.createIcons();
document.body.dataset.ready = 'true';
