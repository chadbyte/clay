import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { renderSessionList } from '/modules/sidebar-sessions.js';
import { initSidebar } from '/modules/sidebar.js';
import { initHeader } from '/modules/app-header.js';

var now = Date.now();
var parent = { id: 804, title: 'Worker parent', vendor: 'claude', sessionRole: 'driver', lastActivity: now, createdAt: now, unread: 0, isProcessing: false, active: true };
var current = { id: 805, title: 'Current Worker', vendor: 'codex', sessionRole: 'worker', parentSessionId: 804, parentAvailable: true, workerGeneration: 3, lastActivity: now + 3, createdAt: now + 3, unread: 0, isProcessing: true };
var replaced = { id: 806, title: 'Replaced Worker', vendor: 'codex', sessionRole: 'worker', parentSessionId: 804, parentAvailable: true, workerGeneration: 2, lastActivity: now + 2, createdAt: now + 2, unread: 0, isProcessing: false };
var oldest = { id: 807, title: 'Oldest Worker', vendor: 'codex', sessionRole: 'worker', parentSessionId: 804, parentAvailable: true, workerGeneration: 1, lastActivity: now + 1, createdAt: now + 1, unread: 0, isProcessing: false };
var sent = [];
var opened = [];
var socket = { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } };

createStore({ currentSlug: 'proj', activeProjectSlug: 'proj', activeProjectMateId: null, activeSessionId: 804, activeSessionMode: 'gui', connected: true, dmMode: false, splitPanes: null, splitGroups: [], sessionFolders: null, sessionFolderLayouts: {}, sessionSearch: null, sessionPresence: {}, cachedMatesList: [] });
setWs(socket);
window.open = function (url) { opened.push(url); return {}; };
var inert = new Proxy({ sessionListEl: document.getElementById('session-list'), projectName: 'Fixture', $: function (id) { return document.getElementById(id); } }, { get: function (target, key) { return key in target ? target[key] : document.createElement('div'); } });
try { initSidebar(inert); } catch (error) { /* header fixture only needs sidebar state initialized before rendering. */ }
renderSessionList([parent, current, replaced, oldest]);
initHeader();

window.__headerScenario = function (split) {
  sent.length = 0;
  opened.length = 0;
  var splitPanes = split ? { groupId: 'worker-group', panes: [{ sessionId: 804, slug: 'proj', title: parent.title }, { sessionId: 805, slug: 'proj', title: current.title }] } : null;
  store.set({ activeSessionId: 804, splitPanes: splitPanes, splitGroups: [{ id: 'worker-group', members: [804, 805], pair: { version: 2, driverId: 804, workerIds: [805] } }] });
};
window.__headerState = function () { return { sent: sent.slice(), opened: opened.slice(), split: store.get('splitPanes') }; };
window.__replaceSocket = function () { setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } }); };
window.__closeSplit = function () { store.set({ splitPanes: null }); };
document.body.dataset.result = 'pass';
document.getElementById('result').textContent = 'PASS';
