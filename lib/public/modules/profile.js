// User profile module — profile popovers for people and Mates
// Stores profile server-side in ~/.clay/profile.json
// Generated identities use deterministic local pixel identicons.

import { iconHtml, refreshIcons } from './icons.js';
import { avatarUrl, mateAvatarUrl, mateMarkUrl, userAvatarSeed } from './avatar.js';
import { store } from './store.js';
import { applyTerminalFont } from './terminal-prefs.js';

var ctx;
var profile = { name: '', lang: 'en-US', avatarStyle: 'imprint', avatarSeed: '', avatarColor: '#5857fc', avatarCustom: '' };
var profileUsername = '';
var popoverEl = null;
var saveTimer = null;

function getAvatarSeed() {
  return profile.avatarSeed || String(profileUsername || 'anonymous').substring(0, 30);
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

export function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function() {
    saveProfile();
    saveTimer = null;
  }, 400);
}

// --- DOM updates ---
export function applyToIsland() {
  var avatarWrap = document.querySelector('.user-island-avatar');
  var nameEl = document.querySelector('.user-island-name');
  if (!avatarWrap || !nameEl) {
    requestAnimationFrame(applyToIsland);
    return;
  }

  var displayName = profile.name || 'Awesome Clay User';

  // Replace letter fallback with avatar img
  var existingImg = avatarWrap.querySelector('img');
  var existingLetter = avatarWrap.querySelector('.user-island-avatar-letter');
  var url = profile.avatarCustom
    ? profile.avatarCustom
    : avatarUrl(profile.avatarStyle || 'imprint', getAvatarSeed(), 32);

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
  document.body.dataset.myAvatarUrl = url;
  document.body.dataset.myDisplayName = displayName;
  var messageAvatars = document.querySelectorAll('.dm-bubble-avatar-me, .icon-strip-me-avatar');
  for (var avatarIndex = 0; avatarIndex < messageAvatars.length; avatarIndex++) {
    messageAvatars[avatarIndex].src = url;
  }

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

// --- Avatar position picker ---
export function showAvatarPositioner(img, objectUrl, onDone) {
  var outputSize = 256;
  var viewSize = 220;

  // State
  var scale = 1;
  var offsetX = 0;
  var offsetY = 0;

  // Fit image so the shorter side fills the imprint frame.
  var baseScale = Math.max(viewSize / img.width, viewSize / img.height);

  function clampOffsets() {
    var sw = img.width * baseScale * scale;
    var sh = img.height * baseScale * scale;
    var maxX = Math.max(0, (sw - viewSize) / 2);
    var maxY = Math.max(0, (sh - viewSize) / 2);
    if (offsetX > maxX) offsetX = maxX;
    if (offsetX < -maxX) offsetX = -maxX;
    if (offsetY > maxY) offsetY = maxY;
    if (offsetY < -maxY) offsetY = -maxY;
  }

  function updatePreview() {
    var s = baseScale * scale;
    var tx = (viewSize - img.width * s) / 2 + offsetX;
    var ty = (viewSize - img.height * s) / 2 + offsetY;
    previewImg.style.width = (img.width * s) + 'px';
    previewImg.style.height = (img.height * s) + 'px';
    previewImg.style.transform = 'translate(' + tx + 'px, ' + ty + 'px)';
  }

  // Build overlay
  var overlay = document.createElement('div');
  overlay.className = 'avatar-positioner-overlay';

  var container = document.createElement('div');
  container.className = 'avatar-positioner-container';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'avatar-positioner-close';
  closeBtn.innerHTML = '&times;';
  container.appendChild(closeBtn);

  var title = document.createElement('div');
  title.className = 'avatar-positioner-title';
  title.textContent = 'Position your avatar';
  container.appendChild(title);

  var viewport = document.createElement('div');
  viewport.className = 'avatar-positioner-viewport';
  viewport.style.width = viewSize + 'px';
  viewport.style.height = viewSize + 'px';

  var previewImg = document.createElement('img');
  previewImg.src = objectUrl;
  previewImg.className = 'avatar-positioner-img';
  previewImg.draggable = false;
  viewport.appendChild(previewImg);
  container.appendChild(viewport);

  // Zoom slider
  var sliderWrap = document.createElement('div');
  sliderWrap.className = 'avatar-positioner-slider-wrap';
  var slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '1';
  slider.max = '6';
  slider.step = '0.05';
  slider.value = '1';
  slider.className = 'avatar-positioner-slider';
  sliderWrap.appendChild(slider);
  container.appendChild(sliderWrap);

  // Buttons
  var btnRow = document.createElement('div');
  btnRow.className = 'avatar-positioner-buttons';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'avatar-positioner-btn avatar-positioner-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  var doneBtn = document.createElement('button');
  doneBtn.className = 'avatar-positioner-btn avatar-positioner-btn-done';
  doneBtn.textContent = 'Done';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(doneBtn);
  container.appendChild(btnRow);

  overlay.appendChild(container);
  document.body.appendChild(overlay);
  updatePreview();

  // Drag
  var dragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var startOffsetX = 0;
  var startOffsetY = 0;

  viewport.addEventListener('mousedown', startDrag);
  viewport.addEventListener('touchstart', startDrag, { passive: false });

  function startDrag(e) {
    e.preventDefault();
    dragging = true;
    var pt = e.touches ? e.touches[0] : e;
    dragStartX = pt.clientX;
    dragStartY = pt.clientY;
    startOffsetX = offsetX;
    startOffsetY = offsetY;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  function onDrag(e) {
    if (!dragging) return;
    e.preventDefault();
    var pt = e.touches ? e.touches[0] : e;
    offsetX = startOffsetX + (pt.clientX - dragStartX);
    offsetY = startOffsetY + (pt.clientY - dragStartY);
    clampOffsets();
    updatePreview();
  }

  function endDrag() {
    dragging = false;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', endDrag);
  }

  // Zoom
  slider.addEventListener('input', function() {
    scale = parseFloat(slider.value);
    clampOffsets();
    updatePreview();
  });

  // Scroll to zoom
  viewport.addEventListener('wheel', function(e) {
    e.preventDefault();
    scale += e.deltaY < 0 ? 0.1 : -0.1;
    if (scale < 1) scale = 1;
    if (scale > 6) scale = 6;
    slider.value = scale;
    clampOffsets();
    updatePreview();
  }, { passive: false });

  function cleanup(revoke) {
    overlay.remove();
    if (revoke) URL.revokeObjectURL(objectUrl);
  }

  closeBtn.addEventListener('click', function() { cleanup(true); });
  cancelBtn.addEventListener('click', function() { cleanup(true); });

  doneBtn.addEventListener('click', function() {
    // Render cropped area to canvas
    var canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    var c = canvas.getContext('2d');
    var s = baseScale * scale;
    var tx = (viewSize - img.width * s) / 2 + offsetX;
    var ty = (viewSize - img.height * s) / 2 + offsetY;
    // Map from viewSize coords to outputSize
    var ratio = outputSize / viewSize;
    c.drawImage(img,
      0, 0, img.width, img.height,
      tx * ratio, ty * ratio, img.width * s * ratio, img.height * s * ratio
    );
    canvas.toBlob(function(blob) {
      cleanup(false);
      if (blob) onDone(blob);
    }, 'image/jpeg', 0.9);
  });
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
  var currentStyle = profile.avatarStyle || 'imprint';
  var seed = getAvatarSeed();

  var html = '';

  // Banner + close
  html += '<div class="profile-banner">';
  html += '<button class="profile-close-btn">&times;</button>';
  html += '</div>';

  // Avatar row (overlapping banner)
  html += '<div class="profile-avatar-row">';
  html += '<div class="profile-popover-avatar">';
  html += '<img class="profile-popover-avatar-img" src="' + (profile.avatarCustom || avatarUrl(currentStyle, seed, 80)) + '" alt="' + escapeAttr(displayName || 'Clay user') + '">';
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

  // Pixel identicon or custom photo
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Identity</label>';
  html += '<div class="profile-imprint-panel">';
  html += '<div class="profile-imprint-preview"><img src="' + avatarUrl(currentStyle, seed, 72) + '" alt="Generated pixel avatar"><span><strong>Pixel avatar</strong><small>Unique to this identity</small></span></div>';
  html += '<div class="profile-imprint-actions">';
  html += '<button class="profile-use-imprint' + (!profile.avatarCustom ? ' is-active' : '') + '" type="button">Use pixel avatar</button>';
  html += '<button class="profile-regenerate-imprint" type="button" title="Generate another pixel avatar">' + iconHtml('shuffle') + ' New avatar</button>';
  html += '<button class="profile-avatar-upload' + (profile.avatarCustom ? ' is-active' : '') + '" type="button">Upload photo</button>';
  html += '</div>';
  html += '</div>';
  html += '<input type="file" id="profile-avatar-file" accept="image/*" style="display:none">';
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

  // Avatar upload button
  var uploadBtn = popoverEl.querySelector('.profile-avatar-upload');
  var fileInput = popoverEl.querySelector('#profile-avatar-file');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', function() {
      fileInput.click();
    });
    fileInput.addEventListener('change', function() {
      var file = fileInput.files[0];
      if (!file) return;

      function uploadBlob(blob) {
        blob.arrayBuffer().then(function(ab) {
          var buf = new Uint8Array(ab);
          fetch('/api/avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buf,
          }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.ok) {
              profile.avatarCustom = data.avatar;
              applyToIsland();
              updatePopoverHeader();
              if (uploadBtn) {
                uploadBtn.classList.add('is-active');
              }
              var imprintButton = popoverEl && popoverEl.querySelector('.profile-use-imprint');
              if (imprintButton) imprintButton.classList.remove('is-active');
              debouncedSave();
            }
          });
        });
      }

      // Load image and open position picker
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function() {
        showAvatarPositioner(img, objectUrl, function(croppedBlob) {
          URL.revokeObjectURL(objectUrl);
          uploadBlob(croppedBlob);
        });
      };
      img.src = objectUrl;
    });
  }

  popoverEl.querySelector('.profile-use-imprint').addEventListener('click', function() {
    profile.avatarCustom = '';
    applyToIsland();
    updatePopoverHeader();
    popoverEl.querySelector('.profile-use-imprint').classList.add('is-active');
    popoverEl.querySelector('.profile-avatar-upload').classList.remove('is-active');
    debouncedSave();
  });

  popoverEl.querySelector('.profile-regenerate-imprint').addEventListener('click', function() {
    profile.avatarCustom = '';
    profile.avatarStyle = 'imprint';
    profile.avatarSeed = Math.random().toString(36).substring(2, 10);
    applyToIsland();
    updatePopoverHeader();
    refreshImprintPreview(popoverEl, profile.avatarStyle, profile.avatarSeed);
    popoverEl.querySelector('.profile-use-imprint').classList.add('is-active');
    popoverEl.querySelector('.profile-avatar-upload').classList.remove('is-active');
    debouncedSave();
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
  if (img) img.src = profile.avatarCustom
    ? profile.avatarCustom
    : avatarUrl(profile.avatarStyle || 'imprint', getAvatarSeed(), 80);
  if (nd) nd.textContent = profile.name || 'Awesome Clay User';
}


function refreshImprintPreview(root, style, seed) {
  if (!root) return;
  var img = root.querySelector('.profile-imprint-preview img');
  if (img) img.src = avatarUrl(style || 'imprint', seed || 'anonymous', 72);
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
    if (data.avatarCustom) profile.avatarCustom = data.avatarCustom;
    if (data.username) profileUsername = data.username;

    // Persist a stable account identity only when the server has not saved a seed.
    if (!profile.avatarSeed) {
      profile.avatarSeed = userAvatarSeed(data);
      saveProfile();
    }

    applyToIsland();


    // Hydrate terminal font prefs at boot. Previously this only happened
    // when the user opened the Settings modal (user-settings.js's
    // populateAccount), so a hard refresh would drop persisted picks back
    // to defaults until the modal was visited.
    if (data.terminalFont && typeof data.terminalFont === "object") {
      applyTerminalFont(data.terminalFont.family, data.terminalFont.size);
    }

    // Apply the project-only Mate DM shortcut preference at boot. Home and
    // the rest of the Mate capability surface remain available.
    var matesOn = data.matesEnabled === true;
    store.set({ projectMateDmsEnabled: matesOn });
    if (document.body) document.body.classList.toggle('project-mate-dms-disabled', !matesOn);
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

export function showMateProfilePopover(anchorEl, mateData, onUpdate) {
  if (matePopoverEl) {
    hideMatePopover();
    return;
  }

  var mp = mateData.profile || {};
  var mateName = mp.displayName || mateData.name || '';
  var mateColor = mp.avatarColor || '#5857fc';
  var mateStyle = mp.avatarStyle || 'imprint';
  var mateSeed = mp.avatarSeed || mateData.id || 'mate';
  var mateCustom = mp.avatarCustom || '';

  matePopoverEl = document.createElement('div');
  matePopoverEl.className = 'profile-popover mate-profile-popover';

  var html = '';

  // Banner + close
  html += '<div class="profile-banner">';
  html += '<button class="profile-close-btn">&times;</button>';
  html += '</div>';

  // Avatar row
  var mateAvatarSrc = mateCustom ? mateCustom : mateMarkUrl(mateName || 'Mate', 80);
  html += '<div class="profile-avatar-row">';
  html += '<div class="profile-popover-avatar">';
  html += '<img class="profile-popover-avatar-img" src="' + mateAvatarSrc + '" alt="' + escapeAttr(mateName || 'Clay Mate') + '">';
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

  // Avatar picker (hidden if avatar is locked)
  var mateAvatarLocked = mp.avatarLocked || false;
  if (!mateAvatarLocked) {
  html += '<div class="profile-field">';
  html += '<label class="profile-field-label">Identity</label>';
  html += '<div class="profile-imprint-panel">';
  html += '<div class="profile-imprint-preview"><img src="' + mateMarkUrl(mateName || 'Mate', 72) + '" alt="Clay Mate initial"><span><strong>Mate initial</strong><small>Based on display name</small></span></div>';
  html += '<div class="profile-imprint-actions profile-mate-mark-actions">';
  html += '<button class="profile-use-imprint' + (!mateCustom ? ' is-active' : '') + '" type="button">Use initial</button>';
  html += '<button class="profile-avatar-upload' + (mateCustom ? ' is-active' : '') + '" type="button">Upload image</button>';
  html += '</div>';
  html += '</div>';
  html += '<input type="file" id="mate-profile-avatar-file" accept="image/*" style="display:none">';
  html += '</div>';
  }

  html += '</div>'; // close body

  matePopoverEl.innerHTML = html;

  // State tracker
  var mateProfile = {
    displayName: mateName,
    avatarStyle: mateStyle,
    avatarSeed: mateSeed,
    avatarColor: mateColor,
    avatarCustom: mateCustom,
  };

  function refreshChatAvatars() {
    var newUrl = mateAvatarUrl({ profile: mateProfile, id: mateData.id }, 64);
    // Update all mate avatars in the chat area
    var bubbles = document.querySelectorAll('.dm-bubble-avatar-mate');
    for (var i = 0; i < bubbles.length; i++) {
      bubbles[i].src = newUrl;
    }
    // Update body dataset so new messages use the updated URL
    if (document.body.dataset.mateAvatarUrl) {
      document.body.dataset.mateAvatarUrl = newUrl;
    }
    // Update mate sidebar avatar
    var sidebarAvatar = document.querySelector('.mate-sidebar-avatar');
    if (sidebarAvatar) sidebarAvatar.src = newUrl;
  }

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
          avatarCustom: mateProfile.avatarCustom,
        },
      });
      refreshChatAvatars();
      mateSaveTimer = null;
    }, 400);
  }

  function updateMatePopoverHeader() {
    if (!matePopoverEl) return;
    var img = matePopoverEl.querySelector('.profile-popover-avatar-img');
    var nd = matePopoverEl.querySelector('.profile-name-display');
    if (img) img.src = mateProfile.avatarCustom
      ? mateProfile.avatarCustom
      : mateMarkUrl(mateProfile.displayName || 'Mate', 80);
    var preview = matePopoverEl.querySelector('.profile-imprint-preview img');
    if (preview) preview.src = mateMarkUrl(mateProfile.displayName || 'Mate', 72);
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

  // Avatar upload button
  var mateUploadBtn = matePopoverEl.querySelector('.profile-avatar-upload');
  var mateFileInput = matePopoverEl.querySelector('#mate-profile-avatar-file');
  if (mateUploadBtn && mateFileInput) {
    mateUploadBtn.addEventListener('click', function() {
      mateFileInput.click();
    });
    mateFileInput.addEventListener('change', function() {
      var file = mateFileInput.files[0];
      if (!file) return;

      function uploadMateBlob(blob) {
        blob.arrayBuffer().then(function(ab) {
          var buf = new Uint8Array(ab);
          fetch('/api/mate-avatar/' + encodeURIComponent(mateData.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buf,
          }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.ok) {
              mateProfile.avatarCustom = data.avatar;
              updateMatePopoverHeader();
              if (mateUploadBtn) {
                mateUploadBtn.classList.add('is-active');
              }
              var imprintButton = matePopoverEl && matePopoverEl.querySelector('.profile-use-imprint');
              if (imprintButton) imprintButton.classList.remove('is-active');
              debouncedMateUpdate();
            }
          });
        });
      }

      // Load image and open position picker
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function() {
        showAvatarPositioner(img, objectUrl, function(croppedBlob) {
          URL.revokeObjectURL(objectUrl);
          uploadMateBlob(croppedBlob);
        });
      };
      img.src = objectUrl;
    });
  }

  if (!mateAvatarLocked) {
    matePopoverEl.querySelector('.profile-use-imprint').addEventListener('click', function() {
      mateProfile.avatarCustom = '';
      updateMatePopoverHeader();
      matePopoverEl.querySelector('.profile-use-imprint').classList.add('is-active');
      matePopoverEl.querySelector('.profile-avatar-upload').classList.remove('is-active');
      debouncedMateUpdate();
    });
  }

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
