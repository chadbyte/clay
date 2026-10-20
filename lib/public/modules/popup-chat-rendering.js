// Popup transcript presentation hooks. Tool identity, lifecycle and evidence
// stay owned by tools.js; this module only controls the compact activity view.
import { iconHtml } from './icons.js';
import { syncToolGroupDisclosure } from './clay-tool-activity.js';

// Mounted transcript nodes own completed records without retaining removed history.
var mountedToolGroups = new WeakMap();
export function rememberMountedToolGroup(group) { mountedToolGroups.set(group.el, group); }
export function mountedToolGroup(element) { return mountedToolGroups.get(element) || null; }
export function transcriptToolGroups(root) {
  return root ? Array.from(root.querySelectorAll('.tool-group')).map(mountedToolGroup).filter(function (group) { return !!group; }) : [];
}

export function setPopupChatRendering(enabled) {
  if (typeof document === 'undefined' || !document.body) return false;
  document.body.classList.toggle('popup-chat-rendering', enabled === true);
  if (!enabled) {
    var rows = document.querySelectorAll('.popup-chat-activity-row[hidden]');
    for (var i = 0; i < rows.length; i++) rows[i].hidden = false;
    var groups = document.querySelectorAll('.popup-chat-activity');
    for (var j = 0; j < groups.length; j++) {
      var items = groups[j].querySelector('.tool-group-items');
      if (items) {
        var expanded = !groups[j].classList.contains('collapsed');
        items.inert = !expanded;
        items.setAttribute('aria-hidden', String(!expanded));
      }
    }
  }
  return enabled === true;
}

export function shouldEnablePopupChatRendering(body, state, frame, identity) {
  return !!(body && body.classList && body.classList.contains('contextual-chat-pane') && state && state.paneMode && frame &&
    identity && identity.kind === 'mate' && identity.mateId && identity.mateId === frame.dataset.mateId &&
    state.myUserId && state.sessionOriginId && state.paneSessionId && state.activeSessionId === state.paneSessionId &&
    (!frame.dataset.expectedSessionOrigin || frame.dataset.expectedSessionOrigin === state.sessionOriginId));
}

export function popupChatContextIsReady(body, state, frame, identity, surface) {
  if (!body || !body.classList || !body.classList.contains('contextual-chat-pane')) return false;
  if (!state || !state.paneMode || !state.connected || !state.myUserId || !state.contextualSessionReady) return false;
  if (!state.sessionOriginId || state.activeSessionId !== state.paneSessionId) return false;
  if (!frame || !frame.dataset || !frame.dataset.mateId || frame.dataset.ownerId !== state.myUserId) return false;
  if (frame.hidden || frame.inert || !surface || surface.dataset.mode !== 'popover' || !surface.contains(frame)) return false;
  if (String(frame.dataset.sessionId || '') !== String(state.paneSessionId || '')) return false;
  if (frame.dataset.expectedSessionOrigin && frame.dataset.expectedSessionOrigin !== state.sessionOriginId) return false;
  if (state.activeProjectMateId !== frame.dataset.mateId) return false;
  if (!identity || identity.kind !== 'mate' || identity.mateId !== frame.dataset.mateId) return false;
  return true;
}

export function popupChatRenderingEnabled(identity) {
  return !!(identity && identity.kind === 'mate' && typeof document !== 'undefined' &&
    document.body && document.body.classList.contains('popup-chat-rendering'));
}

export function popupChatRenderingActive() {
  return typeof document !== 'undefined' && document.body && document.body.classList.contains('popup-chat-rendering');
}

export function reconcilePopupToolGroups(groups, active, activate, deactivate) {
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    if (!group) continue;
    if (active) {
      group.popupChat = true;
      activate(group);
    } else if (group.popupChat) {
      deactivate(group);
      group.popupChat = false;
    }
  }
}

function decorateTool(tool) {
  if (!tool || !tool.el || tool.popupOriginalName !== undefined) return;
  var name = tool.el.querySelector('.tool-name');
  tool.popupOriginalName = name.textContent;
  tool.popupOriginalHidden = tool.el.hidden;
  tool.popupOriginalInert = tool.el.inert;
  tool.el.classList.add('popup-chat-activity-row');
  // Native descriptions own reference nodes and their handlers throughout mode changes.
  if (!tool.clayActivity) {
    tool.popupPresentedName = popupToolActionLabel(tool.name);
    name.textContent = tool.popupPresentedName;
  }
}

function decorateGroup(group) {
  if (!group || !group.el || group.popupOriginalState) return;
  var header = group.el.querySelector('.tool-group-header');
  var label = group.el.querySelector('.tool-group-label');
  group.popupOriginalState = {
    label: label.textContent,
    collapsed: group.el.classList.contains('collapsed'),
    userToggled: !!group.userToggled,
    groupDisplay: group.el.style.display,
    headerDisplay: header.style.display,
    headerAriaExpanded: header.getAttribute('aria-expanded'),
    headerAriaLabel: header.getAttribute('aria-label'),
    headerTitle: header.title
  };
  group.el.classList.add('popup-chat-activity');
  var icon = document.createElement('span');
  icon.className = 'popup-chat-activity-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = iconHtml('activity');
  var heading = document.createElement('span');
  heading.className = 'popup-chat-activity-heading';
  heading.textContent = 'Activity';
  label.textContent = '';
  label.appendChild(heading);
  var count = document.createElement('span');
  count.className = 'popup-chat-activity-count';
  count.setAttribute('aria-label', '0 recorded events');
  header.insertBefore(icon, label);
  header.insertBefore(count, header.querySelector('.tool-group-status-icon'));
  for (var i = 0; i < group.toolIds.length; i++) decorateTool(group.toolRecords[group.toolIds[i]]);
}

function restoreGroup(group) {
  if (!group || !group.el) return;
  for (var i = 0; i < group.toolIds.length; i++) {
    var tool = group.toolRecords[group.toolIds[i]];
    if (!tool || !tool.el || tool.popupOriginalName === undefined) continue;
    var name = tool.el.querySelector('.tool-name');
    if (!tool.clayActivity && name.textContent === tool.popupPresentedName) name.textContent = tool.popupOriginalName;
    tool.el.hidden = tool.popupOriginalHidden;
    tool.el.inert = tool.popupOriginalInert;
    tool.el.classList.remove('popup-chat-activity-row');
    delete tool.popupOriginalName;
    delete tool.popupPresentedName;
    delete tool.popupOriginalHidden;
    delete tool.popupOriginalInert;
  }
  var original = group.popupOriginalState;
  group.popupOriginalState = null;
  if (!original) return;
  var label = group.el.querySelector('.tool-group-label');
  var header = group.el.querySelector('.tool-group-header');
  label.textContent = original.label;
  group.el.style.display = original.groupDisplay;
  header.style.display = original.headerDisplay;
  group.userToggled = original.userToggled;
  group.el.classList.toggle('collapsed', original.collapsed);
  if (original.headerAriaLabel === null) header.removeAttribute('aria-label');
  else header.setAttribute('aria-label', original.headerAriaLabel);
  header.title = original.headerTitle;
  var icon = header.querySelector('.popup-chat-activity-icon');
  var count = header.querySelector('.popup-chat-activity-count');
  if (icon) icon.remove();
  if (count) count.remove();
  group.el.classList.remove('popup-chat-activity');
  syncToolGroupDisclosure(group.el);
  if (original.headerAriaExpanded !== null) header.setAttribute('aria-expanded', original.headerAriaExpanded);
}

export function syncPopupChatToolGroups(enabled, groups, identity) {
  var active = !!(enabled && popupChatRenderingActive() && identity && identity.kind === 'mate');
  reconcilePopupToolGroups(groups, active, function (group) {
    decorateGroup(group);
    for (var i = 0; i < group.toolIds.length; i++) decorateTool(group.toolRecords[group.toolIds[i]]);
    group.el.style.display = '';
    group.el.querySelector('.tool-group-header').style.display = '';
    if (!group.userToggled) group.el.classList.add('collapsed');
    syncToolGroupDisclosure(group.el);
    syncPopupActivityGroup(group);
  }, restoreGroup);
}

function hasIndependentControl(row) {
  if (!row || !row.querySelectorAll) return false;
  var controls = row.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="option"]');
  var disclosure = row.querySelector('.tool-header');
  if (row.querySelector('.tool-desc-link')) return true;
  for (var i = 0; i < controls.length; i++) {
    if (controls[i] !== disclosure) return true;
  }
  return false;
}

export function syncPopupActivityGroup(group) {
  if (!group || !group.popupChat || !group.el) return false;
  var header = group.el.querySelector('.tool-group-header');
  var items = group.el.querySelector('.tool-group-items');
  var count = group.el.querySelector('.popup-chat-activity-count');
  if (!header || !items) return false;

  var expanded = !group.el.classList.contains('collapsed');
  var rows = items.children;
  var firstVisible = Math.max(0, rows.length - 2);
  var pinned = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var keepVisible = hasIndependentControl(row);
    if (keepVisible) pinned++;
    row.classList.add('popup-chat-activity-row');
    row.hidden = !expanded && i < firstVisible && !keepVisible;
    row.inert = row.hidden;
  }

  // The native group disclosure remains the one control for revealing older
  // activity. In popup mode the visible recent rows stay reachable even while
  // the rest of the group is collapsed.
  items.inert = false;
  items.setAttribute('aria-hidden', 'false');
  header.setAttribute('aria-expanded', String(expanded));
  header.setAttribute('aria-label', 'Activity, ' + group.toolCount + ' recorded events. ' + (expanded ? 'Hide older activity' : 'Show older activity'));
  header.title = expanded ? 'Hide older activity' : 'Show older activity';
  if (count) {
    count.textContent = String(group.toolCount);
    count.setAttribute('aria-label', group.toolCount + ' recorded events');
    count.dataset.pinnedCount = String(pinned);
  }
  return true;
}

export function popupToolActionLabel(name) {
  var labels = {
    Read: 'Read', Edit: 'Edit', Write: 'Write', Bash: 'Command',
    Grep: 'Search files', Glob: 'Find files', WebSearch: 'Web search',
    WebFetch: 'Fetch page', Task: 'Task'
  };
  return labels[name] || name || 'Tool activity';
}

export function popupToolDescription(name, input) {
  input = input && typeof input === 'object' ? input : {};
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    var filePath = typeof input.file_path === 'string' ? input.file_path : '';
    var parts = filePath.split('/');
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : filePath;
  }
  if (name === 'Bash') return typeof input.description === 'string' ? input.description.slice(0, 100) : '';
  if (name === 'Grep') return typeof input.pattern === 'string' ? input.pattern.slice(0, 100) : '';
  if (name === 'Glob') return typeof input.pattern === 'string' ? input.pattern.slice(0, 100) : '';
  if (name === 'WebSearch') return typeof input.query === 'string' ? input.query.slice(0, 100) : '';
  if (name === 'WebFetch') {
    try { return new URL(input.url).hostname; } catch (error) { return ''; }
  }
  if (name === 'Task') return typeof input.description === 'string' ? input.description.slice(0, 100) : '';
  return '';
}
