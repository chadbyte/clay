// User profile module — Discord-style popover for name, language, avatar
// Stores profile server-side in ~/.clay/profile.json
// Avatar generated via DiceBear API (deterministic SVG from seed)

import { iconHtml, refreshIcons } from './icons.js';
import { setSTTLang, getSTTLang } from './stt.js';

var ctx;
var profile = { name: '', lang: 'en-US', avatarStyle: 'thumbs', avatarSeed: '', avatarColor: '#7c3aed' };
var profileUsername = '';
var popoverEl = null;
var saveTimer = null;
var previewSeed = '';

var LANGUAGES = [
  { code: 'en-US', name: 'English' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'zh-CN', name: 'Chinese' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
];

var AVATAR_STYLES = [
  { id: 'thumbs', name: 'Thumbs' },
  { id: 'bottts', name: 'Bots' },
  { id: 'pixel-art', name: 'Pixel' },
  { id: 'adventurer', name: 'Adventurer' },
  { id: 'micah', name: 'Micah' },
  { id: 'lorelei', name: 'Lorelei' },
  { id: 'fun-emoji', name: 'Emoji' },
  { id: 'icons', name: 'Icons' },
];

var COLORS = [
  '#7c3aed', '#4f46e5', '#2563eb', '#0891b2',
  '#059669', '#65a30d', '#d97706', '#dc2626',
  '#db2777', '#6366f1', '#0d9488', '#ea580c',
  '#475569', '#1e293b', '#be123c', '#a21caf',
  '#0369a1', '#15803d',
];

// --- DiceBear URL builder ---
function avatarUrl(style, seed, size) {
  var s = encodeURIComponent(seed || 'anonymous');
  return 'https://api.dicebear.com/9.x/' + style + '/svg?seed=' + s + '&size=' + (size || 64);
}

function getAvatarSeed() {
  return profile.avatarSeed || 'anonymous';
}

// --- API ---
function fetchProfile() {
  return fetch('/api/profile').then(function(r) { return r.json(); });
}

function saveProfile() {
  return fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  }).then(function(r) { return r.json(); });
}

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    saveProfile();
    saveTimer = null;
  }, 400);
}

// --- DOM updates ---
function applyToIsland() {
  var avatarWrap = document.querySelector('.user-island-avatar');
  var nameEl = document.querySelector('.user-island-name');
  if (!avatarWrap || !nameEl) return;

  var displayName = profile.name || 'Awesome Clay User';

  // Replace letter fallback with DiceBear img
  var existingImg = avatarWrap.querySelector('img');
  var existingLetter = avatarWrap.querySelector('.user-island-avatar-letter');
  var url = avatarUrl(profile.avatarStyle || 'thumbs', getAvatarSeed(), 32);

  if (existingImg) {
    existingImg.src = url;
  } else {
    if (existingLetter) existingLetter.style.display = 'none';
    var img = document.createElement('img');
    img.src = url;
    img.alt = displayName;
    avatarWrap.appendChild(img);
  }

  nameEl.textContent = displayName;

  // Show CTA if user hasn't personalized their name
  var ctaEl = document.querySelector('.user-island-cta');
  if (ctaEl) {
    var isDefault = profileUsername && profile.name === profileUsername;
    if (isDefault) {
      ctaEl.classList.remove('hidden');
    } else {
      ctaEl.classList.add('hidden');
    }
  }
}

// --- Popover ---
function showPopover() {
  if (popoverEl) {
    hidePopover();
    return;
  }

  popoverEl = document.createElement('div');
  popoverEl.className = 'profile-popover';

  var displayName = profile.name || '';
  var currentLang = profile.lang || 'en-US';
  var currentColor = profile.avatarColor || '#7c3aed';
  var currentStyle = profile.avatarStyle || 'thumbs';
  var seed = getAvatarSeed();
  previewSeed = seed;

  var html = '';

  // Banner + close
  html += '<div class="profile-banner" style="background:' + currentColor + '">';
  html += '<button class="profile-close-btn">&times;</button>';
  html += '</div>';

  // Avatar row (overlapping banner)
  html += '<div class="profile-avatar-row">';
  html += '<div class="profile-popover-avatar">';
  html += '<img class="profile-popover-avatar-img" src="' + avatarUrl(currentStyle, seed, 80) + '" alt="avatar">';
  html += '</div>';
  html += '<div class="profile-name-display">' + escapeAttr(displayName || 'Awesome Clay User') + '</div>';
  html += '</div>';

  // Body
  html += '<div class="profile-popover-body">';

  // Name
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Display Name</label>';
  html += '<input type="text" class="profile-field-input" id="profile-name-input" value="' + escapeAttr(displayName) + '" placeholder="Enter your name..." maxlength="50" spellcheck="false" autocomplete="off">';
  html += '</div>';

  // Language dropdown
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Language <span class="profile-field-hint">for voice input</span></label>';
  html += '<select class="profile-field-select" id="profile-lang-select">';
  for (var i = 0; i < LANGUAGES.length; i++) {
    var l = LANGUAGES[i];
    var sel = (currentLang === l.code) ? ' selected' : '';
    html += '<option value="' + l.code + '"' + sel + '>' + l.name + '</option>';
  }
  html += '</select>';
  html += '</div>';

  // Avatar picker
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Avatar <button class="profile-shuffle-btn" title="Shuffle">' + iconHtml('shuffle') + '</button></label>';
  html += '<div class="profile-avatar-grid">';
  for (var j = 0; j < AVATAR_STYLES.length; j++) {
    var st = AVATAR_STYLES[j];
    var activeS = (currentStyle === st.id) ? ' profile-avatar-option-active' : '';
    html += '<button class="profile-avatar-option' + activeS + '" data-style="' + st.id + '" title="' + st.name + '">';
    html += '<img src="' + avatarUrl(st.id, seed, 40) + '" alt="' + st.name + '">';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  // Color
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Color</label>';
  html += '<div class="profile-color-grid">';
  for (var k = 0; k < COLORS.length; k++) {
    var c = COLORS[k];
    var activeC = (currentColor === c) ? ' profile-color-active' : '';
    html += '<button class="profile-color-swatch' + activeC + '" data-color="' + c + '" style="background:' + c + '"></button>';
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // close body

  popoverEl.innerHTML = html;

  // --- Events ---
  popoverEl.querySelector('.profile-close-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    hidePopover();
  });

  var nameInput = popoverEl.querySelector('#profile-name-input');
  nameInput.addEventListener('input', function() {
    profile.name = nameInput.value.trim();
    applyToIsland();
    updatePopoverHeader();
    debouncedSave();
  });

  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      hidePopover();
    }
    e.stopPropagation();
  });
  nameInput.addEventListener('keyup', function(e) { e.stopPropagation(); });
  nameInput.addEventListener('keypress', function(e) { e.stopPropagation(); });

  // Language dropdown
  popoverEl.querySelector('#profile-lang-select').addEventListener('change', function(e) {
    profile.lang = e.target.value;
    setSTTLang(profile.lang);
    debouncedSave();
  });

  // Avatar style — clicking confirms both the style and the current previewSeed
  popoverEl.querySelectorAll('.profile-avatar-option[data-style]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      profile.avatarStyle = btn.dataset.style;
      profile.avatarSeed = previewSeed;
      applyToIsland();
      updatePopoverHeader();
      popoverEl.querySelectorAll('.profile-avatar-option').forEach(function(b) {
        b.classList.remove('profile-avatar-option-active');
      });
      btn.classList.add('profile-avatar-option-active');
      debouncedSave();
    });
  });

  // Shuffle button — only changes preview candidates, not the actual profile
  popoverEl.querySelector('.profile-shuffle-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    previewSeed = Math.random().toString(36).substring(2, 10);
    refreshAvatarPreviews();
  });

  // Color swatches
  popoverEl.querySelectorAll('.profile-color-swatch').forEach(function(btn) {
    btn.addEventListener('click', function() {
      profile.avatarColor = btn.dataset.color;
      applyToIsland();
      var bannerEl = popoverEl.querySelector('.profile-banner');
      if (bannerEl) bannerEl.style.background = profile.avatarColor;
      popoverEl.querySelectorAll('.profile-color-swatch').forEach(function(b) {
        b.classList.remove('profile-color-active');
      });
      btn.classList.add('profile-color-active');
      debouncedSave();
    });
  });

  // Prevent clicks inside popover from closing it
  popoverEl.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  var island = document.getElementById('user-island');
  island.appendChild(popoverEl);
  refreshIcons();

  if (!profile.name) {
    nameInput.focus();
  }

  setTimeout(function() {
    document.addEventListener('click', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
  }, 0);
}

function updatePopoverHeader() {
  if (!popoverEl) return;
  var img = popoverEl.querySelector('.profile-popover-avatar-img');
  var nd = popoverEl.querySelector('.profile-name-display');
  if (img) img.src = avatarUrl(profile.avatarStyle || 'thumbs', getAvatarSeed(), 80);
  if (nd) nd.textContent = profile.name || 'Awesome Clay User';
}


function refreshAvatarPreviews() {
  if (!popoverEl) return;
  popoverEl.querySelectorAll('.profile-avatar-option[data-style] img').forEach(function(img) {
    var style = img.closest('.profile-avatar-option').dataset.style;
    img.src = avatarUrl(style, previewSeed, 40);
  });
}

function closeOnOutside(e) {
  var island = document.getElementById('user-island');
  if (popoverEl && !popoverEl.contains(e.target) && !island.contains(e.target)) {
    hidePopover();
  }
}

function closeOnEscape(e) {
  if (e.key === 'Escape' && popoverEl) {
    hidePopover();
  }
}

function hidePopover() {
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
  document.removeEventListener('click', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Init ---
export function initProfile(_ctx) {
  ctx = _ctx;

  var island = document.getElementById('user-island');
  if (!island) return;

  var profileArea = island.querySelector('.user-island-profile');
  if (profileArea) {
    profileArea.addEventListener('click', function(e) {
      e.stopPropagation();
      showPopover();
    });
  }

  var ctaEl = island.querySelector('.user-island-cta');
  if (ctaEl) {
    ctaEl.addEventListener('click', function(e) {
      e.stopPropagation();
      showPopover();
    });
  }

  fetchProfile().then(function(data) {
    if (data.name !== undefined) profile.name = data.name;
    if (data.lang) profile.lang = data.lang;
    if (data.avatarColor) profile.avatarColor = data.avatarColor;
    if (data.avatarStyle) profile.avatarStyle = data.avatarStyle;
    if (data.avatarSeed) profile.avatarSeed = data.avatarSeed;
    if (data.username) profileUsername = data.username;

    // Auto-generate seed if none exists
    if (!profile.avatarSeed) {
      profile.avatarSeed = Math.random().toString(36).substring(2, 10);
      saveProfile();
    }

    applyToIsland();

    if (profile.lang) {
      setSTTLang(profile.lang);
    }
  }).catch(function(err) {
    console.warn('[Profile] Failed to load:', err);
  });
}

export function getProfile() {
  return profile;
}

export function getProfileLang() {
  return profile.lang;
}

// --- Mate profile popover (reuses same UI minus language) ---
var matePopoverEl = null;
var mateSaveTimer = null;
var matePreviewSeed = '';

export function showMateProfilePopover(anchorEl, mateData, onUpdate) {
  if (matePopoverEl) {
    hideMatePopover();
    return;
  }

  var mp = mateData.profile || {};
  var mateName = mp.displayName || mateData.name || '';
  var mateColor = mp.avatarColor || '#7c3aed';
  var mateStyle = mp.avatarStyle || 'bottts';
  var mateSeed = mp.avatarSeed || mateData.id || 'mate';
  matePreviewSeed = mateSeed;

  matePopoverEl = document.createElement('div');
  matePopoverEl.className = 'profile-popover mate-profile-popover';

  var html = '';

  // Banner + close
  html += '<div class="profile-banner" style="background:' + mateColor + '">';
  html += '<button class="profile-close-btn">&times;</button>';
  html += '</div>';

  // Avatar row
  html += '<div class="profile-avatar-row">';
  html += '<div class="profile-popover-avatar">';
  html += '<img class="profile-popover-avatar-img" src="' + avatarUrl(mateStyle, mateSeed, 80) + '" alt="avatar">';
  html += '</div>';
  html += '<div class="profile-name-display">' + escapeAttr(mateName || 'New Mate') + '</div>';
  html += '</div>';

  // Body
  html += '<div class="profile-popover-body">';

  // Name
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Display Name</label>';
  html += '<input type="text" class="profile-field-input" id="mate-profile-name" value="' + escapeAttr(mateName) + '" placeholder="Name your mate..." maxlength="50" spellcheck="false" autocomplete="off">';
  html += '</div>';

  // Avatar picker
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Avatar <button class="profile-shuffle-btn" title="Shuffle">' + iconHtml('shuffle') + '</button></label>';
  html += '<div class="profile-avatar-grid">';
  for (var j = 0; j < AVATAR_STYLES.length; j++) {
    var st = AVATAR_STYLES[j];
    var activeS = (mateStyle === st.id) ? ' profile-avatar-option-active' : '';
    html += '<button class="profile-avatar-option' + activeS + '" data-style="' + st.id + '" title="' + st.name + '">';
    html += '<img src="' + avatarUrl(st.id, mateSeed, 40) + '" alt="' + st.name + '">';
    html += '</button>';
  }
  html += '</div>';
  html += '</div>';

  // Color
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Color</label>';
  html += '<div class="profile-color-grid">';
  for (var k = 0; k < COLORS.length; k++) {
    var c = COLORS[k];
    var activeC = (mateColor === c) ? ' profile-color-active' : '';
    html += '<button class="profile-color-swatch' + activeC + '" data-color="' + c + '" style="background:' + c + '"></button>';
  }
  html += '</div>';
  html += '</div>';

  html += '</div>'; // close body

  matePopoverEl.innerHTML = html;

  // State tracker
  var mateProfile = {
    displayName: mateName,
    avatarStyle: mateStyle,
    avatarSeed: mateSeed,
    avatarColor: mateColor,
  };

  function debouncedMateUpdate() {
    if (mateSaveTimer) clearTimeout(mateSaveTimer);
    mateSaveTimer = setTimeout(function() {
      if (onUpdate) onUpdate({
        name: mateProfile.displayName,
        profile: {
          displayName: mateProfile.displayName,
          avatarStyle: mateProfile.avatarStyle,
          avatarSeed: mateProfile.avatarSeed,
          avatarColor: mateProfile.avatarColor,
        },
      });
      mateSaveTimer = null;
    }, 400);
  }

  function updateMatePopoverHeader() {
    if (!matePopoverEl) return;
    var img = matePopoverEl.querySelector('.profile-popover-avatar-img');
    var nd = matePopoverEl.querySelector('.profile-name-display');
    if (img) img.src = avatarUrl(mateProfile.avatarStyle, mateProfile.avatarSeed, 80);
    if (nd) nd.textContent = mateProfile.displayName || 'New Mate';
  }

  // Events
  matePopoverEl.querySelector('.profile-close-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    hideMatePopover();
  });

  var nameInput = matePopoverEl.querySelector('#mate-profile-name');
  nameInput.addEventListener('input', function() {
    mateProfile.displayName = nameInput.value.trim();
    updateMatePopoverHeader();
    debouncedMateUpdate();
  });
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); hideMatePopover(); }
    e.stopPropagation();
  });
  nameInput.addEventListener('keyup', function(e) { e.stopPropagation(); });
  nameInput.addEventListener('keypress', function(e) { e.stopPropagation(); });

  // Avatar style
  matePopoverEl.querySelectorAll('.profile-avatar-option[data-style]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      mateProfile.avatarStyle = btn.dataset.style;
      mateProfile.avatarSeed = matePreviewSeed;
      updateMatePopoverHeader();
      matePopoverEl.querySelectorAll('.profile-avatar-option').forEach(function(b) {
        b.classList.remove('profile-avatar-option-active');
      });
      btn.classList.add('profile-avatar-option-active');
      debouncedMateUpdate();
    });
  });

  // Shuffle
  matePopoverEl.querySelector('.profile-shuffle-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    matePreviewSeed = Math.random().toString(36).substring(2, 10);
    if (!matePopoverEl) return;
    matePopoverEl.querySelectorAll('.profile-avatar-option[data-style] img').forEach(function(img) {
      var style = img.closest('.profile-avatar-option').dataset.style;
      img.src = avatarUrl(style, matePreviewSeed, 40);
    });
  });

  // Color swatches
  matePopoverEl.querySelectorAll('.profile-color-swatch').forEach(function(btn) {
    btn.addEventListener('click', function() {
      mateProfile.avatarColor = btn.dataset.color;
      var bannerEl = matePopoverEl.querySelector('.profile-banner');
      if (bannerEl) bannerEl.style.background = mateProfile.avatarColor;
      matePopoverEl.querySelectorAll('.profile-color-swatch').forEach(function(b) {
        b.classList.remove('profile-color-active');
      });
      btn.classList.add('profile-color-active');
      debouncedMateUpdate();
    });
  });

  matePopoverEl.addEventListener('click', function(e) { e.stopPropagation(); });

  // Position near anchor
  document.body.appendChild(matePopoverEl);
  refreshIcons();

  var rect = anchorEl.getBoundingClientRect();
  matePopoverEl.style.position = 'fixed';
  matePopoverEl.style.left = (rect.right + 8) + 'px';
  matePopoverEl.style.zIndex = '9999';
  // Align bottom of popover with bottom of anchor icon
  var popHeight = matePopoverEl.offsetHeight;
  var bottomAligned = rect.bottom - popHeight;
  matePopoverEl.style.top = Math.max(8, bottomAligned) + 'px';

  setTimeout(function() {
    document.addEventListener('click', closeMateOnOutside);
    document.addEventListener('keydown', closeMateOnEscape);
  }, 0);
}

function closeMateOnOutside(e) {
  if (matePopoverEl && !matePopoverEl.contains(e.target)) {
    hideMatePopover();
  }
}

function closeMateOnEscape(e) {
  if (e.key === 'Escape' && matePopoverEl) {
    hideMatePopover();
  }
}

function hideMatePopover() {
  if (matePopoverEl) {
    matePopoverEl.remove();
    matePopoverEl = null;
  }
  document.removeEventListener('click', closeMateOnOutside);
  document.removeEventListener('keydown', closeMateOnEscape);
}
