// Single renderer for ordinary-project and Mate identities in the sidebar header.

import { mateAvatarUrl } from './avatar.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './chat-render-runtime.js';
import { getHomeMateBio } from './home-mate-selection.js';
import { parseEmojis } from './markdown.js';
import { refreshIcons } from './icons.js';

function projectForState(state) {
  var projects = state.projectsHubList || [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i] && projects[i].slug === state.currentSlug) return projects[i];
  }
  return null;
}

function mateName(mate) {
  var profile = mate && mate.profile ? mate.profile : {};
  return profile.displayName || (mate && (mate.displayName || mate.name)) || 'Mate';
}

export function isMateHeaderWorkspace(state) {
  var projects = state.projectsHubList || [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i] && projects[i].slug === state.currentSlug && projects[i].isMate === true) return true;
  }
  var mates = state.cachedMatesList || [];
  for (var j = 0; j < mates.length; j++) {
    if (mates[j] && state.currentSlug === 'mate-' + mates[j].id) return true;
  }
  return false;
}

function clearMateIdentity(icon, dropdown) {
  icon.classList.remove('is-mate-avatar');
  icon.classList.remove('is-clay-identity');
  icon.removeAttribute('data-vendor');
  delete dropdown.dataset.mateDefaults;
  delete dropdown.dataset.mateBio;
  delete dropdown.dataset.clayIdentity;
  dropdown.removeAttribute('aria-label');
  dropdown.removeAttribute('title');
}

export function renderOrdinaryProjectHeader(state) {
  var dropdown = document.getElementById('title-bar-project-dropdown');
  var icon = document.getElementById('title-bar-project-icon');
  var name = document.getElementById('title-bar-project-name');
  var detail = document.getElementById('title-bar-project-default');
  if (!dropdown || !icon || !name || !detail) return false;
  var project = projectForState(state);
  clearMateIdentity(icon, dropdown);
  detail.textContent = '';
  icon.textContent = '';
  var projectIcon = project && project.icon ? project.icon : '';
  if (projectIcon) {
    icon.textContent = projectIcon;
    icon.classList.add('has-icon');
    parseEmojis(icon);
  } else {
    icon.classList.remove('has-icon');
  }
  if (project) name.textContent = project.title || project.project || project.name || state.projectName || '';
  return !!project;
}

export function renderMateProjectHeader(state, mate) {
  var dropdown = document.getElementById('title-bar-project-dropdown');
  var icon = document.getElementById('title-bar-project-icon');
  var name = document.getElementById('title-bar-project-name');
  var detail = document.getElementById('title-bar-project-default');
  if (!dropdown || !icon || !name || !detail || !mate || state.homeShellVisible) return false;
  var displayName = mateName(mate);
  var vendor = mate.vendor || '';
  var vendorName = VENDOR_NAMES[vendor] || vendor || 'Default vendor';
  var bio = getHomeMateBio(mate).replace(/\s+/g, ' ').trim();
  var isClay = mate.builtinKey === 'clay';
  icon.textContent = '';
  icon.classList.add('has-icon');
  icon.classList.toggle('is-mate-avatar', !isClay);
  icon.classList.toggle('is-clay-identity', isClay);
  if (vendor) icon.dataset.vendor = vendor;
  else icon.removeAttribute('data-vendor');
  if (!isClay) {
    var avatar = document.createElement('img');
    avatar.className = 'title-bar-mate-avatar';
    avatar.src = mateAvatarUrl(mate, 56);
    avatar.alt = '';
    avatar.draggable = false;
    icon.appendChild(avatar);
  }
  if (!isClay && vendor && VENDOR_AVATARS[vendor]) {
    var badge = document.createElement('img');
    badge.className = 'title-bar-mate-vendor';
    badge.src = VENDOR_AVATARS[vendor];
    badge.alt = '';
    badge.draggable = false;
    badge.title = vendorName;
    icon.appendChild(badge);
  }
  name.textContent = displayName;
  detail.textContent = bio;
  if (isClay) {
    detail.textContent = '';
    var badge = document.createElement('span');
    badge.className = 'clay-role-badge';
    var insignia = document.createElement('i');
    insignia.className = 'clay-role-insignia';
    insignia.setAttribute('data-lucide', 'crown');
    insignia.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    label.className = 'clay-role-label';
    label.textContent = 'Lead Mate';
    badge.appendChild(insignia);
    badge.appendChild(label);
    detail.appendChild(badge);
    refreshIcons();
  }
  dropdown.dataset.mateDefaults = 'true';
  delete dropdown.dataset.clayIdentity;
  delete dropdown.dataset.mateBio;
  if (isClay) dropdown.dataset.clayIdentity = 'true';
  else if (bio) dropdown.dataset.mateBio = 'true';
  dropdown.setAttribute('aria-label', 'Open Mate settings for ' + displayName);
  dropdown.title = 'Open Mate settings';
  return true;
}
