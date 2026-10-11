import { createStore, store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { renderSessionList } from '/modules/sidebar-sessions.js';
import { renderMobileSessionsInto } from '/modules/sidebar-mobile.js';
import { createWorkerHistoryControl } from '/modules/sidebar-session-hierarchy.js';
import { initSidebar } from '/modules/sidebar.js';

var result = document.getElementById('result');
var sent = [];
var now = Date.now();
var ordinary = [{
  id: 701, title: 'A deliberately long session title that should scroll smoothly to reveal every word', vendor: 'codex', sessionRole: 'driver',
  lastActivity: now, createdAt: now, unread: 0, isProcessing: true, loop: null,
  linearLinks: [{ provider: 'linear', url: 'https://linear.app/clay/issue/TLE-168', identifier: 'TLE-168', title: 'HelpLine follow-up overview', stateName: 'Build' }],
}, {
  id: 703, title: 'Short', vendor: 'codex', sessionRole: 'driver',
  lastActivity: now, createdAt: now, unread: 0, isProcessing: false, loop: null,
}];
var debate = [{
  id: 702, title: 'Dedicated debate', vendor: 'claude', sessionRole: 'driver',
  lastActivity: now, createdAt: now, unread: 0, isProcessing: false, loop: null,
  homeDebatePlanning: true, homeDebatePhase: 'ended',
}];

function count(selector, root) { return (root || document).querySelectorAll(selector).length; }
function assert(value, message) { if (!value) throw new Error(message); }

try {
  createStore({
    currentSlug: 'proj', activeProjectSlug: 'proj', activeProjectMateId: null,
    cachedMatesList: [], projectsHubList: [], splitGroups: [], splitPanes: null,
    sessionFolders: null, sessionFolderLayouts: {}, sessionSearch: null,
    sessionPresence: { '701': [{ id: 'viewer', displayName: 'Viewer', avatarStyle: 'imprint', avatarSeed: 'viewer' }] },
    permissions: {}, connected: true, isMultiUserMode: true, dmMode: false,
    sessionCreate: null, sessionCreateOptions: null, sessionCreateLocks: {},
    sessionCreateReveal: null, sidebarCreationEffects: [],
  });
  setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
  window.__fixtureSent = sent;
  var inert = new Proxy({
    sessionListEl: document.getElementById('session-list'),
    projectName: 'Fixture',
    $: function (id) { return document.getElementById(id); },
  }, { get: function (target, key) { return key in target ? target[key] : document.createElement('div'); } });
  try { initSidebar(inert); } catch (error) { /* ctx is established before optional fixture controls are touched. */ }

  renderSessionList(ordinary);
  assert(count('#session-list .session-item') === 2, 'desktop ordinary rows missing');
  assert(count('#session-list .session-presence') === 1, 'desktop presence missing');
  assert(count('#session-list .session-item-age') === 0, 'desktop row still renders inline activity age');
  assert(document.querySelector('#session-list .session-item-text').getAttribute('title') === null, 'desktop activity tooltip uses native title');

  store.set({ activeProjectMateId: 'mate-a', cachedMatesList: [{ id: 'mate-a' }] });
  renderSessionList(null);
  assert(count('#session-list .session-item') === 2, 'desktop Mate rows missing');
  assert(count('#session-list .session-vendor-mark') === 0, 'Mate row retained vendor mark');

  var mobile = document.getElementById('mobile-host');
  renderMobileSessionsInto(mobile);
  assert(count('.mobile-session-item', mobile) === 2, 'mobile Mate rows missing');
  assert(count('.mobile-session-item .mobile-session-title[title]', mobile) === 2, 'mobile activity title missing');

  var createButton = document.querySelector('#session-list .session-folder-new-btn');
  assert(createButton, 'Mate new-session control missing');
  createButton.click();
  renderSessionList(null);
  assert(sent.length === 1 && sent[0].type === 'new_session' && sent[0].mateDefaults === true, 'Mate create did not use direct defaults');
  assert(document.querySelector('#session-list .session-folder-new-btn').getAttribute('aria-busy') === 'true', 'Mate create pending state missing');

  store.set({ sessionCreate: null, sessionPresence: {} });
  renderSessionList(debate);
  assert(count('#session-list .session-item') === 0, 'debate leaked into desktop list');
  mobile.innerHTML = '';
  renderMobileSessionsInto(mobile);
  assert(count('.mobile-session-item', mobile) === 0, 'debate leaked into mobile list');
  assert(count('#session-list .session-folder-empty') > 0, 'desktop debate-only list lacks an honest empty state');
  store.set({ sessionPresence: { '701': [{ id: 'viewer', displayName: 'Viewer', avatarStyle: 'imprint', avatarSeed: 'viewer' }] } });
  renderSessionList(ordinary);
  mobile.innerHTML = '';
  renderMobileSessionsInto(mobile);
  window.__renderWorkerScenario = function (running, selectedId) {
    var parent = { id: 704, title: 'Worker parent', vendor: 'claude', sessionRole: 'driver', lastActivity: now + 2, createdAt: now + 2, unread: 0, isProcessing: false, active: selectedId === 704, loop: null };
    var current = { id: 705, title: 'Current Worker', vendor: 'codex', sessionRole: 'worker', parentSessionId: 704, parentAvailable: true, workerGeneration: 2, lastActivity: now + 4, createdAt: now + 4, unread: 0, isProcessing: !!running, active: false, loop: null };
    var history = { id: 706, title: 'Previous Worker', vendor: 'codex', sessionRole: 'worker', parentSessionId: 704, parentAvailable: true, workerGeneration: 1, lastActivity: now + 3, createdAt: now + 3, unread: 1, isProcessing: false, active: false, loop: null };
    store.set({ activeSessionId: selectedId || null, splitGroups: [{ id: 'worker-group', members: [704, 705], pair: { version: 2, driverId: 704, workerIds: [705] } }] });
    var next = ordinary.concat([parent, current, history]);
    renderSessionList(next);
    mobile.innerHTML = '';
    renderMobileSessionsInto(mobile);
    var controls = document.getElementById('in-session-controls');
    if (controls) controls.innerHTML = '';
    if (controls && selectedId === 704) {
      controls.appendChild(createWorkerHistoryControl(parent, [current, history], {
        className: 'session-worker-history-in-session',
        validate: function (driver) { return store.get('connected') && store.get('activeSessionId') === driver.id; },
      }));
    }
  };
  result.textContent = 'PASS';
  document.body.dataset.result = 'pass';
} catch (error) {
  result.textContent = error.stack || error.message;
  document.body.dataset.result = 'fail';
}
