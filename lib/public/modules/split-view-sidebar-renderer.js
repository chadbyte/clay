import { store } from './store.js';
import { appendViewOrganization } from './split-view-organization.js';
import { iconHtml } from './icons.js';

export function renderPresentationSplitViewItem(view, members, renderSessionItem, containerId, surface) {
  var root = document.createElement("div"), activeId = store.get('projectSplitViewActiveId');
  var fullName = view.nameMode === "automatic" ? members.map(function (session) { return session.title || "Session"; }).join(" + ") : view.name;
  var nameCharacters = Array.from(fullName);
  var displayName = nameCharacters.length > 80 ? nameCharacters.slice(0, 79).join("") + "…" : fullName;
  root.className = "split-view-group"; root.dataset.splitViewId = view.id; root.dataset.splitViewProjection = containerId || 'unfiled'; root.dataset.splitViewSurface = surface || 'desktop';
  root.dataset.active = activeId === view.id ? "true" : "false"; root.title = fullName;
  var heading = document.createElement("div"); heading.className = "split-view-group-heading";
  var open = document.createElement("button"); open.type = "button"; open.className = "split-view-group-open";
  open.setAttribute("aria-expanded", activeId === view.id ? "true" : "false");
  open.setAttribute("aria-label", "Open Split view " + fullName); open.title = fullName;
  open.innerHTML = iconHtml("columns-2");
  var name = document.createElement("span"); name.className = "split-view-group-name"; name.textContent = displayName; open.appendChild(name);
  var count = document.createElement("span"); count.className = "split-view-group-count"; count.textContent = String(members.length); open.appendChild(count);
  heading.appendChild(open);
  appendViewOrganization(heading, view);
  var more = document.createElement("button"); more.type = "button"; more.className = "split-view-group-more";
  more.setAttribute("aria-label", "Split view options " + fullName); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false");
  more.innerHTML = iconHtml("ellipsis"); heading.appendChild(more); root.appendChild(heading);
  var children = document.createElement("div"); children.className = "split-view-group-children";
  for (var i = 0; containerId !== 'favorites' && i < members.length; i++) children.appendChild(renderSessionItem(members[i]));
  root.appendChild(children);
  var error = document.createElement("div"); error.className = "split-view-group-error";
  error.textContent = store.get('projectSplitViewError') || ""; error.hidden = !error.textContent; root.appendChild(error);
  return root;
}

export function renderPresentationArrangeEntry() {
  var root = document.createElement("div"); root.className = "split-view-create-entry";
  var trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "split-view-create-trigger";
  trigger.dataset.splitViewCreateTrigger = "true"; trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-label", "Arrange sessions into a Split view"); trigger.textContent = "Arrange sessions";
  root.appendChild(trigger);
  return root;
}
