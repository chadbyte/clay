import { store } from './store.js';
import { pickerCandidates } from './split-view-picker-render.js';
import { createOptions } from './session-create.js';
import { sortVendorEntries } from './vendor-priority.js';
import { VENDOR_NAMES, VENDOR_AVATARS } from './chat-render-runtime.js';
import { iconHtml, refreshIcons } from './icons.js';

function element(tag, className, text) {
  var node = document.createElement(tag); node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(label, key, value) {
  var node = element('button', '', label); node.type = 'button';
  node.dataset[key] = value || 'true'; return node;
}
function relativeTime(time) {
  if (!time) return '';
  var minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.floor(minutes / 60) + 'h ago' : Math.floor(minutes / 1440) + 'd ago';
}
function detail(session) {
  var vendor = VENDOR_NAMES[session.vendor] || session.vendor || 'Session';
  var links = (session.linearLinks || []).concat(session.githubLinks || []);
  var linked = links.find(function (link) { return link.title; });
  var activity = session.isProcessing ? 'Working now' : session.backgroundTaskCount > 0 ? 'Background work running' : 'Open conversation';
  return vendor + ' · ' + (linked ? linked.title : activity);
}
export function renderProjectHome(root, state) {
  var focused = root.contains(document.activeElement) ? document.activeElement : null;
  var focusKey = focused && ['splitSession', 'splitVendor', 'splitRetry'].find(function (key) { return focused.dataset[key]; });
  var focusValue = focusKey && focused.dataset[focusKey];
  root.replaceChildren();
  var blocked = !!state.pending || !store.get('connected');
  var header = element('div', 'project-home-heading');
  var title = element('h1', '', 'Continue your work'); header.appendChild(title);
  root.appendChild(header);
  var list = element('div', 'project-home-recent'); list.setAttribute('aria-label', 'Recent work');
  pickerCandidates('', true).slice(0, 3).forEach(function (session) {
    var row = button('', 'splitSession', String(session.id)); row.className = 'project-home-row'; row.disabled = blocked;
    row.setAttribute('aria-label', 'Continue ' + (session.title || 'New session'));
    var content = element('span', 'project-home-copy');
    content.appendChild(element('strong', '', session.title || 'New session'));
    content.appendChild(element('span', 'project-home-detail', detail(session))); row.appendChild(content);
    var trailing = element('span', 'project-home-trailing');
    trailing.appendChild(element('small', '', relativeTime(session.lastActivity || session.createdAt)));
    var arrow = element('span', 'project-home-arrow'); arrow.innerHTML = iconHtml('arrow-right'); trailing.appendChild(arrow); row.appendChild(trailing);
    list.appendChild(row);
  });
  if (!list.children.length) list.appendChild(element('p', 'project-home-empty', 'A fresh start. Create a session to begin working here.'));
  root.appendChild(list);
  root.appendChild(element('h2', 'project-home-create-label', 'New session'));
  var vendors = element('div', 'project-home-vendors'); vendors.id = 'project-home-vendors';
  vendors.setAttribute('role', 'group');
  vendors.setAttribute('aria-label', 'New session');
  var options = createOptions(), installed = sortVendorEntries(options.vendors.filter(function (vendor) { return vendor.installed; }));
  installed.forEach(function (vendor) {
    var label = VENDOR_NAMES[vendor.id] || vendor.displayName || vendor.id;
    var choice = button('', 'splitVendor', vendor.id); choice.disabled = blocked;
    choice.setAttribute('aria-label', 'New ' + label + ' session');
    choice.dataset.tip = 'New ' + label + ' session';
    var image = document.createElement('img'); image.src = VENDOR_AVATARS[vendor.id] || '/icon-192.png'; image.alt = '';
    choice.appendChild(image); vendors.appendChild(choice);
  });
  if (options.error || !installed.length) {
    vendors.appendChild(element('p', '', options.error || (options.loaded ? 'No installed providers available.' : 'Loading providers…')));
    if (options.error) vendors.appendChild(button('Retry', 'splitRetry'));
  }
  root.appendChild(vendors);

  var status = element('p', 'project-home-status', state.pending ? 'Creating session…' : state.error || (!store.get('connected') ? 'Reconnecting…' : ''));
  status.setAttribute('role', 'status'); root.appendChild(status);
  if (focusKey) {
    var restored = Array.from(root.querySelectorAll('button')).find(function (node) { return node.dataset[focusKey] === focusValue && !node.disabled; });
    if (restored) restored.focus({ preventScroll: true });
  }
  refreshIcons();
}
