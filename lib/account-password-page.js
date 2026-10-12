function client(changing) {
  var form = document.getElementById('account-form');
  var username = document.getElementById('username');
  var secret = document.getElementById('secret');
  var confirm = document.getElementById('confirm-password');
  var mode = document.getElementById('use-pin');
  var button = document.getElementById('submit');
  var error = document.getElementById('error');
  var enrolling = false;
  if (changing) {
    enrolling = true;
    document.getElementById('heading').textContent = 'Change your password';
    document.getElementById('description').textContent = 'Use 15–128 characters. Saving signs out your other sessions.';
    document.getElementById('username-row').hidden = true; username.required = false;
    document.getElementById('mode-row').hidden = true;
    document.getElementById('current-row').hidden = false;
    document.getElementById('confirm-row').hidden = false;
    document.getElementById('secret-label').textContent = 'New password or passphrase';
    secret.autocomplete = 'new-password'; button.textContent = 'Save password';
  }
  function update() {
    document.getElementById('secret-label').textContent = mode.checked ? 'Current account PIN' : 'Password';
    secret.autocomplete = mode.checked ? 'off' : 'current-password';
    secret.value = ''; error.textContent = '';
    button.textContent = mode.checked ? 'Verify PIN' : 'Sign in';
  }
  mode.onchange = update;
  form.onsubmit = async function (event) {
    event.preventDefault(); button.disabled = true; error.textContent = '';
    try {
      var body = enrolling ? { password: secret.value, confirmPassword: confirm.value } : { username: username.value };
      if (!enrolling) body[mode.checked ? 'pin' : 'password'] = secret.value;
      if (changing) body.currentPassword = document.getElementById('current-password').value;
      var response = await fetch(changing ? '/auth/password-change' : enrolling ? '/auth/password-transition' : '/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not sign in.');
      secret.value = '';
      if (!data.passwordRequired) { location.href = '/'; return; }
      enrolling = true;
      document.getElementById('passkey-login').hidden = true;
      document.getElementById('heading').textContent = 'Set your password';
      document.getElementById('description').textContent = 'Use 15–128 characters. A long passphrase works well. Your account PIN is replaced only after saving.';
      username.readOnly = true;
      document.getElementById('mode-row').hidden = true;
      document.getElementById('secret-label').textContent = 'New password or passphrase';
      secret.autocomplete = 'new-password';
      document.getElementById('confirm-row').hidden = false;
      button.textContent = 'Save password and continue'; secret.focus();
    } catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; }
  };
}
function shell(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' — Clay</title>' +
    '<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:light-dark(#f2f2ef,#171717);color:light-dark(#171717,#eee);font:14px system-ui}main{width:min(100%,400px);padding:24px}h1{font-size:20px;margin:0 0 8px}p{font-size:13px;line-height:1.5;opacity:.75}label{display:block;font-size:13px;margin:16px 0 6px}input:not([type=checkbox]){width:100%;height:36px;border:1px solid #8886;border-radius:8px;padding:0 10px;background:light-dark(#fff,#242424);color:inherit;font:inherit}button{min-height:36px;width:100%;border:0;border-radius:8px;background:#5857fc;color:white;font:inherit;padding:8px 12px;margin-top:20px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}:focus-visible{outline:2px solid #5857fc;outline-offset:3px}#error{color:light-dark(#a12c2c,#ff9292);min-height:20px;opacity:1}a{color:inherit}h2{font-size:16px;margin:24px 0 8px}ul{list-style:none;padding:0}li{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid #8884}li div{flex:1;min-width:0;overflow-wrap:anywhere}small{display:block;opacity:.7;margin-top:4px}.secondary{background:transparent;color:inherit;border:1px solid #8886}li button{width:auto;margin:0;font-size:12px;min-height:32px;padding:4px 8px}.actions{display:flex;gap:8px}#status{overflow-wrap:anywhere}[hidden]{display:none!important}</style></head><body><main>' +
    body + '</main></body></html>';
}
function render(changing) {
  return shell('Account sign-in',
    '<h1 id="heading">Account sign-in</h1><p id="description">This server uses account passwords. Still using an account PIN? Verify it once to set your password.</p>' +
    '<form id="account-form"><div id="username-row"><label for="username">Username</label><input id="username" autocomplete="username" maxlength="100" required autofocus></div>' +
    '<div id="current-row" hidden><label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" maxlength="256"></div>' +
    '<label id="mode-row"><input id="use-pin" type="checkbox"> I still use an account PIN</label>' +
    '<label id="secret-label" for="secret">Password</label><input id="secret" type="password" autocomplete="current-password" required maxlength="256">' +
    '<div id="confirm-row" hidden><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" maxlength="256"></div>' +
    '<p id="error" role="alert"></p><button id="submit" type="submit">Sign in</button></form><button id="passkey-login" type="button" class="secondary" hidden>Sign in with a passkey</button><p>Forgot your credentials? Contact your server administrator for account recovery.</p><a href="/">Start again</a>' +
    '<script>(' + client.toString() + ')(' + (changing ? 'true' : 'false') + ');</script><script type="module">import {initPasskeyLogin} from "/auth/passkey-browser.js";initPasskeyLogin();</script>');
}
module.exports = { render: render, shell: shell };
