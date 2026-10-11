import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { parseEnvString, looksLikeEnv, serializeEnvValue } from './settings-env-values.js';
import { setSettingsDraft } from './server-settings-state.js';
// ===== Shared Environment Variables =====



function showSharedEnvSaveStatus(text) {
  var el = document.getElementById('ss-env-save-status');
  if (el) el.textContent = text;
}

export function loadSharedEnv() {
  if (store.get("serverEnvLoaded") || store.get("serverEnvBusy")) return;
  showSharedEnvSaveStatus("Loading…");

  var ws = getWs();
  if (ws && ws.readyState === 1) {
    store.set({ serverEnvBusy: true });
    ws.send(JSON.stringify({ type: "get_shared_env" }));
    setTimeout(function () {
      if (!store.get('serverEnvLoaded') && store.get('serverEnvBusy')) {
        store.set({ serverEnvBusy: false });
        showSharedEnvSaveStatus('No response received. Reopen Environment to retry.');
      }
    }, 12000);
  } else showSharedEnvSaveStatus("Disconnected. Reopen this page after reconnecting.");
}

export function handleSharedEnv(msg) {
  store.set({ serverEnvBusy: false });
  if (store.get('serverEnvLoaded')) return;
  if (msg.error) { showSharedEnvSaveStatus(msg.error); return; }
  var list = document.getElementById("ss-env-list");
  if (!list) return;
  list.innerHTML = "";

  var pairs = parseEnvString(msg.envrc || "");
  for (var i = 0; i < pairs.length; i++) {
    addSharedEnvRow(pairs[i].key, pairs[i].value, false);
  }
  store.set({ serverEnvLoaded: true, serverEnvSaved: buildSharedEnvString() });
  document.getElementById('ss-env-add-btn').disabled = false;
  showSharedEnvSaveStatus('Changes apply to new coding-agent processes after saving.');
  refreshIcons();
}

export function handleSharedEnvSaved(msg) {
  store.set({ serverEnvBusy: false });
  document.getElementById('ss-env-save').disabled = false;
  if (msg.ok) {
    store.set({ serverEnvSaved: store.get('serverEnvSubmitted') });
    markEnvironmentDraft();
    showSharedEnvSaveStatus(buildSharedEnvString() !== store.get('serverEnvSaved') ? 'Submitted values saved. Newer edits remain unsaved.' : (msg.timing || 'Saved.'));
  } else {
    showSharedEnvSaveStatus("Error: " + (msg.error || "Failed to save"), 5000);
  }
}

function buildSharedEnvString() {
  var list = document.getElementById("ss-env-list");
  if (!list) return "";
  var rows = list.querySelectorAll(".ps-env-row");
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var keyInput = rows[i].querySelector(".ps-env-key");
    var valInput = rows[i].querySelector(".ps-env-val");
    var key = keyInput ? keyInput.value.trim() : "";
    var val = valInput ? valInput.value : "";
    if (key) lines.push("export " + key + "=" + serializeEnvValue(val));
  }
  return lines.join("\n");
}

function addSharedEnvRow(key, value, focus) {
  var list = document.getElementById("ss-env-list");
  if (!list) return;

  var row = document.createElement("div");
  row.className = "ps-env-row";

  var keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "ps-env-key";
  keyInput.placeholder = "KEY";
  keyInput.value = key;
  keyInput.spellcheck = false;
  keyInput.autocomplete = "off";

  var valInput = document.createElement("input");
  valInput.type = "password";
  valInput.className = "ps-env-val";
  valInput.placeholder = "value";
  valInput.value = value;
  valInput.spellcheck = false;
  valInput.autocomplete = "off";
  keyInput.setAttribute('aria-label', 'Variable name');
  valInput.setAttribute('aria-label', 'Variable value');
  var reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'settings-btn-sm'; reveal.textContent = 'Show';
  reveal.setAttribute('aria-label', 'Show variable value'); reveal.setAttribute('aria-pressed', 'false');
  reveal.onclick = function () { var visible = valInput.type === 'password'; valInput.type = visible ? 'text' : 'password'; reveal.textContent = visible ? 'Hide' : 'Show'; reveal.setAttribute('aria-pressed', String(visible)); };


  var delBtn = document.createElement("button");
  delBtn.className = "ps-env-del";
  delBtn.title = "Remove variable";
  delBtn.setAttribute("aria-label", "Remove variable");
  delBtn.innerHTML = '<i data-lucide="x"></i>';

  delBtn.addEventListener("click", function () {
    row.remove();
    markEnvironmentDraft();
  });

  keyInput.addEventListener("input", function () { markEnvironmentDraft(); });
  valInput.addEventListener("input", function () { markEnvironmentDraft(); });

  // Paste detection
  keyInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && looksLikeEnv(text)) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        markEnvironmentDraft();
      }
    }
  });

  valInput.addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (text && text.indexOf("\n") !== -1 && text.indexOf("=") !== -1) {
      e.preventDefault();
      var pairs = parseEnvString(text);
      if (pairs.length > 0) {
        keyInput.value = pairs[0].key;
        valInput.value = pairs[0].value;
        for (var p = 1; p < pairs.length; p++) {
          addSharedEnvRow(pairs[p].key, pairs[p].value, false);
        }
        markEnvironmentDraft();
      }
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(reveal);
  row.appendChild(delBtn);
  list.appendChild(row);
  refreshIcons();

  if (focus) keyInput.focus();
}

function markEnvironmentDraft() {
  var draft = buildSharedEnvString();
  store.set({ serverEnvDraft: draft });
  var dirty = draft !== store.get('serverEnvSaved') || Array.from(document.querySelectorAll('#ss-env-list .ps-env-key')).some(function (input) { return !input.value.trim(); });
  setSettingsDraft('environment', dirty);
  document.getElementById('ss-env-save').disabled = !dirty || store.get('serverEnvBusy');
  showSharedEnvSaveStatus(dirty ? 'Unsaved changes' : 'No unsaved changes');
}

export function initServerEnvironment() {
  document.getElementById('ss-env-add-btn').disabled = true;
  document.getElementById('ss-env-add-btn').onclick = function () { addSharedEnvRow('', '', true); markEnvironmentDraft(); };
  document.getElementById('ss-env-save').onclick = function () {
    var ws = getWs();
    if (!ws || ws.readyState !== 1) { showSharedEnvSaveStatus('Disconnected. Your draft is retained.'); return; }
    var invalid = Array.from(document.querySelectorAll('#ss-env-list .ps-env-key')).some(function (input) {
      return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.value.trim());
    });
    if (invalid) { showSharedEnvSaveStatus('Each variable needs a valid name using letters, digits and underscores, starting with a letter or underscore.'); return; }
    var draft = buildSharedEnvString();
    store.set({ serverEnvBusy: true, serverEnvSubmitted: draft });
    this.disabled = true;
    ws.send(JSON.stringify({ type: 'set_shared_env', envrc: draft }));
    showSharedEnvSaveStatus('Saving…');
    setTimeout(function () {
      if (!store.get('serverEnvBusy')) return;
      store.set({ serverEnvBusy: false });
      document.getElementById('ss-env-save').disabled = false;
      showSharedEnvSaveStatus('No acknowledgement received. Your draft is retained; reconnect and retry.');
    }, 12000);
  };
}
