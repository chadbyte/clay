function client(api) {
  var list = document.getElementById('passkeys');
  var form = document.getElementById('passkey-form');
  var name = document.getElementById('passkey-name');
  var password = document.getElementById('current-password');
  var button = document.getElementById('save');
  var cancel = document.getElementById('cancel');
  var status = document.getElementById('status');
  var selected = null;
  var action = 'register';
  var canRegister = api.supported();
  function reset() {
    selected = null; action = 'register'; name.value = ''; password.value = '';
    document.getElementById('editor-heading').textContent = 'Add a passkey';
    document.getElementById('name-row').hidden = false;
    name.required = true; button.textContent = 'Add passkey'; cancel.hidden = true;
    document.getElementById('editor-hint').textContent = 'Verify your current password to add a passkey.';
    form.hidden = !canRegister;
  }
  function edit(key, mode) {
    form.hidden = false;
    selected = key.id; action = mode; password.value = ''; name.value = key.name;
    document.getElementById('editor-heading').textContent = (mode === 'remove' ? 'Remove ' : 'Rename ') + key.name;
    document.getElementById('name-row').hidden = mode === 'remove'; name.required = mode !== 'remove';
    button.textContent = mode === 'remove' ? 'Remove passkey' : 'Save name'; cancel.hidden = false;
    document.getElementById('editor-hint').textContent = mode === 'remove' ? 'Sessions signed in with this passkey will end. Your password will still work.' : 'Verify your current password to rename this passkey.';
    (mode === 'remove' ? password : name).focus();
  }
  function render(keys) {
    list.replaceChildren();
    if (!keys.length) { var empty = document.createElement('p'); empty.textContent = 'No passkeys registered yet.'; list.appendChild(empty); }
    keys.forEach(function (key) {
      var row = document.createElement('li'); var detail = document.createElement('div');
      var title = document.createElement('strong'); title.textContent = key.name;
      var last = document.createElement('small'); last.textContent = key.lastUsedAt ? 'Last used ' + new Date(key.lastUsedAt).toLocaleDateString() : 'Not used to sign in yet';
      detail.append(title, last); row.appendChild(detail);
      ['rename', 'remove'].forEach(function (mode) {
        var control = document.createElement('button'); control.type = 'button'; control.className = 'secondary';
        control.textContent = mode === 'rename' ? 'Rename' : 'Remove';
        control.setAttribute('aria-label', control.textContent + ' ' + key.name);
        control.onclick = function () { edit(key, mode); }; row.appendChild(control);
      });
      list.appendChild(row);
    });
  }
  function busy(value) {
    document.querySelectorAll('button, input').forEach(function (element) { element.disabled = value; });
  }
  cancel.onclick = function () { reset(); name.focus(); };
  form.onsubmit = async function (event) {
    event.preventDefault(); busy(true); status.textContent = 'Verifying…';
    try {
      var result;
      if (action === 'register') {
        result = await api.request('/api/passkeys/register/options', { name: name.value, currentPassword: password.value });
        password.value = '';
        status.textContent = 'Follow your device’s instructions to create a passkey.';
        var response = await api.createPasskey(result.options);
        result = await api.request('/api/passkeys/register/verify', { response: response });
      } else result = await api.request('/api/passkeys/' + action, { id: selected, name: name.value, currentPassword: password.value });
      render(result.passkeys); reset(); status.textContent = 'Passkeys updated.';
    } catch (error) { status.textContent = api.passkeyError(error); }
    finally { password.value = ''; busy(false); }
  };
  busy(true);
  api.request('/api/passkeys').then(function (data) {
    render(data.passkeys);
    if (data.origin !== location.origin) {
      status.textContent = 'Open ' + data.origin + ' to manage your passkeys.';
      busy(true); form.hidden = true; return;
    }
    busy(false);
    if (!canRegister) {
      status.textContent = 'This browser cannot create passkeys. You can still rename or remove registered passkeys, or sign in with your password.';
      form.hidden = true;
    }
  }).catch(function (error) { status.textContent = error.message; });
}
function render() {
  return require('./account-password-page').shell('Passkeys',
    '<h1>Passkeys</h1><p>Sign in using your device’s fingerprint, face recognition or screen lock. Your password remains available.</p>' +
    '<ul id="passkeys" aria-label="Registered passkeys"></ul><form id="passkey-form"><h2 id="editor-heading">Add a passkey</h2>' +
    '<p id="editor-hint">Verify your current password to add a passkey.</p><div id="name-row"><label for="passkey-name">Passkey name</label><input id="passkey-name" maxlength="80" placeholder="For example, personal laptop" required></div>' +
    '<label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required>' +
    '<div class="actions"><button id="save" type="submit">Add passkey</button><button id="cancel" type="button" class="secondary" hidden>Cancel</button></div></form>' +
    '<p id="status" role="status" aria-live="polite"></p><a href="/">Back to Clay</a>' +
    '<script type="module">import * as api from "/auth/passkey-browser.js";(' + client.toString() + ')(api);</script>');
}
module.exports = { render: render };
