import { createPaneStartupRecorder } from '/fixture/split-view-startup-browser.js';
import { verifyWorkerPaging } from '/fixture/split-view-worker-paging-browser.js';
import { store } from '/p/reuse/modules/store.js';
import { getWs, setWs } from '/p/reuse/modules/ws-ref.js';
import { getCachedSessions, renderSessionList } from '/p/reuse/modules/sidebar-sessions.js';
import { listIds, remove } from '/p/reuse/modules/split-view-layout-client.js';

var arrangementEvents = 0, lastArrangement = null;
var observedRuntimeErrorCount = 0;
window.splitViewFixtureRuntimeErrors = [];
window.addEventListener('error', function (event) {
  var stack = event.error && event.error.stack || '';
  window.splitViewFixtureRuntimeErrors.push((event.message || 'window error') + ' (' + (event.filename || '') + ':' + (event.lineno || 0) + ')' + (stack ? '\n' + stack : ''));
});
window.addEventListener('unhandledrejection', function (event) {
  var reason = event.reason && event.reason.stack || event.reason && event.reason.message || String(event.reason);
  window.splitViewFixtureRuntimeErrors.push('Unhandled rejection: ' + reason);
});
document.addEventListener("clay-split-view-arrange", function (event) { arrangementEvents += 1; lastArrangement = event.detail; });
function waitFor(check, label, timeout) {
  var start = performance.now();
  return new Promise(function (resolve, reject) {
    function inspect() {
      if (window.splitViewFixtureRuntimeErrors.length > observedRuntimeErrorCount) { reject(new Error('Browser runtime error: ' + window.splitViewFixtureRuntimeErrors[observedRuntimeErrorCount])); return; }
      if (check()) { resolve(); return; }
      if (performance.now() - start > (timeout || 20000)) { reject(new Error(label + ' readiness deadline exceeded')); return; }
      requestAnimationFrame(inspect);
    }
    inspect();
  });
}
function waitForAsync(check, label, timeout) {
  var start = performance.now();
  return new Promise(function (resolve, reject) {
    async function inspect() {
      try {
        if (window.splitViewFixtureRuntimeErrors.length > observedRuntimeErrorCount) throw new Error('Browser runtime error: ' + window.splitViewFixtureRuntimeErrors[observedRuntimeErrorCount]);
        if (await check()) { resolve(); return; }
        if (performance.now() - start > (timeout || 20000)) throw new Error(label + ' readiness deadline exceeded');
        setTimeout(inspect, 80);
      } catch (error) { reject(error); }
    }
    inspect();
  });
}

function assert(value, message) { if (!value) throw new Error(message); }
function nextFrame() { return new Promise(function (resolve) { requestAnimationFrame(resolve); }); }
function delay(milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); }
function awaitSplitViewResult(requestId) {
  var ws = getWs();
  return new Promise(function (resolve, reject) {
    var timeout = setTimeout(function () { ws.removeEventListener('message', onMessage); reject(new Error('No correlated Split view result for ' + requestId)); }, 10000);
    function onMessage(event) {
      var message;
      try { message = JSON.parse(event.data); } catch (error) { return; }
      if (message.type !== 'project_split_view_result' || message.requestId !== requestId) return;
      clearTimeout(timeout); ws.removeEventListener('message', onMessage); resolve(message);
    }
    ws.addEventListener('message', onMessage);
  });
}
function countViewBroadcastsAfter(requestId, action) {
  var ws = getWs(), count = 0, listener = function (event) {
    var message;
    try { message = JSON.parse(event.data); } catch (error) { return; }
    if (message.type === 'project_split_views' && message.revision > action.revision) count += 1;
  };
  ws.addEventListener('message', listener);
  return function () { ws.removeEventListener('message', listener); return count; };
}
function paneFrame(origin) { return Array.from(document.querySelectorAll('#split-host > .split-pane > .split-pane-frame')).find(function (frame) { return frame.dataset.sessionOriginId === origin; }); }
function rowFor(id) { return document.querySelector('.session-item[data-session-id="' + id + '"]'); }
function pointer(target, type, pointerId, x, y) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: pointerId, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
}
function drag(source, targetRect, side, pointerId, nativeStart) {
  var sourceRect = source.getBoundingClientRect(), x = sourceRect.left + Math.min(40, sourceRect.width / 2), y = sourceRect.top + sourceRect.height / 2;
  var tx = targetRect.left + targetRect.width / 2, ty = targetRect.top + targetRect.height / 2;
  if (side === 'left') tx = targetRect.left + 3;
  if (side === 'right') tx = targetRect.right - 3;
  if (side === 'top') ty = targetRect.top + 3;
  if (side === 'bottom') ty = targetRect.bottom - 3;
  pointer(source.querySelector('.session-item-text') || source, 'pointerdown', pointerId, x, y);
  var started = store.get('projectSplitViewDrag');
  if (nativeStart) source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  pointer(document, 'pointermove', pointerId, x + 10, y + 10);
  pointer(document, 'pointermove', pointerId, tx, ty);
  var moved = store.get('projectSplitViewDrag');
  pointer(document, 'pointerup', pointerId, tx, ty);
  return { started: !!started, moved: !!moved, target: moved && moved.target, sourceId: started && started.sessionId, point: { x: tx, y: ty }, targetRect: { left: targetRect.left, top: targetRect.top, right: targetRect.right, bottom: targetRect.bottom, width: targetRect.width, height: targetRect.height }, paneStyle: (function () { var p = document.querySelector('#split-host > .split-pane'), r = p.getBoundingClientRect(), c = getComputedStyle(p); return { hidden: p.hidden, display: c.display, position: c.position, left: p.style.left, top: p.style.top, width: p.style.width, height: p.style.height, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, single: document.getElementById('split-host').dataset.singlePane }; })(), hostRect: (function () { var h = document.getElementById('split-host'), r = h.getBoundingClientRect(), m = document.getElementById('main-panels').getBoundingClientRect(), c = getComputedStyle(h); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: c.display, position: c.position, className: h.className, mainPanels: { left: m.left, top: m.top, width: m.width, height: m.height } }; })() };
}
function currentView() {
  var views = store.get('projectSplitViews') || [], active = store.get('projectSplitViewActiveId');
  return views.find(function (view) { return view.id === active; }) || null;
}
function treeAtPath(tree, path) { var node = tree; path.forEach(function (side) { node = node && node[side]; }); return node; }
function allPanesReady() {
  var panes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
  var view = currentView(), expected = view ? view.sessions.length : store.get('projectSplitViewSingletonOrigin') ? 1 : 0;
  return panes.length === expected && panes.every(function (pane) {
    var frame = pane.querySelector('.split-pane-frame'), identity = frame && frame.clayPane && frame.clayPane.identity();
    return identity && identity.ready && !frame.dataset.requestedSessionId;
  });
}
function legacyGroupPanesReady(group) {
  var panes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
  return !!group && panes.length === group.members.length && group.members.every(function (id) {
    var pane = panes.find(function (item) { return Number(item.dataset.sessionId) === id; });
    var frame = pane && pane.querySelector('.split-pane-frame'), identity = frame && frame.clayPane && frame.clayPane.identity();
    return identity && identity.ready && identity.sessionId === id && !frame.dataset.requestedSessionId;
  });
}
function allPaneTranscriptsHydrated() {
  var panes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
  return panes.length === (currentView() && currentView().sessions.length) && panes.every(function (pane) {
    var frame = pane.querySelector('.split-pane-frame'), messages = frame && frame.contentDocument && frame.contentDocument.getElementById('messages');
    return messages && messages.textContent.indexOf('EXACT_TRANSCRIPT_') >= 0;
  });
}
function renameActive(name) {
  var view = currentView(), root = view && document.querySelector('.split-view-group[data-split-view-id="' + view.id + '"]');
  assert(root, 'Active Split view sidebar row is missing');
  root.querySelector('.split-view-group-more').click();
  document.querySelector('[data-split-view-action="rename"]').click();
  var input = root.querySelector('.split-view-group-name-input');
  assert(input, 'Inline Rename did not open'); input.value = name;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}
function readIdentity() {
  return Array.from(document.querySelectorAll('#split-host > .split-pane')).map(function (pane) {
    var frame = pane.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
    var doc = frame && frame.contentDocument, input = doc && doc.getElementById('input'), messages = doc && doc.getElementById('messages');
    if (input && !input.disabled && !input.readOnly) { input.value = 'fixture-draft-' + frame.dataset.sessionOriginId; input.dispatchEvent(new Event('input', { bubbles: true })); }
    if (messages) {
      messages.scrollTop = 47;
      messages.dispatchEvent(new frame.contentWindow.WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
      messages.dispatchEvent(new frame.contentWindow.Event('scroll'));
    }
    return { origin: frame && frame.dataset.sessionOriginId, pane: pane, frame: frame, window: frame && frame.contentWindow,
      document: doc, binding: live && JSON.stringify(live.binding), generation: live && live.binding && live.binding.generation,
      draft: input && input.value, scrollTop: messages && messages.scrollTop };
  });
}
function assertSameIdentity(before, label) {
  before.forEach(function (old) {
    var now = paneFrame(old.origin), current = now && now.clayPane && now.clayPane.identity(), doc = now && now.contentDocument;
    assert(now && now === old.frame, label + ' replaced the iframe node for ' + old.origin);
    assert(now.contentWindow === old.window && doc === old.document, label + ' replaced the browsing context for ' + old.origin);
    assert(current && JSON.stringify(current.binding) === old.binding && current.binding.generation === old.generation, label + ' changed pane binding generation for ' + old.origin);
    var input = doc.getElementById('input'), messages = doc.getElementById('messages');
    if (old.draft && input) assert(input.value === old.draft, label + ' lost composer draft for ' + old.origin);
    if (old.scrollTop != null && messages) assert(messages.scrollTop === old.scrollTop, label + ' lost transcript scroll for ' + old.origin + ' (expected ' + old.scrollTop + ', got ' + messages.scrollTop + ')');
  });
}

window.runSplitViewProductionChecks = async function () {
  var result = { checks: [], errors: [], startupSamples: [] };
  var recordStartup = createPaneStartupRecorder();
  observedRuntimeErrorCount = window.splitViewFixtureRuntimeErrors.length;
  function check(name, fn) { return Promise.resolve().then(fn).then(function () { result.checks.push(name); result.startupSamples.push(recordStartup(name)); }, function (error) { result.errors.push(name + ': ' + (error.stack || error.message)); throw error; }); }
  try {
    await waitFor(function () { return store.get('connected') && store.get('projectSplitViewHydrated') && store.get('sessionListProjectSlug') === 'reuse'; }, 'Project and Split view transport');
    await check('production project transport hydrated exact owner/project state', function () {
      assert(getWs() && getWs().readyState === 1, 'project WebSocket is not open');
      var sessions = getCachedSessions() || [], standalone = sessions.filter(function (session) { return /^Standalone [0-8]$/.test(session.title); });
      assert(standalone.length >= 9, 'fixture lacks nine standalone Driver sessions');
      assert((store.get('splitGroups') || []).length >= 2, 'legacy Worker-pair fixture groups are missing');
      result.standaloneIds = standalone.map(function (session) { return session.id; });
      result.legacyPairCount = (store.get('splitGroups') || []).length;
    });
    await check('ordinary standalone Driver starts in one live Pane with the native session header removed', async function () {
      var standalone = (getCachedSessions() || []).find(function (session) { return session.title === 'Standalone 0'; });
      assert(standalone && rowFor(standalone.id), 'fixture standalone Driver or sidebar row is missing');
      result.paneRetargetCalls = []; result.paneRetargetCallCount = 0;
      var observedFrame = document.querySelector('#split-host > .split-pane .split-pane-frame');
      if (observedFrame && observedFrame.clayPane) {
        var originalActivate = observedFrame.clayPane.activate;
        observedFrame.clayPane.activate = function (id, force, target) {
          var before = observedFrame.clayPane.identity(), accepted = originalActivate(id, force, target);
          result.paneRetargetCallCount++;
          var call = { requestedId: id, accepted: accepted, force: !!force, targetOrigin: target && target.sessionOriginId,
            beforeSessionId: before && before.sessionId, beforeOrigin: before && before.binding && before.binding.sessionOriginId };
          if (result.paneRetargetCalls.length < 5) result.paneRetargetCalls.push(call);
          else result.paneRetargetCalls[result.paneRetargetCalls.length - 1] = call;
          return accepted;
        };
      }
      var selectWs = getWs(), switchAcks = [];
      function observeSwitch(event) { try { var message = JSON.parse(event.data); if (message.type === 'session_switched') switchAcks.push({ id: message.id, origin: message.sessionOriginId }); } catch (error) {} }
      if (selectWs) selectWs.addEventListener('message', observeSwitch);
      rowFor(standalone.id).click();
      await delay(400);
      if (store.get('activeSessionId') !== standalone.id && selectWs && selectWs.readyState === 1) {
        result.sidebarSelectionAcknowledged = switchAcks.some(function (ack) { return ack.id === standalone.id; });
        selectWs.send(JSON.stringify({ type: 'switch_session', id: standalone.id }));
      }
      await waitFor(function () { return store.get('activeSessionId') === standalone.id && document.querySelectorAll('#split-host > .split-pane').length === 1 && allPanesReady(); }, 'standalone Pane presentation', 20000).catch(function (error) {
        var paneDebug = document.querySelector('#split-host > .split-pane'), frameDebug = paneDebug && paneDebug.querySelector('.split-pane-frame'), identityDebug = frameDebug && frameDebug.clayPane && frameDebug.clayPane.identity();
        if (selectWs) selectWs.removeEventListener('message', observeSwitch);
        error.message += ' [active=' + store.get('activeSessionId') + ', selected=' + standalone.id + ', ws=' + (selectWs && selectWs.readyState) + ', connected=' + store.get('connected') + ', acknowledgements=' + JSON.stringify(switchAcks) + ', selectedRow=' + (rowFor(standalone.id) && rowFor(standalone.id).className) + ', singleton=' + store.get('projectSplitViewSingletonOrigin') + ', split=' + !!store.get('splitPanes') + ', paneCount=' + document.querySelectorAll('#split-host > .split-pane').length + ', frameSession=' + (frameDebug && frameDebug.dataset.sessionId) + ', frameOrigin=' + (frameDebug && frameDebug.dataset.sessionOriginId) + ', liveReady=' + (identityDebug && identityDebug.ready) + ', liveSession=' + (identityDebug && identityDebug.sessionId) + ', liveOrigin=' + (identityDebug && identityDebug.binding && identityDebug.binding.sessionOriginId) + ', bindingSessions=' + (store.get('paneBindingSessions') || []).length + ']';
        throw error;
      });
      if (selectWs) selectWs.removeEventListener('message', observeSwitch);
      await nextFrame();
      var pane = document.querySelector('#split-host > .split-pane'), frame = pane && pane.querySelector('.split-pane-frame');
      var oldHeader = document.querySelector('#main-column > .title-bar-content');
      assert(pane && document.getElementById('split-host').dataset.singlePane === 'true', 'standalone session did not render the singleton pane canvas');
      assert(oldHeader && getComputedStyle(oldHeader).display === 'none', 'old native session header remains visible above the pane');
      assert(pane.querySelector('.split-pane-title') && !pane.querySelector('.split-pane-rename') && pane.querySelector('.split-pane-info[aria-label="Session information"]'), 'pane title or Info is missing, or the removed pencil remains');
      assert(pane.querySelector('.split-pane-sidebar[aria-expanded]') && !pane.querySelector('.split-pane-sidebar').hidden, 'active singleton Pane has no sidebar control');
      ['todo-sticky', 'ralph-sticky', 'debate-sticky'].forEach(function (id) { var status = document.getElementById(id); assert(status && status.parentNode.id === 'main-panels', id + ' was stranded in the hidden native header'); });
      assert(pane.querySelector('.split-view-arrange-trigger'), 'singleton Pane is missing its Arrange affordance');
      assert(pane.querySelector('.split-pane-close').hidden, 'the only pane exposes a close action');
      assert(frame.contentDocument.querySelectorAll('#input').length === 1, 'singleton Pane does not contain exactly one writable composer');
      assert(store.get('projectSplitViewSingletonOrigin') === standalone.sessionOriginId, 'singleton membership is not bound to the exact active session origin');
      var layout = document.getElementById('layout'), beforeCollapsed = layout.classList.contains('sidebar-collapsed');
      pane.querySelector('.split-pane-sidebar').click();
      assert(layout.classList.contains('sidebar-collapsed') !== beforeCollapsed, 'active Pane sidebar control did not use the existing collapse action');
      if (layout.classList.contains('sidebar-collapsed')) {
        var shellExpand = document.getElementById('sidebar-shell-expand-btn');
        assert(shellExpand && !shellExpand.hidden && shellExpand.getAttribute('aria-label') === 'Open sidebar', 'collapsed split has no persistent shell-level reopen control');
        shellExpand.click();
        assert(!layout.classList.contains('sidebar-collapsed'), 'shell-level reopen control did not use the existing sidebar action');
      }
      await delay(250);
      var frameOrigin = frame.dataset.sessionOriginId, collapsed = layout.classList.contains('sidebar-collapsed');
      frame.dataset.sessionOriginId = 'forged-origin'; pane.querySelector('.split-pane-sidebar').click();
      assert(layout.classList.contains('sidebar-collapsed') === collapsed, 'sidebar control accepted a forged Pane binding');
      frame.dataset.sessionOriginId = frameOrigin;
      result.singletonOrigin = standalone.sessionOriginId;
    });
    await check('singleton Arrange opens the real session chooser and Info reads the exact Pane session', async function () {
      var pane = document.querySelector('#split-host > .split-pane'), info = pane.querySelector('.split-pane-info');
      pane.querySelector('.split-view-arrange-trigger').click();
      var chooser = document.getElementById('split-view-create-menu');
      assert(chooser && !chooser.hidden, 'singleton Arrange did not open the session selection menu');
      assert(chooser.querySelector('[data-create-session-origin="' + result.singletonOrigin + '"]'), 'Arrange chooser did not preselect the exact current session');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      info.click();
      var popover = document.getElementById('split-pane-info-popover');
      assert(popover && popover.dataset.origin === result.singletonOrigin, 'Info popover is not bound to the exact current Pane (session=' + store.get('activeSessionId') + ', identity=' + JSON.stringify(pane.querySelector('.split-pane-frame').clayPane.identity()) + ')');
      assert(popover.textContent.indexOf(String(store.get('activeSessionId'))) >= 0, 'Info popover omits the Pane local session ID');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(!document.getElementById('split-pane-info-popover'), 'Escape did not dismiss Pane Info');
      result.singletonControlsChecked = true;
    });
    await check('session and folder context menus survive sidebar updates and reopen reliably', async function () {
      var session = getCachedSessions().find(function (item) { return item.title === 'Standalone 1'; });
      if (document.getElementById('layout').classList.contains('sidebar-collapsed')) document.querySelector('#split-host .split-pane-sidebar').click();
      await waitFor(function () { return rowFor(session.id).getBoundingClientRect().width > 100; }, 'context sidebar expansion');
      var activeId = store.get('activeSessionId'), row = rowFor(session.id); row.scrollIntoView({ block: 'nearest' });
      var rect = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 25, clientY: rect.top + 10 }));
      var menu = store.get('sessionContextMenu').el;
      assert(menu.isConnected && Math.abs(menu.getBoundingClientRect().left - (rect.left + 25)) <= 1, 'session context menu did not open at pointer');
      result.contextMenuStyle = { font: getComputedStyle(menu.querySelector('button')).fontSize, padding: getComputedStyle(menu.querySelector('button')).padding, background: getComputedStyle(menu).backgroundColor, radius: getComputedStyle(menu).borderRadius };
      renderSessionList(getCachedSessions().map(function (item) { return Object.assign({}, item, { lastActivity: (item.lastActivity || 0) + 1 }); }));
      assert(store.get('sessionContextMenu').el === menu && menu.isConnected && store.get('sessionContextMenu').anchor.isConnected, 'routine session update dismissed the menu or retained a detached anchor');
      var first = menu.querySelector('button'); first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      assert(document.activeElement === menu.querySelectorAll('button')[1], 'session menu ArrowDown did not move focus');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(!menu.isConnected && document.activeElement === rowFor(session.id), 'session Escape did not return to the fresh row');
      assert(store.get('activeSessionId') === activeId, 'right-click selected a different session');
      rowFor(session.id).dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
      assert(store.get('sessionContextMenu'), 'session keyboard context request was missed');
      var replacedMenu = store.get('sessionContextMenu').el;
      rowFor(activeId).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 130, clientY: 220 }));
      assert(store.get('sessionContextMenu').sessionId === activeId && !replacedMenu.isConnected, 'repeated session right-click did not retarget the menu');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.querySelector('[data-new-folder-button="desktop"]').click();
      var input = document.querySelector('.session-folder-create-input'); input.value = 'Context menu fixture'; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await waitFor(function () { return (store.get('sessionFolders').folders || []).some(function (folder) { return folder.name === 'Context menu fixture' || folder.label === 'Context menu fixture'; }); }, 'context fixture folder');
      var folder = document.querySelector('.session-folder-folder'), toggle = folder.querySelector('.session-folder-toggle');
      toggle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 200 }));
      var folderMenu = store.get('sessionFolderMenu').el;
      renderSessionList(null);
      assert(store.get('sessionFolderMenu').el === folderMenu && store.get('sessionFolderMenu').anchor.isConnected, 'folder menu lost its live anchor after a sidebar update');
      toggle = document.querySelector('.session-folder-folder .session-folder-toggle');
      toggle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 140, clientY: 210 }));
      assert(store.get('sessionFolderMenu').el !== folderMenu && !folderMenu.isConnected, 'repeated folder right-click was ignored');
      var currentMenu = store.get('sessionFolderMenu').el;
      assert(getComputedStyle(currentMenu.querySelector('button')).fontSize === result.contextMenuStyle.font && getComputedStyle(currentMenu).borderRadius === result.contextMenuStyle.radius, 'folder and session menus use different control sizing');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(document.activeElement === toggle, 'folder Escape did not return to the current header');
    });
    await check('a different-provider session can be dropped directly onto existing chat history', async function () {
      var source = getCachedSessions().find(function (session) { return session.title === 'Standalone 1'; });
      var pane = document.querySelector('#split-host > .split-pane'), frame = pane.querySelector('.split-pane-frame');
      var target = getCachedSessions().find(function (session) { return session.id === Number(frame.dataset.sessionId); });
      assert(source.vendor !== target.vendor, 'cross-provider fixture does not contain distinct providers');
      if (document.getElementById('layout').classList.contains('sidebar-collapsed')) {
        pane.querySelector('.split-pane-sidebar').click();
        await waitFor(function () { return rowFor(source.id).getBoundingClientRect().width > 100; }, 'expanded cross-provider sidebar');
      }
      var transcript = frame.contentDocument.getElementById('messages'), frameRect = frame.getBoundingClientRect(), messagesRect = transcript.getBoundingClientRect();
      var historyRect = { left: frameRect.left + messagesRect.left, top: frameRect.top + messagesRect.top,
        right: frameRect.left + messagesRect.right, bottom: frameRect.top + messagesRect.bottom, width: messagesRect.width, height: messagesRect.height };
      result.crossProviderHistoryDrag = drag(rowFor(source.id), historyRect, 'center', 590, true);
      assert(!document.querySelector('.split-drop-overlay.visible'), 'legacy native drag overlay obscured the presentation drop target');
      assert(result.crossProviderHistoryDrag.target && result.crossProviderHistoryDrag.target.origin === target.sessionOriginId, 'chat-history drop did not resolve the exact existing session');
      await waitFor(function () { return currentView() && currentView().sessions.length === 2 && !store.get('projectSplitViewPending') && allPanesReady(); }, 'cross-provider chat-history creation');
      currentView().sessions.forEach(function (ref) {
        var session = getCachedSessions().find(function (session) { return session.sessionOriginId === ref.sessionOriginId; });
        var icon = paneFrame(ref.sessionOriginId).parentNode.querySelector('.split-pane-vendor');
        assert(icon && icon.src.indexOf(session.vendor) >= 0, 'mixed-provider pane lost its exact runtime identity');
      });
      assert(paneFrame(target.sessionOriginId) === frame, 'chat-history drop replaced the existing target iframe');
      var root = document.querySelector('.split-view-group[data-split-view-id="' + currentView().id + '"]');
      root.querySelector('.split-view-group-more').click(); document.querySelector('[data-split-view-action="separate"]').click();
      await waitFor(function () { return !currentView() && !store.get('projectSplitViewPending') && allPanesReady(); }, 'restore singleton after cross-provider drop');
    });
    await check('dropping a sidebar session onto another sidebar session creates a persisted Split view', async function () {
      var sessions = getCachedSessions(), source = sessions.find(function (session) { return session.title === 'Standalone 1'; });
      var active = sessions.find(function (session) { return session.id === store.get('activeSessionId'); });
      assert(source && active && source.id !== active.id, 'standalone drag source or active session is unavailable');
      if (document.getElementById('layout').classList.contains('sidebar-collapsed')) {
        document.querySelector('#split-host .split-pane-sidebar').click();
        await waitFor(function () { return rowFor(active.id).getBoundingClientRect().width > 100; }, 'expanded sidebar');
      }
      rowFor(active.id).scrollIntoView({ block: 'nearest' });
      var rect = rowFor(active.id).getBoundingClientRect(); result.dragTrace = drag(rowFor(source.id), rect, 'center', 601);
      assert(result.dragTrace.target && result.dragTrace.target.sidebar, 'session row was not accepted as the drop target');
      await waitFor(function () { return currentView() && currentView().sessions.length === 2 && allPanesReady(); }, 'Split view creation');
      assert(currentView().name === currentView().sessions.map(function (session) { return session.title; }).join(' + '), 'new group name did not derive from the member session titles');
      var titleBar = document.querySelector('#main-column > .title-bar-content');
      assert(titleBar && getComputedStyle(titleBar).display === 'none', 'native session header is visible above a multi-pane canvas');
      Array.from(document.querySelectorAll('#split-host > .split-pane')).forEach(function (pane) {
        assert(pane.querySelector('.split-pane-title') && !pane.querySelector('.split-pane-rename') && pane.querySelector('.split-pane-info[aria-label="Session information"]'), 'multi-pane title or Info is missing, or the removed pencil remains');
      });
      var activePanes = Array.from(document.querySelectorAll('#split-host > .split-pane')).filter(function (pane) { return pane.dataset.active === 'true'; });
      assert(activePanes.length === 1 && !activePanes[0].querySelector('.split-pane-sidebar').hidden, 'sidebar control is not on exactly the active pane');
      assert(Array.from(document.querySelectorAll('#split-host > .split-pane')).filter(function (pane) { return !pane.querySelector('.split-pane-sidebar').hidden; }).length === 1, 'multi-pane view exposes duplicate sidebar controls');
      result.viewId = currentView().id;
    });
    await check('right-clicking a Split view opens its existing options without changing sessions', async function () {
      var group = document.querySelector('.split-view-group[data-split-view-id="' + currentView().id + '"]');
      var heading = group.querySelector('.split-view-group-heading'), more = group.querySelector('.split-view-group-more');
      heading.scrollIntoView({ block: 'nearest' });
      var rect = heading.getBoundingClientRect(), oldRevision = store.get('projectSplitViewRevision'), oldActive = store.get('activeSessionId');
      var event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.left + 25, clientY: rect.top + 10 });
      heading.dispatchEvent(event);
      var menu = document.querySelector('.split-view-menu');
      await nextFrame();
      assert(event.defaultPrevented && !menu.hidden, 'right-click did not open the custom Split view menu');
      assert(menu.querySelector('[data-split-view-action="rename"]') && menu.querySelector('[data-split-view-action="separate"]'), 'right-click menu lost existing group actions');
      assert(more.getAttribute('aria-expanded') === 'true' && document.activeElement === menu.querySelector('button'), 'context menu did not expose its open state or receive focus');
      assert(menu.classList.contains('session-ctx-menu') && menu.querySelector('.session-ctx-item .lucide'), 'Split view menu does not use the existing menu surface and icons');
      assert(getComputedStyle(menu.querySelector('button')).fontSize === result.contextMenuStyle.font && getComputedStyle(menu.querySelector('button')).padding === result.contextMenuStyle.padding && getComputedStyle(menu).borderRadius === result.contextMenuStyle.radius, 'Split view menu sizing differs from session and folder menus');
      assert(Math.abs(menu.getBoundingClientRect().left - (rect.left + 25)) <= 1, 'context menu did not open at the pointer');
      menu.querySelector('button').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      assert(document.activeElement === menu.querySelector('button:last-of-type'), 'Split view menu End did not use shared keyboard navigation');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      assert(menu.isConnected && document.activeElement === menu.querySelector('button'), 'Split view menu Tab behaved differently from the folder menu');
      assert(store.get('projectSplitViewRevision') === oldRevision && store.get('activeSessionId') === oldActive, 'opening group options changed session state');
      renderSessionList(null);
      group = document.querySelector('.split-view-group[data-split-view-id="' + currentView().id + '"]');
      heading = group.querySelector('.split-view-group-heading'); more = group.querySelector('.split-view-group-more');
      assert(store.get('sessionContextMenu').el === menu && store.get('sessionContextMenu').anchor === more && menu.isConnected, 'Split view menu disappeared during a routine sidebar update');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(menu.hidden && document.activeElement === more, 'Escape did not dismiss the group menu and restore focus');
      heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      menu = document.querySelector('.split-view-menu');
      assert(!menu.hidden, 'keyboard context-menu request did not open the group options');
      menu.querySelector('[data-split-view-action="rename"]').click();
      var input = group.querySelector('.split-view-group-name-input');
      assert(input && document.activeElement === input, 'context-menu Rename did not enter title editing');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await check('sidebar group headings and grouped session rows accept additional sessions without duplicates', async function () {
      var initial = currentView(), initialOrigins = initial.sessions.map(function (session) { return session.sessionOriginId; });
      var initialFrames = initialOrigins.map(function (origin) { return paneFrame(origin); });
      var extras = ['Standalone 2', 'Standalone 3'].map(function (title) { return getCachedSessions().find(function (session) { return session.title === title; }); });
      for (var index = 0; index < extras.length; index++) {
        var group = document.querySelector('.split-view-group[data-split-view-id="' + initial.id + '"]');
        var target = index === 0 ? group.querySelector('.split-view-group-heading') : rowFor(initial.sessions[0].id);
        target.scrollIntoView({ block: 'nearest' });
        var trace = drag(rowFor(extras[index].id), target.getBoundingClientRect(), 'center', 610 + index);
        assert(trace.target && trace.target.sidebar && trace.target.viewId === initial.id, 'existing group was not the exact sidebar target');
        await waitFor(function () { return currentView() && currentView().sessions.length === 3 + index && !store.get('projectSplitViewPending') && allPanesReady(); }, 'sidebar append');
        assert(currentView().sessions[currentView().sessions.length - 1].sessionOriginId === extras[index].sessionOriginId, 'incoming session title/membership was not appended');
        initialOrigins.forEach(function (origin, frameIndex) { assert(paneFrame(origin) === initialFrames[frameIndex], 'sidebar append replaced an existing frame'); });
      }
      var revision = store.get('projectSplitViewRevision');
      var sameGroup = document.querySelector('.split-view-group[data-split-view-id="' + initial.id + '"] .split-view-group-heading');
      drag(rowFor(initial.sessions[0].id), sameGroup.getBoundingClientRect(), 'center', 614);
      assert(!store.get('projectSplitViewPending') && store.get('projectSplitViewRevision') === revision, 'dropping an existing member duplicated or mutated its group');
      for (var extra of extras) {
        var pane = document.querySelector('.split-pane[data-session-origin="' + extra.sessionOriginId + '"]');
        var oldCount = currentView().sessions.length; pane.querySelector('.split-pane-close').click();
        await waitFor(function () { return currentView() && currentView().sessions.length === oldCount - 1 && !store.get('projectSplitViewPending') && allPanesReady(); }, 'restore sidebar fixture membership');
      }
      assert(!document.querySelector('[data-split-view-drop]'), 'sidebar drop highlight was not cleared');
    });
    await check('pane Info and rename target their own session while another pane is active', async function () {
      var view = currentView(), active = view.sessions.find(function (session) { return session.sessionOriginId === view.activeSessionOriginId; });
      var other = view.sessions.find(function (session) { return session.sessionOriginId !== view.activeSessionOriginId; });
      var pane = document.querySelector('.split-pane[data-session-origin="' + other.sessionOriginId + '"]'), frame = pane.querySelector('.split-pane-frame');
      assert(store.get('activeSessionId') === active.id, 'the other pane was not kept active for exact-source checks');
      pane.querySelector('.split-pane-info').click();
      var info = document.getElementById('split-pane-info-popover');
      assert(info && info.dataset.origin === other.sessionOriginId && info.textContent.indexOf(String(other.id)) >= 0, 'Info did not show the selected Pane session while its sibling was active');
      info.remove();
      var originalOrigin = frame.dataset.sessionOriginId;
      frame.dataset.sessionOriginId = active.sessionOriginId;
      pane.querySelector('.split-pane-info').click();
      assert(!document.getElementById('split-pane-info-popover'), 'Info accepted a forged frame origin');
      frame.dataset.sessionOriginId = originalOrigin;
      frame.dispatchEvent(new Event('clay-pane-ready'));
      assert(pane.querySelector('.split-pane-header').getAttribute('aria-busy') === 'false' &&
        pane.querySelector('.split-pane-title').getAttribute('aria-disabled') === 'false',
        'an exact ready binding did not restore header actions after the synthetic forged-origin check');
      pane.querySelector('.split-pane-title').click();
      var canceled = pane.querySelector('.split-pane-rename-input');
      assert(canceled, 'pane Rename did not open'); canceled.value = 'Canceled pane name';
      canceled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(!(getCachedSessions() || []).find(function (session) { return session.id === other.id && session.title === 'Canceled pane name'; }), 'Escape committed an unconfirmed pane rename');
      var nextName = 'Exact pane rename ' + other.id;
      pane.querySelector('.split-pane-title').click();
      var input = pane.querySelector('.split-pane-rename-input'); assert(input, 'pane Rename did not reopen'); input.value = nextName;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await waitFor(function () { var current = (getCachedSessions() || []).find(function (session) { return session.id === other.id; }); return current && current.title === nextName; }, 'exact pane session rename');
      var ws = getWs(); ws.send(JSON.stringify({ type: 'rename_session', id: other.id, title: other.title }));
      await waitFor(function () { var current = (getCachedSessions() || []).find(function (session) { return session.id === other.id; }); return current && current.title === other.title; }, 'restore fixture session title');
      result.paneSessionInfoAndRenameChecked = true;
    });
    await check('pane-header Arrange explicitly adds an actual paired Driver without changing its Worker execution group', async function () {
      var driver = (getCachedSessions() || []).find(function (session) { return session.title === 'Driver 0' && session.sessionRole === 'driver'; });
      assert(driver, 'fixture paired Driver was not projected as a real Driver session');
      var pairSnapshot = JSON.stringify(store.get('splitGroups') || []), trigger = document.querySelector('#split-host > .split-pane:not([hidden]) .split-view-arrange-trigger');
      assert(!document.querySelector('[data-split-view-create-trigger]'), 'removed sidebar Arrange entry remains');
      assert(trigger, 'visible pane-header Arrange entry is missing'); trigger.click();
      document.querySelector('#split-view-arrange-menu [data-arrange-membership]').click();
      var menu = document.getElementById('split-view-create-menu');
      assert(menu && !menu.hidden, 'Arrange did not open its custom session picker');
      var choice = menu.querySelector('[data-create-session-origin="' + driver.sessionOriginId + '"]');
      assert(choice, 'paired Driver is not available in the picker'); choice.click();
      menu.querySelector('[data-create-split-view]').click();
      await waitFor(function () { return currentView() && currentView().sessions.some(function (session) { return session.sessionOriginId === driver.sessionOriginId; }) && currentView().sessions.length === 3 && allPanesReady(); }, 'paired Driver added to view');
      assert(JSON.stringify(store.get('splitGroups') || []) === pairSnapshot, 'presentation membership changed the legacy Worker execution group');
      assert(document.querySelectorAll('.session-item[data-session-id="' + driver.id + '"]').length === 1, 'paired Driver appears more than once in the sidebar');
      var activeId = store.get('projectSplitViewActiveId'); rowFor(driver.id).click();
      await waitFor(function () { return store.get('activeSessionId') === driver.id; }, 'selecting the paired Driver session');
      assert(store.get('projectSplitViewActiveId') === activeId && !store.get('splitPanes'), 'selecting a Driver in its named Split view opened the legacy execution pair');
      result.pairedDriverOrigin = driver.sessionOriginId;
    });
    await check('paired Driver pane shows actual runtime metadata and current-first exact Worker generations', async function () {
      var origin = result.pairedDriverOrigin, pane = document.querySelector('.split-pane[data-session-origin="' + origin + '"]');
      assert(pane, 'paired Driver pane is missing');
      var runtime = pane.querySelector('.split-view-runtime'), model = runtime && runtime.querySelector('.split-view-model'), icon = runtime && runtime.querySelector('.split-view-runtime-icon');
      assert(runtime && runtime.getAttribute('aria-label') && model && model.textContent.trim() === 'fixture', 'pane runtime identity did not use session vendor/model metadata');
      assert(icon && /codex-avatar\.png/.test(icon.getAttribute('src') || ''), 'pane runtime vendor icon is missing or incorrect');
      assert(Array.from(document.querySelectorAll('#split-host > .split-pane > .split-pane-frame')).every(function (frame) {
        return !frame.contentWindow || !frame.contentWindow.splitViewFixtureRuntimeErrors;
      }), 'fixture assertion runner leaked into a pane iframe');
      var chips = Array.from(pane.querySelectorAll('.split-view-worker-chip'));
      assert(chips.length === 3, 'paired Driver should expose two configured Workers and one archived Worker conversation');
      assert(chips[0].dataset.workerGeneration === '2' && chips[1].dataset.workerGeneration === '1' && chips[2].dataset.workerGeneration === '3', 'configured Worker IDs were not ordered ahead of the higher-generation archived Worker');
      assert(chips[0].querySelector('.split-view-worker-dot').dataset.state === 'working', 'current Worker dot does not reflect observed processing state');
      assert(chips[1].querySelector('.split-view-worker-dot').dataset.state === 'working', 'second configured Worker dot does not reflect observed processing state');
      assert(chips[2].querySelector('.split-view-worker-dot').dataset.state !== 'working', 'archived Worker incorrectly shows working state');
      result.workerOrigins = chips.map(function (chip) { return chip.dataset.workerOrigin; });
      result.workerIds = result.workerOrigins.map(function (workerOrigin) { return (getCachedSessions() || []).find(function (session) { return session.sessionOriginId === workerOrigin; }).id; });
      assert(result.workerIds.every(function (id) { return !rowFor(id); }), 'Worker conversation also appeared as a duplicate sidebar session row');
    });
    await check('restoring a saved Split view after its legacy Worker pair clears stale Worker role and runtime chrome', async function () {
      var viewId = store.get('projectSplitViewActiveId'), viewRoot = document.querySelector('.split-view-group[data-split-view-id="' + viewId + '"]');
      var pairedDriver = getCachedSessions().find(function (session) { return session.sessionOriginId === result.pairedDriverOrigin; });
      var worker = getCachedSessions().find(function (session) { return session.sessionOriginId === result.workerOrigins[0]; });
      assert(viewRoot && pairedDriver && worker, 'saved Split view or exact legacy Driver/Worker identity is missing');
      var originalDriverPane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]');
      var originalDriverFrame = originalDriverPane && originalDriverPane.querySelector('.split-pane-frame');
      var splitViewModule = await import('/p/reuse/modules/split-view.js');
      assert(splitViewModule.openWorkerWithDriver(worker), 'production legacy Worker-pair opener rejected its configured Worker');
      await waitFor(function () { return store.get('splitPanes') && store.get('splitPanes').panes.some(function (pane) { return pane.sessionId === worker.id; }); }, 'legacy Worker pair opened');
      await waitFor(function () { var pane = Array.from(document.querySelectorAll('#split-host > .split-pane')).find(function (item) { return Number(item.dataset.sessionId) === worker.id; }); return pane && pane.classList.contains('split-pane-role-worker') && pane.querySelector('.split-pair-role-split-worker') && pane.querySelector('.split-worker-runtime'); }, 'legacy Worker role chrome');
      var reusedWorkerPane = Array.from(document.querySelectorAll('#split-host > .split-pane')).find(function (item) { return Number(item.dataset.sessionId) === worker.id; });
      var currentViewRoot = document.querySelector('.split-view-group[data-split-view-id="' + viewId + '"]');
      assert(currentViewRoot, 'saved Split view sidebar entry disappeared while opening the legacy pair');
      currentViewRoot.querySelector('.split-view-group-open').click();
      await waitFor(function () { return store.get('projectSplitViewActiveId') === viewId && !store.get('splitPanes') && allPanesReady(); }, 'saved Split view restored after legacy pair');
      await waitFor(allPaneTranscriptsHydrated, 'restored presentation transcripts to hydrate');
      await nextFrame();
      var presentationPanes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
      assert(presentationPanes.length === currentView().sessions.length, 'restored presentation is missing a pane');
      assert(presentationPanes.indexOf(reusedWorkerPane) !== -1 && Number(reusedWorkerPane.dataset.sessionId) !== worker.id, 'legacy Worker pane node was not reconciled to a presentation Driver');
      presentationPanes.forEach(function (pane) {
        var frame = pane.querySelector('.split-pane-frame'), session = getCachedSessions().find(function (item) { return item.sessionOriginId === frame.dataset.sessionOriginId; });
        var runtime = pane.querySelector('.split-view-runtime'), model = runtime && runtime.querySelector('.split-view-model');
        assert(session && session.sessionRole === 'driver' && Number(pane.dataset.sessionId) === session.id, 'presentation member does not resolve to its exact Driver session');
        assert(!pane.classList.contains('split-pane-role-worker') && !pane.classList.contains('split-pane-role-driver'), 'legacy role class remained on a presentation pane');
        assert(!pane.querySelector('.split-pair-role, .split-worker-runtime, .split-pair-live, .split-pair-set-driver'), 'legacy role badge or Worker runtime remained on a presentation pane');
        assert(runtime && model && model.textContent.trim() === (session.model || 'Model unavailable'), 'presentation runtime line retained stale Worker identity or model');
      });
      var restoredDriverPane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]');
      assert(restoredDriverPane && restoredDriverPane.querySelector('.split-pane-frame') === originalDriverFrame, 'restoring the view replaced the unchanged Driver iframe');
      result.legacyPaneReuseChecked = true;
    });
    await check('pane Search uses the selected real frame bridge and remains isolated to that pane', async function () {
      await waitFor(allPanesReady, 'paired panes ready for Search');
      var origin = result.pairedDriverOrigin, pane = document.querySelector('.split-pane[data-session-origin="' + origin + '"]'), frame = pane.querySelector('.split-pane-frame');
      var otherPane = Array.from(document.querySelectorAll('#split-host > .split-pane')).find(function (item) { return item !== pane; });
      var searchButton = pane.querySelector('.split-pane-search');
      var searchPopover = pane.querySelector('.split-pane-search-popover');
      var iframeRectBeforeSearch = frame.getBoundingClientRect();
      var paneHeaderRect = pane.querySelector('.split-pane-header').getBoundingClientRect();
      var searchBar = frame.contentDocument.getElementById('session-search-bar');
      frame.contentWindow.postMessage({ type: 'clay-pane-toggle-search' }, window.location.origin);
      await delay(80);
      assert(searchBar.classList.contains('hidden'), 'unbound pane search message was accepted');
      assert(searchButton, 'pane Search action is missing'); searchButton.click();
      await waitFor(function () { return searchPopover && !searchPopover.hidden; }, 'parent pane-specific session search', 3000).catch(function (error) {
        var identity = frame.clayPane && frame.clayPane.identity();
        result.searchDebug = { identity: identity, paneBinding: pane.dataset.paneBinding || null, frameOrigin: frame.dataset.sessionOriginId,
          popoverExists: !!searchPopover, buttonConnected: searchButton.isConnected,
          documentUrl: frame.contentDocument.location.href, runtimeErrors: window.splitViewFixtureRuntimeErrors.slice(observedRuntimeErrorCount) };
        throw error;
      });
      assert(searchBar.classList.contains('hidden'), 'pane search UI was rendered inside the child app instead of the parent shell');
      var otherPopover = otherPane.querySelector('.split-pane-search-popover');
      assert(!otherPopover || otherPopover.hidden, 'Search affected a different pane');
      var popoverRect = searchPopover.getBoundingClientRect();
      assert(Math.abs(popoverRect.top - paneHeaderRect.bottom) <= 1, 'search popover does not begin at the measured header bottom');
      assert(Number(getComputedStyle(searchPopover).zIndex) >= 20, 'search popover is below Worker rows');
      var popoverPoint = { x: Math.min(popoverRect.right - 10, popoverRect.left + 12), y: popoverRect.top + 10 };
      assert(searchPopover.contains(document.elementFromPoint(popoverPoint.x, popoverPoint.y)), 'search popover does not receive pointer hits above Worker rows');
      var sourceMessage = frame.contentDocument.querySelector('.msg-user .bubble, .msg-assistant .bubble');
      var searchInput = searchPopover.querySelector('.split-pane-search-input');
      var query = sourceMessage && sourceMessage.textContent.trim().slice(0, 8);
      assert(query, 'pane fixture has no searchable transcript message');
      searchInput.value = query; searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await waitFor(function () { return frame.contentDocument.querySelector('.session-search-highlight'); }, 'child-controller transcript highlighting');
      var iframeRectDuringSearch = frame.getBoundingClientRect();
      assert(iframeRectDuringSearch.top === iframeRectBeforeSearch.top && iframeRectDuringSearch.height === iframeRectBeforeSearch.height,
        'parent search moved or resized the conversation iframe');
      result.searchOrigin = origin;
      searchPopover.querySelector('[aria-label="Next match"]').click();
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(function () { return searchPopover.hidden && !frame.contentDocument.querySelector('.session-search-highlight'); }, 'pane-specific session search close');
    });
    await check('Worker chips open exact read-only current and archived conversation snapshots without session effects', async function () {
      var driver = getCachedSessions().find(function (session) { return session.sessionOriginId === result.pairedDriverOrigin; });
      var activeBefore = store.get('activeSessionId'), groupsBefore = JSON.stringify(store.get('splitGroups') || []), pairWorkerStates = JSON.stringify((getCachedSessions() || []).filter(function (session) { return session.sessionRole === 'worker'; }).map(function (session) { return [session.id, session.isProcessing, session.workerGeneration]; }));
      var pane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]'), archivedChip = pane.querySelector('[data-worker-origin="' + result.workerOrigins[2] + '"]');
      archivedChip.click();
      var initialPopup = document.getElementById('split-view-worker-popover');
      var stableBody = initialPopup && initialPopup.querySelector('.split-view-worker-popover-body');
      var stableClose = initialPopup && initialPopup.querySelector('[aria-label="Close Worker conversation"]');
      await waitFor(function () { var popup = document.getElementById('split-view-worker-popover'); return popup && popup.textContent.indexOf('Archived worker response') >= 0; }, 'archived Worker transcript');
      var popup = document.getElementById('split-view-worker-popover');
      assert(popup.querySelector('.md-content strong') && popup.querySelector('.md-content ul li') && popup.querySelector('.md-content pre code'), 'archived Markdown was not rendered');
      assert(popup.querySelector('details pre') && popup.textContent.indexOf('Archived tool output') >= 0, 'archived tool output is absent');
      assert(!popup.querySelector('.message-body input, .message-body img, .message-body script, .message-body [style]'), 'recorded HTML created active content');
      assert(popup.textContent.indexOf('Driver 0 · Archived Implementation · Gen 3') >= 0, 'archived Worker popover title/source generation is incorrect');
      assert(popup === initialPopup && popup.querySelector('.split-view-worker-popover-body') === stableBody && popup.querySelector('[aria-label="Close Worker conversation"]') === stableClose, 'response replaced the open popover subtree');
      assert(document.activeElement === stableClose, 'response removed focus from the close control');
      assert(popup.textContent.indexOf('Current worker response') === -1, 'archived chip displayed the current generation transcript');
      assert(!popup.querySelector('textarea,input,[contenteditable="true"], [data-action="send"], [data-action="run"]'), 'read-only transcript exposed an editing or execution control');
      assert(Array.from(popup.querySelectorAll('button')).every(function (button) { return button === stableClose || button.classList.contains('worker-activity-summary'); }), 'read-only transcript exposed a control beyond close and local evidence disclosure');
      await verifyWorkerPaging({ store: store, assert: assert, waitFor: waitFor, delay: delay }, popup, 300, 'Archived generation request 0');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(document.activeElement && document.activeElement.dataset.workerOrigin === result.workerOrigins[2] && document.activeElement.dataset.workerGeneration === '3', 'Escape did not return focus to the exact archived Worker chip');
      pane.querySelector('[data-worker-origin="' + result.workerOrigins[0] + '"]').click();
      await waitFor(function () { var current = document.getElementById('split-view-worker-popover'); return current && current.textContent.indexOf('Current worker response') >= 0; }, 'current Worker transcript');
      popup = document.getElementById('split-view-worker-popover');
      assert(popup.querySelector('.md-content strong') && popup.querySelector('.md-content ul li') && popup.querySelector('.md-content pre code'), 'current Markdown was not rendered');
      assert(popup.querySelector('details pre') && popup.textContent.indexOf('Recorded tool output') >= 0, 'current tool output is absent');
      assert(!popup.querySelector('.message-body input, .message-body img, .message-body script, .message-body [style]'), 'current recorded HTML created active content');
      assert(popup.textContent.indexOf('Archived worker response') === -1, 'current chip displayed archived transcript');
      await verifyWorkerPaging({ store: store, assert: assert, waitFor: waitFor, delay: delay }, popup, 370, 'Current generation request 0');
      assert(store.get('activeSessionId') === activeBefore, 'reading a Worker transcript switched the active session');
      assert(JSON.stringify(store.get('splitGroups') || []) === groupsBefore, 'reading a Worker transcript mutated its execution group');
      assert(JSON.stringify((getCachedSessions() || []).filter(function (session) { return session.sessionRole === 'worker'; }).map(function (session) { return [session.id, session.isProcessing, session.workerGeneration]; })) === pairWorkerStates, 'reading a Worker transcript changed Worker execution state');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      var originalWs = getWs(); setWs(null);
      pane.querySelector('[data-worker-origin="' + result.workerOrigins[0] + '"]').click();
      assert(document.getElementById('split-view-worker-popover').textContent.indexOf('disconnected') >= 0, 'disconnected Worker conversation did not show an error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); setWs(originalWs);
      var throwingWs = { readyState: 1, send: function () { throw new Error('fixture send failed'); } };
      setWs(throwingWs); pane.querySelector('[data-worker-origin="' + result.workerOrigins[0] + '"]').click();
      assert(document.getElementById('split-view-worker-popover').textContent.indexOf('could not be sent') >= 0, 'thrown Worker request send did not produce a truthful error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      setWs(originalWs);
    });
    await check('pointer drag reaches eight panes, ninth is refused with the exact message', async function () {
      var sessions = getCachedSessions(), extras = sessions.filter(function (session) { return /^Standalone [0-8]$/.test(session.title) && !currentView().sessions.some(function (item) { return item.id === session.id; }); });
      while (currentView().sessions.length < 8) {
        var target = document.querySelector('#split-host > .split-pane:not([hidden])'), source = extras.shift();
        assert(target && source, 'fixture ran out of target panes or sessions');
        var expectedCount = currentView().sessions.length + 1;
        drag(rowFor(source.id), target.getBoundingClientRect(), 'right', 601 + expectedCount);
        await waitFor(function () { return currentView() && currentView().sessions.length === expectedCount && allPanesReady(); }, 'Split view membership update');
      }
      result.countAfterFill = currentView().sessions.length;
      var blocked = extras[0], targetPane = document.querySelector('#split-host > .split-pane:not([hidden])');
      if (blocked && targetPane) {
        drag(rowFor(blocked.id), targetPane.getBoundingClientRect(), 'right', 699);
        await waitFor(function () { return Array.from(document.querySelectorAll('.toast')).some(function (toast) { return toast.textContent.indexOf('Eight sessions are already open. Close a pane to add another.') >= 0; }); }, 'eight-session blocked toast', 5000);
        assert(currentView().sessions.length === 8, 'blocked ninth session entered the view');
        assert(!document.body.classList.contains('dragging') && !document.body.classList.contains('is-dragging'), 'blocked drag did not clean body state');
        result.checks.push('eight-session cap kept ninth session out');
      }
      await waitFor(allPaneTranscriptsHydrated, 'all pane transcripts to hydrate', 30000);
      await nextFrame();
      await delay(500);
    });
    await check('Arrange menu belongs to clicked pane and presets preserve iframe identity, drafts and binding generation', async function () {
      var before = readIdentity(), beforeRevision = store.get('projectSplitViewRevision'), pane = document.querySelector('#split-host > .split-pane:not([hidden])'), trigger = pane.querySelector('[data-action="arrange"]');
      trigger.click();
      var menu = document.getElementById('split-view-arrange-menu');
      assert(menu && !menu.hidden && menu.dataset.sourceOrigin === pane.querySelector('.split-pane-frame').dataset.sessionOriginId, 'arrange source does not match clicked pane');
      var presetButtons = Array.from(menu.querySelectorAll('[data-preset]')), positionButtons = Array.from(menu.querySelectorAll('[data-position]'));
      function verifyLayoutOptions(buttons) {
        var drawings = [];
        buttons.forEach(function (button) {
          var svg = button.querySelector('svg.split-view-layout-icon'), label = button.querySelector('span.split-view-layout-label'), frame = svg && svg.querySelector('.split-view-layout-frame');
          assert(svg && svg.getAttribute('viewBox') === '0 0 36 24' && svg.getAttribute('aria-hidden') === 'true' && label, 'Arrange option is missing its accessible SVG and text label');
          assert(frame && frame.getAttribute('x') === '1' && frame.getAttribute('y') === '1' && frame.getAttribute('width') === '34' && frame.getAttribute('height') === '22', 'layout preview frame dimensions are incorrect');
          assert(svg.querySelector('.split-view-layout-selected') && svg.querySelectorAll('.split-view-layout-tile').length >= 2, 'layout preview does not show separated panes and a selected pane');
          Array.from(svg.querySelectorAll('.split-view-layout-tile')).forEach(function (tile) {
            var x = Number(tile.getAttribute('x')), y = Number(tile.getAttribute('y')), width = Number(tile.getAttribute('width')), height = Number(tile.getAttribute('height'));
            assert(x >= 3 && y >= 3 && x + width <= 33 && y + height <= 21, 'layout preview tile extends outside its inset frame');
          });
          drawings.push(svg.innerHTML);
        });
        assert(new Set(drawings).size === buttons.length, 'two Arrange options share the same layout drawing');
      }
      assert(presetButtons.length === 6 && positionButtons.length === 10, 'Arrange chooser omitted a preset or pane position');
      verifyLayoutOptions(presetButtons); verifyLayoutOptions(positionButtons);
      assert(menu.querySelector('[data-preset="balanced"] .split-view-layout-tile') && menu.querySelectorAll('[data-preset="balanced"] .split-view-layout-tile').length === 3,
        'balanced preview does not show its main pane and two stacked panes');
      menu.querySelector('[data-preset="columns"]').click();
      await waitFor(function () { return !store.get('projectSplitViewPending') && store.get('projectSplitViewRevision') > beforeRevision; }, 'preset persistence');
      await nextFrame();
      assertSameIdentity(before, 'preset');
      var selected = currentView().sessions.find(function (session) { return session.sessionOriginId !== pane.querySelector('.split-pane-frame').dataset.sessionOriginId; });
      var nextPane = Array.from(document.querySelectorAll('#split-host > .split-pane')).find(function (item) { return item.querySelector('.split-pane-frame').dataset.sessionOriginId !== selected.sessionOriginId; });
      nextPane.querySelector('[data-action="arrange"]').click();
      var arrangeMenu = document.getElementById('split-view-arrange-menu');
      arrangeMenu.querySelector('[data-arrange-context]').click();
      arrangeMenu.querySelector('[data-arrange-source-origin="' + selected.sessionOriginId + '"]').click();
      assert(arrangeMenu.dataset.sourceOrigin === selected.sessionOriginId, 'custom arrangement context did not switch to selected session');
      arrangeMenu.querySelector('[data-position="top-left"]').click();
      await waitFor(function () { return !store.get('projectSplitViewPending') && currentView().tree.left && currentView().tree.left.axis === 'vertical'; }, 'selected-session corner arrangement');
      await nextFrame();
      assert(currentView().tree.left.left.id === selected.sessionOriginId, 'corner region was not applied to the selected pane');
      assertSameIdentity(before, 'corner arrangement');
      var selectedPane = Array.from(document.querySelectorAll('#split-host > .split-pane')).find(function (item) { return item.querySelector('.split-pane-frame').dataset.sessionOriginId === selected.sessionOriginId; });
      var originalTree = JSON.stringify(currentView().tree);
      selectedPane.querySelector('[data-action="arrange"]').click();
      document.getElementById('split-view-arrange-menu').querySelector('[data-focus-layout]').click();
      assert(store.get('projectSplitViewFocusedOrigin') === selected.sessionOriginId, 'Focus did not target the selected session');
      assert(Array.from(document.querySelectorAll('#split-host > .split-pane')).filter(function (item) { return item.hidden; }).length === currentView().sessions.length - 1, 'Focus did not hide every other pane');
      selectedPane.querySelector('[data-action="arrange"]').click();
      document.getElementById('split-view-arrange-menu').querySelector('[data-focus-layout]').click();
      assert(!store.get('projectSplitViewFocusedOrigin') && JSON.stringify(currentView().tree) === originalTree, 'Restore did not preserve the exact prior tree');
      assert(Array.from(document.querySelectorAll('#split-host > .split-pane')).every(function (item) { return !item.hidden && item.style.display !== 'none'; }), 'Restore left panes hidden');
      result.selectedArrangeOrigin = selected.sessionOriginId;
      result.paneCount = before.length;
    });
    await check('center drag swaps geometry while retaining exact iframe and binding identity', async function () {
      var before = readIdentity(), panes = Array.from(document.querySelectorAll('#split-host > .split-pane')), firstOrigin = panes[0].querySelector('.split-pane-frame').dataset.sessionOriginId;
      var secondOrigin = panes[1].querySelector('.split-pane-frame').dataset.sessionOriginId, rect = panes[1].getBoundingClientRect();
      var oldOrder = listIds(currentView().tree), oldRevision = store.get('projectSplitViewRevision');
      var expectedOrder = oldOrder.map(function (origin) { return origin === firstOrigin ? secondOrigin : origin === secondOrigin ? firstOrigin : origin; });
      result.centerDragTrace = drag(panes[0].querySelector('.split-pane-title') || panes[0].querySelector('.split-pane-header'), rect, 'center', 740);
      assert(result.centerDragTrace.started && result.centerDragTrace.target && result.centerDragTrace.target.origin === secondOrigin, 'center drag did not reach its exact target');
      await waitFor(function () { return currentView() && JSON.stringify(listIds(currentView().tree)) === JSON.stringify(expectedOrder) && store.get('projectSplitViewRevision') > oldRevision && !store.get('projectSplitViewPending'); }, 'center swap persistence');
      assertSameIdentity(before, 'center swap');
      await nextFrame();
    });
    await check('nested keyboard and pointer divider resize retain focus, ratios and iframe identity', async function () {
      var before = readIdentity(), dividers = Array.from(document.querySelectorAll('#split-host > .split-view-divider'));
      var divider = dividers.find(function (item) { return JSON.parse(item.dataset.path).length > 0; });
      assert(divider, 'nested split view divider is missing'); divider.focus();
      var path = JSON.parse(divider.dataset.path), oldNode = treeAtPath(currentView().tree, path), oldRatio = oldNode.ratio;
      var beforeRevision = store.get('projectSplitViewRevision');
      var decrease = oldRatio >= 0.93, resizeKey = divider.dataset.axis === 'horizontal' ? (decrease ? 'ArrowLeft' : 'ArrowRight') : (decrease ? 'ArrowUp' : 'ArrowDown');
      divider.dispatchEvent(new KeyboardEvent('keydown', { key: resizeKey, bubbles: true, cancelable: true }));
      assert(document.activeElement.classList.contains('split-view-divider'), 'keyboard resizing lost divider focus');
      await waitFor(function () { return !store.get('projectSplitViewPending') && store.get('projectSplitViewRevision') > beforeRevision; }, 'keyboard divider persistence');
      assert(treeAtPath(currentView().tree, path).ratio !== oldRatio, 'keyboard resize did not change nested branch ratio');
      assertSameIdentity(before, 'keyboard resize');
      dividers = Array.from(document.querySelectorAll('#split-host > .split-view-divider'));
      divider = dividers.find(function (item) { return JSON.parse(item.dataset.path).length > 0; });
      assert(divider, 'nested divider disappeared after keyboard resize');
      path = JSON.parse(divider.dataset.path); oldRatio = treeAtPath(currentView().tree, path).ratio;
      var rect = divider.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, coordinate = divider.dataset.axis === 'horizontal' ? x : y;
      beforeRevision = store.get('projectSplitViewRevision');
      pointer(divider, 'pointerdown', 811, x, y);
      pointer(document, 'pointermove', 811, divider.dataset.axis === 'horizontal' ? coordinate + 18 : x, divider.dataset.axis === 'vertical' ? coordinate + 18 : y);
      var scrollEntry = before[0];
      var scrollingFrame = paneFrame(scrollEntry.origin), scrollingMessages = scrollingFrame.contentDocument.getElementById('messages');
      scrollingMessages.scrollTop = 73;
      scrollingMessages.dispatchEvent(new scrollingFrame.contentWindow.WheelEvent('wheel', { bubbles: true, deltaY: 24 }));
      scrollingMessages.dispatchEvent(new scrollingFrame.contentWindow.Event('scroll', { bubbles: true }));
      var scrollLive = scrollingFrame.clayPane.identity(), scrollKey = scrollEntry.origin + ':' + scrollLive.binding.generation + ':' + scrollLive.binding.requestId;
      assert(store.get('projectSplitViewTranscriptScroll')[scrollKey].scrollTop === 73, 'real transcript scroll event was not recorded during divider movement');
      scrollEntry.scrollTop = 73;
      pointer(document, 'pointerup', 811, divider.dataset.axis === 'horizontal' ? coordinate + 18 : x, divider.dataset.axis === 'vertical' ? coordinate + 18 : y);
      await waitFor(function () { return !store.get('projectSplitViewPending') && store.get('projectSplitViewRevision') > beforeRevision; }, 'pointer divider persistence');
      assert(treeAtPath(currentView().tree, path).ratio !== oldRatio, 'pointer resize did not change nested branch ratio');
      assertSameIdentity(before, 'pointer resize');
      result.scrollDuringResize = scrollingMessages.scrollTop;
    });
    await check('inline rename persists through the real project WebSocket', async function () {
      var newName = 'Browser checked Split view'; renameActive(newName);
      await waitFor(function () { return currentView() && currentView().name === newName; }, 'Rename broadcast');
      result.name = currentView().name;
    });
    await check('stale revision receives exact conflict response without write or broadcast', async function () {
      var ws = getWs(), view = currentView(), before = store.get('projectSplitViewRevision'), requestId = 'fixture-stale-' + Date.now();
      assert(before > 0, 'fixture needs a positive revision to submit a stale revision');
      var stopBroadcastWatch = countViewBroadcastsAfter(requestId, { revision: before });
      var responsePromise = awaitSplitViewResult(requestId);
      ws.send(JSON.stringify({ type: 'project_split_view_rename', requestId: requestId, expectedRevision: before - 1, id: view.id, name: 'Stale overwrite' }));
      var response = await responsePromise;
      await delay(100);
      var broadcasts = stopBroadcastWatch();
      assert(response.ok === false && response.code === 'conflict', 'stale request did not return the exact conflict response');
      assert(response.revision === before, 'stale response reported an unexpected owner revision');
      assert(broadcasts === 0 && store.get('projectSplitViewRevision') === before, 'stale request broadcast or advanced the owner revision');
      assert(currentView().name === 'Browser checked Split view', 'stale request changed the saved name');
    });
    await check('persistence failure leaves the existing Split view name unchanged', async function () {
      await fetch('/fixture/fail-next-write', { method: 'POST' });
      var priorName = currentView().name, before = store.get('projectSplitViewRevision'), view = currentView(), ws = getWs();
      var requestId = 'fixture-persist-failure-' + Date.now(), stopBroadcastWatch = countViewBroadcastsAfter(requestId, { revision: before });
      var responsePromise = awaitSplitViewResult(requestId);
      ws.send(JSON.stringify({ type: 'project_split_view_rename', requestId: requestId, expectedRevision: before, id: view.id, name: 'Must not persist' }));
      var response = await responsePromise;
      await delay(100);
      var broadcasts = stopBroadcastWatch();
      assert(response.ok === false && response.code === 'storage', 'injected storage failure did not return the exact storage response');
      assert(response.revision === before, 'persistence response reported an unexpected owner revision');
      assert(broadcasts === 0 && store.get('projectSplitViewRevision') === before, 'failed persistence broadcast or advanced the owner revision');
      assert(currentView().name === priorName, 'failed rename changed the visible saved name');
      result.persistedNameAfterFailure = currentView().name;
    });
    await check('visible Worker Controls open the exact live pair and its real Stop and review actions preserve the saved Split view', async function () {
      var driver = getCachedSessions().find(function (session) { return session.sessionOriginId === result.pairedDriverOrigin; });
      var group = (store.get('splitGroups') || []).find(function (item) { return item.pair && item.pair.driverId === driver.id; });
      assert(group && group.members.length === 3, 'fixture v2 Driver pair is not available');
      var presentationId = store.get('projectSplitViewActiveId'), viewTree = JSON.stringify(currentView().tree), groupSnapshot = JSON.stringify(group);
      var workerId = group.pair.workerIds[0];
      var worker = getCachedSessions().find(function (session) { return session.id === workerId; });
      assert(worker && worker.sessionOriginId, 'exact paired Worker origin is unavailable');
      var driverPane = document.querySelector('.split-pane[data-session-origin="' + driver.sessionOriginId + '"]');
      var controls = driverPane && driverPane.querySelector('.split-view-worker-controls');
      assert(controls && controls.textContent.trim() === 'Controls' && controls.getAttribute('aria-label') === 'Open Worker controls for ' + driver.title,
        'presentation pane does not expose the accessible Worker Controls action');
      var originalGroups = store.get('splitGroups');
      store.set({ splitGroups: [] }); controls.click();
      assert(!store.get('splitPanes'), 'stale Worker Controls opened a pair after its configured group was revoked');
      store.set({ splitGroups: originalGroups });
      driverPane = document.querySelector('.split-pane[data-session-origin="' + driver.sessionOriginId + '"]');
      controls = driverPane && driverPane.querySelector('.split-view-worker-controls');
      assert(controls, 'Worker Controls did not return after authoritative pair metadata was restored');
      controls.click();
      await waitFor(function () { return store.get('splitPanes') && store.get('splitPanes').groupId === group.id; }, 'explicit legacy Worker controls surface');
      controls.click();
      assert(store.get('splitPanes') && store.get('splitPanes').groupId === group.id, 'stale Controls action changed the already-open execution group');
      await waitFor(function () { return legacyGroupPanesReady(group); }, 'legacy Driver and Worker control panes');
      var workerPane = document.querySelector('#split-host > .split-pane[data-session-id="' + workerId + '"]');
      var workerFrame = workerPane && workerPane.querySelector('.split-pane-frame'), stopButton = workerFrame && workerFrame.contentDocument.getElementById('generation-stop');
      await fetch('/fixture/review?id=' + workerId, { method: 'POST' });
      var allowButton = null;
      await waitFor(function () { allowButton = workerFrame.contentDocument.querySelector('.permission-container[data-request-id="review-' + workerId + '"] .permission-allow, .permission-container[data-request-id="review-' + workerId + '"] .mate-permission-allow'); return !!allowButton; }, 'real Worker permission review card');
      allowButton.click();
      await waitForAsync(async function () { var data = await (await fetch('/fixture/state')).json(); return data.reviews.some(function (entry) { return entry.sessionId === workerId && entry.decision && entry.decision.behavior === 'allow'; }); }, 'legacy Worker permission review action');
      await fetch('/fixture/running?id=' + workerId, { method: 'POST' });
      await waitFor(function () { return stopButton && !stopButton.classList.contains('hidden') && !stopButton.disabled; }, 'visible Worker Stop control');
      assert(stopButton.parentElement && stopButton.parentElement.id === 'input-area', 'locked Worker Stop is not a direct #input-area child');
      stopButton.click();
      await waitForAsync(async function () { var data = await (await fetch('/fixture/state')).json(); return data.stopped.indexOf(workerId) >= 0; }, 'legacy Worker Stop action');
      var viewRoot = document.querySelector('.split-view-group[data-split-view-id="' + presentationId + '"]');
      assert(viewRoot, 'saved Split view entry disappeared while Worker controls were open');
      viewRoot.querySelector('.split-view-group-open').click();
      await waitFor(function () { return store.get('projectSplitViewActiveId') === presentationId && !store.get('splitPanes') && allPanesReady(); }, 'return to the saved Split view');
      assert(store.get('projectSplitViewActiveId') === presentationId && JSON.stringify(currentView().tree) === viewTree, 'legacy Worker controls changed the named presentation view');
      assert(JSON.stringify((store.get('splitGroups') || []).find(function (item) { return item.id === group.id; })) === groupSnapshot, 'legacy Stop/review changed Worker pair membership');
      result.legacyOperationsChecked = true;
    });
    await check('paired Driver singleton keeps exact Worker controls, Ask binding, read-only chips and returns to one Pane after real review and Stop', async function () {
      var driver = (getCachedSessions() || []).find(function (session) { return session.sessionOriginId === result.pairedDriverOrigin && session.sessionRole === 'driver'; });
      var group = (store.get('splitGroups') || []).find(function (item) { return item.pair && item.pair.driverId === driver.id; });
      assert(driver && group && group.pair.workerIds.length, 'paired Driver or its exact Worker group is missing');
      var ws = getWs();
      var standalone = getCachedSessions().find(function (session) { return session.title === 'Standalone 1'; });
      rowFor(driver.id).click();
      await waitFor(function () { return store.get('activeSessionId') === driver.id && currentView() && currentView().activeSessionOriginId === driver.sessionOriginId && !store.get('projectSplitViewPending') && !store.get('splitPanes'); }, 'focus exact paired Driver Pane in named view');
      var viewRoot = document.querySelector('.split-view-group[data-split-view-id="' + store.get('projectSplitViewActiveId') + '"]');
      viewRoot.querySelector('.split-view-group-more').click();
      document.querySelector('[data-split-view-action="separate"]').click();
      await waitFor(function () { return store.get('activeSessionId') === driver.id && store.get('projectSplitViewSingletonOrigin') === driver.sessionOriginId && !store.get('splitPanes') && allPanesReady(); }, 'paired Driver singleton Pane');
      var pane = document.querySelector('#split-host > .split-pane'), frame = pane && pane.querySelector('.split-pane-frame');
      assert(pane && document.getElementById('split-host').dataset.singlePane === 'true' && pane.dataset.sessionOrigin === driver.sessionOriginId && frame.clayPane.identity().sessionId === driver.id,
        'paired Driver singleton is not bound to its exact live Pane');
      var chips = Array.from(pane.querySelectorAll('.split-view-worker-chip'));
      assert(chips.length === result.workerOrigins.length && result.workerOrigins.every(function (origin) { return chips.some(function (chip) { return chip.dataset.workerOrigin === origin; }); }),
        'paired Driver singleton does not expose its exact current and archived Worker chips');
      var conversationChip = pane.querySelector('[data-worker-origin="' + (getCachedSessions().find(function (session) { return session.id === group.pair.workerIds[0]; }).sessionOriginId) + '"]');
      assert(conversationChip, 'exact paired Worker chip is missing from the singleton Pane');
      conversationChip.click();
      await waitFor(function () { return store.get('splitViewWorkerConversation') && document.getElementById('split-view-worker-popover'); }, 'singleton read-only Worker conversation');
      assert(store.get('splitViewWorkerConversation').driverOriginId === driver.sessionOriginId && store.get('splitViewWorkerConversation').workerOriginId === conversationChip.dataset.workerOrigin && document.querySelector('.split-view-worker-popover-body[aria-label="Read-only Worker transcript"]'),
        'singleton Worker popup is not the exact read-only transcript');
      document.getElementById('split-view-worker-popover').remove(); store.set({ splitViewWorkerConversation: null });
      var sent = [], originalSend = ws.send;
      ws.send = function (raw) { try { var message = JSON.parse(raw); if (message.type === 'set_permission_mode') sent.push(message); } catch (error) {} return originalSend(raw); };
      var ask = pane.querySelector('.split-pane-full-access [data-permission-mode="default"]');
      assert(ask && !ask.disabled, 'singleton Ask permissions action is unavailable'); ask.click(); ws.send = originalSend;
      assert(sent.length === 1 && sent[0].sessionId === driver.id && sent[0].projectSlug === store.get('currentSlug') && sent[0].mode === 'default',
        'singleton Ask permissions action targeted a different session');
      var pairSnapshot = JSON.stringify(group), controls = pane.querySelector('.split-view-worker-controls');
      assert(controls && controls.dataset.driverOrigin === driver.sessionOriginId, 'paired Driver singleton does not expose its exact Worker Controls action');
      controls.click();
      await waitFor(function () { return store.get('splitPanes') && store.get('splitPanes').groupId === group.id && legacyGroupPanesReady(group); }, 'exact legacy Worker controls from paired Driver singleton');
      var workerId = group.pair.workerIds[0], workerPane = document.querySelector('#split-host > .split-pane[data-session-id="' + workerId + '"]');
      var workerFrame = workerPane && workerPane.querySelector('.split-pane-frame'), stopButton = workerFrame && workerFrame.contentDocument.getElementById('generation-stop');
      await fetch('/fixture/review?id=' + workerId, { method: 'POST' });
      var allowButton = null;
      await waitFor(function () { allowButton = workerFrame.contentDocument.querySelector('.permission-container[data-request-id="review-' + workerId + '"] .permission-allow, .permission-container[data-request-id="review-' + workerId + '"] .mate-permission-allow'); return !!allowButton; }, 'singleton-opened Worker review card');
      allowButton.click();
      await waitForAsync(async function () { var data = await (await fetch('/fixture/state')).json(); return data.reviews.some(function (entry) { return entry.sessionId === workerId && entry.decision && entry.decision.behavior === 'allow'; }); }, 'singleton-opened Worker review action');
      await fetch('/fixture/running?id=' + workerId, { method: 'POST' });
      await waitFor(function () { return stopButton && !stopButton.classList.contains('hidden') && !stopButton.disabled; }, 'singleton-opened Worker Stop control');
      stopButton.click();
      await waitForAsync(async function () { var data = await (await fetch('/fixture/state')).json(); return data.stopped.indexOf(workerId) >= 0; }, 'singleton-opened Worker Stop action');
      assert(JSON.stringify((store.get('splitGroups') || []).find(function (item) { return item.id === group.id; })) === pairSnapshot, 'singleton Worker Controls changed the execution group');
      rowFor(standalone.id).click();
      await waitFor(function () { return store.get('activeSessionId') === standalone.id && !store.get('splitPanes') && allPanesReady(); }, 'return to one Pane after Worker controls');
      rowFor(driver.id).click();
      await waitFor(function () { return store.get('activeSessionId') === driver.id && store.get('projectSplitViewSingletonOrigin') === driver.sessionOriginId && !store.get('splitPanes') && allPanesReady(); }, 'return to paired Driver singleton Pane');
      assert(document.querySelectorAll('#split-host > .split-pane').length === 1 && JSON.stringify((store.get('splitGroups') || []).find(function (item) { return item.id === group.id; })) === pairSnapshot,
        'return did not preserve the paired Driver singleton and its Worker execution group');
      result.pairedSingletonWorkersChecked = true;
    });
    await check('empty and loading Worker snapshots remain read-only without losing their exact source', async function () {
      var pane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]');
      var emptyChip = pane.querySelector('[data-worker-generation="1"]');
      assert(emptyChip, 'empty archive fixture chip is missing'); emptyChip.click();
      assert(document.getElementById('split-view-worker-popover').textContent.indexOf('Loading conversation') >= 0, 'initial Worker snapshot did not expose loading');
      await waitFor(function () { var popup = document.getElementById('split-view-worker-popover'); return popup && popup.textContent.indexOf('No recorded conversation.') >= 0; }, 'empty Worker snapshot');
      var popup = document.getElementById('split-view-worker-popover');
      assert(!popup.querySelector('iframe, input, textarea, [contenteditable="true"]') && popup.querySelectorAll('button').length === 1, 'empty snapshot exposed writable controls');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(document.activeElement === emptyChip, 'empty snapshot lost source focus');
    });
    await check('actual header X preserves surviving panes and dissolves only the final two-member presentation', async function () {
      var driver = getCachedSessions().find(function (item) { return item.sessionOriginId === result.pairedDriverOrigin; });
      var used = (store.get('projectSplitViews') || []).flatMap(function (item) { return item.sessions.map(function (session) { return session.id; }); });
      var others = getCachedSessions().filter(function (item) { return item.title.indexOf('Standalone ') === 0 && used.indexOf(item.id) === -1; }).slice(0, 3);
      assert(others.length === 3, 'three independent Drivers are required for close checks');
      var members = [driver].concat(others), ids = members.map(function (item) { return item.sessionOriginId; });
      var pairs = JSON.stringify(store.get('splitGroups')), sessionIds = getCachedSessions().map(function (item) { return item.id; }).sort().join(',');
      document.dispatchEvent(new CustomEvent('clay-split-view-create', { detail: { origins: ids } }));
      await waitFor(function () { return currentView() && currentView().sessions.length === 4 && !store.get('projectSplitViewPending') && allPanesReady(); }, 'four close-test panes');
      var operationsBefore = await (await fetch('/fixture/state')).json();
      var processingBefore = JSON.stringify(getCachedSessions().map(function (item) { return [item.id, item.isProcessing]; }));
      var original = JSON.stringify(currentView()), kept = readIdentity();
      var closeButton = paneFrame(others[0].sessionOriginId).closest('.split-pane').querySelector('.split-pane-close');
      var frame = paneFrame(others[0].sessionOriginId), savedOrigin = frame.dataset.sessionOriginId;
      frame.dataset.sessionOriginId = 'stale-origin'; closeButton.click(); frame.dataset.sessionOriginId = savedOrigin;
      assert(!store.get('projectSplitViewPending') && JSON.stringify(currentView()) === original, 'stale source closed a pane');
      await fetch('/fixture/fail-next-write', { method: 'POST' }); closeButton.click();
      await waitFor(function () { return !store.get('projectSplitViewPending') && store.get('projectSplitViewError'); }, 'close persistence refusal');
      assert(JSON.stringify(currentView()) === original, 'failed close changed the saved view');
      var presentations = await import('/p/reuse/modules/split-view-presentations.js'); presentations.requestProjectSplitViews();
      await waitFor(function () { return !store.get('projectSplitViewError'); }, 'close failure recovery');
      var expected = remove(currentView().tree, others[0].sessionOriginId); closeButton.click();
      await waitFor(function () { return currentView() && currentView().sessions.length === 3 && !store.get('projectSplitViewPending') && allPanesReady(); }, 'nonfocused header close');
      assert(JSON.stringify(currentView().tree) === JSON.stringify(expected), 'close rebuilt surviving geometry');
      assertSameIdentity(kept.filter(function (item) { return item.origin !== others[0].sessionOriginId; }), 'nonfocused close');
      document.dispatchEvent(new CustomEvent('clay-split-view-focus', { detail: { focused: true, sessionOriginId: others[1].sessionOriginId } }));
      paneFrame(others[1].sessionOriginId).closest('.split-pane').querySelector('.split-pane-close').click();
      await waitFor(function () { return currentView() && currentView().sessions.length === 2 && !store.get('projectSplitViewPending') && allPanesReady(); }, 'focused header close');
      assert(!store.get('projectSplitViewFocusedOrigin'), 'removed pane remained focused');
      rowFor(others[2].id).click();
      await waitFor(function () { return store.get('activeSessionId') === others[2].id && !store.get('projectSplitViewPending'); }, 'select final removable pane');
      var survivor = paneFrame(driver.sessionOriginId), survivorDocument = survivor.contentDocument;
      paneFrame(others[2].sessionOriginId).closest('.split-pane').querySelector('.split-pane-close').click();
      await waitFor(function () { return !currentView() && store.get('projectSplitViewSingletonOrigin') === driver.sessionOriginId && store.get('activeSessionId') === driver.id && allPanesReady(); }, 'remaining singleton after active close');
      assert(paneFrame(driver.sessionOriginId) === survivor && survivor.contentDocument === survivorDocument, 'two-pane dissolve replaced the remaining frame');
      assert(JSON.stringify(store.get('splitGroups')) === pairs, 'presentation close changed execution groups');
      assert(getCachedSessions().map(function (item) { return item.id; }).sort().join(',') === sessionIds, 'presentation close deleted a session');
      others.forEach(function (item) { assert(rowFor(item.id), 'removed session is missing from the sidebar'); });
      var operationsAfter = await (await fetch('/fixture/state')).json();
      assert(JSON.stringify(operationsAfter.stopped) === JSON.stringify(operationsBefore.stopped) && JSON.stringify(getCachedSessions().map(function (item) { return [item.id, item.isProcessing]; })) === processingBefore, 'presentation close stopped a session');
    });
    await check('late Worker replies are rejected after source hiding and owner changes', async function () {
      var pane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]');
      var workerUi = await import('/p/reuse/modules/split-view-workers.js'), delayedRequest = null, originalWs = getWs();
      var delayedWs = { readyState: 1, send: function (raw) { delayedRequest = JSON.parse(raw); } };
      setWs(delayedWs); pane.querySelector('[data-worker-origin="' + result.workerOrigins[0] + '"]').click();
      assert(delayedRequest && store.get('splitViewWorkerConversation'), 'fixture could not open a pending Worker conversation');
      var standalone = getCachedSessions().find(function (session) { return session.title === 'Standalone 1'; });
      setWs(originalWs); rowFor(standalone.id).click();
      await waitFor(function () { return store.get('activeSessionId') === standalone.id && store.get('projectSplitViewSingletonOrigin') === standalone.sessionOriginId; }, 'hide singleton Worker source after session selection');
      var late = Object.assign({}, delayedRequest, { type: 'split_worker_conversation', messages: [{ role: 'assistant', text: 'LATE_SOURCE_RESPONSE' }] });
      assert(!document.getElementById('split-view-worker-popover') && workerUi.handleSplitWorkerConversation(late) === false,
        'late Worker response survived source pane hiding');
      rowFor(getCachedSessions().find(function (session) { return session.sessionOriginId === result.pairedDriverOrigin; }).id).click();
      await waitFor(function () { return store.get('projectSplitViewSingletonOrigin') === result.pairedDriverOrigin && allPanesReady(); }, 'restore paired Driver singleton for owner-change test');
      pane = document.querySelector('.split-pane[data-session-origin="' + result.pairedDriverOrigin + '"]');
      var originalOwner = store.get('myUserId');
      delayedRequest = null; setWs(delayedWs);
      pane.querySelector('[data-worker-origin="' + result.workerOrigins[0] + '"]').click();
      assert(delayedRequest && store.get('splitViewWorkerConversation'), 'fixture could not open a pending Worker conversation');
      store.set({ myUserId: 'replacement-owner' });
      assert(!store.get('splitViewWorkerConversation') && !document.getElementById('split-view-worker-popover'), 'owner transition left the old Worker popup open');
      var splitHost = document.getElementById('split-host'), staleFrame = pane.querySelector('.split-pane-frame');
      assert(!splitHost.classList.contains('visible') && !splitHost.classList.contains('split-view-canvas'), 'stale canvas class kept a singleton pane visible after owner context changed');
      assert(!staleFrame.clayPane.identity().ready, 'stale singleton frame remained interactive after owner context changed');
      store.set({ myUserId: originalOwner });
      setWs(originalWs);
    });
  } catch (error) {
    var debugPane = document.querySelector('#split-host > .split-pane'), debugFrame = debugPane && debugPane.querySelector('.split-pane-frame'), debugIdentity = debugFrame && debugFrame.clayPane && debugFrame.clayPane.identity();
    var childState = null;
    try {
      var childStoreModule = await debugFrame.contentWindow.Function("return import('/p/reuse/modules/store.js')")();
      var childSnap = childStoreModule.store.snap();
      childState = { paneMode: childSnap.paneMode, connected: childSnap.connected, authIdentityLoaded: childSnap.authIdentityLoaded,
        activeSessionId: childSnap.activeSessionId, sessionOriginId: childSnap.sessionOriginId, paneSessionId: childSnap.paneSessionId,
        panePinPending: childSnap.panePinPending, paneReady: childSnap.paneReady, panePendingBinding: childSnap.panePendingBinding,
        paneCommittedBinding: childSnap.paneCommittedBinding, paneActivationGeneration: childSnap.paneActivationGeneration,
        splitGroupsProjectSlug: childSnap.splitGroupsProjectSlug, wsPath: childSnap.wsPath };
    } catch (childError) { childState = { error: childError.message }; }
    var activationLog = null;
    try { activationLog = await (await fetch('/fixture/activation-log')).json(); } catch (activationError) { activationLog = { error: activationError.message }; }
    result.debug = { activeId: store.get("projectSplitViewActiveId"), activeSessionId: store.get('activeSessionId'), singletonOrigin: store.get('projectSplitViewSingletonOrigin'), connected: store.get('connected'), sessionListProjectSlug: store.get('sessionListProjectSlug'), revision: store.get("projectSplitViewRevision"), pending: store.get("projectSplitViewPending"), stateError: store.get("projectSplitViewError"), menuHidden: document.getElementById("split-view-arrange-menu") && document.getElementById("split-view-arrange-menu").hidden, arrangementEvents: arrangementEvents, lastArrangement: lastArrangement, sourceOrigin: document.getElementById("split-view-arrange-menu") && document.getElementById("split-view-arrange-menu").dataset.sourceOrigin, paneCount: document.querySelectorAll('#split-host > .split-pane').length, frame: debugFrame && { src: debugFrame.src, sessionId: debugFrame.dataset.sessionId, origin: debugFrame.dataset.sessionOriginId, requested: debugFrame.dataset.requestedSessionId, activationFailure: debugFrame.dataset.paneActivationFailure, ready: debugIdentity && debugIdentity.ready, liveSessionId: debugIdentity && debugIdentity.sessionId, liveOrigin: debugIdentity && debugIdentity.binding && debugIdentity.binding.sessionOriginId, sourceMatches: debugFrame.clayPane && debugFrame.clayPane.source === debugFrame.contentWindow, documentMatches: debugFrame.clayPane && debugFrame.clayPane.document === debugFrame.contentDocument }, childState: childState, activationLog: activationLog && activationLog.slice(-12), bindingSessions: store.get('paneBindingSessions'), tree: currentView() && currentView().tree };
    if (!result.errors.length) result.errors.push(error.stack || error.message);
  }
  try { result.serverActivationTimings = await (await fetch('/fixture/activation-log')).json(); } catch (timingError) { result.startupMeasurementError = timingError.message; }
  window.splitViewProductionCheckResult = result;
  output.textContent = JSON.stringify(result, null, 2);
  button.disabled = false;
  return result;
};

var panel = document.createElement('aside');
panel.setAttribute('aria-label', 'Split view production fixture');
panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;width:330px;max-height:300px;overflow:auto;padding:9px;background:#f5f3ee;color:#252525;border:1px solid #9c9a94;border-radius:8px;font:12px sans-serif';
var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Run Split view checks';
var output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.whiteSpace = 'pre-wrap';
output.textContent = 'Isolated production app fixture. Provider execution is disabled.';
button.addEventListener('click', function () { button.disabled = true; window.runSplitViewProductionChecks(); });
panel.append(button, output); document.body.appendChild(panel);
