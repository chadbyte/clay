import { supported, getPasskey, passkeyError, request } from '/auth/passkey-browser.js';
var root = document.getElementById('login');
var password = root.dataset.password === 'true';
var selected = null;
var pin = !password;
var busy = false;
var stage = 'welcome';
var accounts = [];
var credentialBack = 'welcome';
function el(id) { return document.getElementById(id); }
function initials(name) {
  var words = (name || '?').trim().split(/\s+/);
  return (Array.from(words[0])[0] + (words.length > 1 ? Array.from(words[words.length - 1])[0] : '')).toUpperCase();
}
function show(next, moveFocus) {
  stage = next;
  root.dataset.stage = next;
  document.querySelectorAll('.view').forEach(function (view) { view.hidden = view.id !== next; });
  el('error').textContent = ''; el('status').textContent = ''; el('back').hidden = next === 'welcome';
  el('secret').value = ''; el('secret').type = 'password'; el('reveal').textContent = 'Show'; el('reveal').setAttribute('aria-pressed', 'false');
  var copy = {
    welcome: ['Sign in', 'Choose how to sign in.'],
    identity: ['Sign in', 'Enter your username to continue.'],
    credential: ['Sign in', pin ? 'Enter your account PIN to continue.' : 'Enter your password to continue.'],
    enroll: ['Set your password.', 'Your administrator has enabled passwords. Use 15–128 characters. Your account PIN is replaced only after saving.'],
    email: ['Sign in with email', 'We’ll send a sign-in code to your account’s email address.'],
    code: ['Check your inbox.', 'Enter the six-digit code we sent you.'],
  };
  el('heading').textContent = copy[next][0]; el('description').textContent = copy[next][1];
  if (next === 'credential') {
    el('selected-name').textContent = selected.name; el('selected-username').textContent = selected.username;
    el('selected-username').hidden = selected.name.toLowerCase() === selected.username.toLowerCase();
    el('selected-avatar').textContent = initials(selected.name); el('credential-username').value = selected.username;
    el('secret-label').textContent = pin ? 'Account PIN' : 'Password';
    el('secret').inputMode = pin ? 'numeric' : 'text'; el('secret').maxLength = pin ? 6 : 256;
    if (pin) el('secret').setAttribute('pattern', '[0-9]{6}'); else el('secret').removeAttribute('pattern');
    el('use-pin').hidden = !password; el('use-pin').textContent = pin ? 'Use my password' : 'I still use an account PIN';
  }
  var focus = { identity: 'username', credential: 'secret', enroll: 'new-password', email: 'email-address', code: 'otp' };
  if (moveFocus !== false) {
    if (focus[next]) el(focus[next]).focus({ preventScroll: true });
    else el('account').focus({ preventScroll: true });
  }
}
function renderAccounts() {
  el('accounts').replaceChildren();
  accounts.forEach(function (account) {
    var row = document.createElement('div'); row.className = 'account-row';
    var button = document.createElement('button'); button.className = 'account-choice';
    var avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(account.name);
    var copy = document.createElement('span'); copy.className = 'account-copy';
    var name = document.createElement('strong'); name.textContent = account.name;
    var username = document.createElement('small'); username.textContent = account.username;
    username.hidden = account.name.toLowerCase() === account.username.toLowerCase();
    copy.append(name, username); button.append(avatar, copy);
    button.onclick = function () { selected = account; credentialBack = 'welcome'; pin = !password; show('credential'); };
    var forget = document.createElement('button'); forget.className = 'forget'; forget.textContent = 'Forget';
    forget.setAttribute('aria-label', 'Forget ' + account.name + ' on this browser');
    forget.onclick = function () { run(async function () { var result = await request('/auth/accounts', { forget: account.id }); accounts = result.accounts; renderAccounts(); show('welcome'); }); };
    row.append(button, forget); el('accounts').append(row);
  });
  el('account').textContent = accounts.length ? 'Use another account' : 'Sign in with an account';
  el('account').classList.toggle('secondary', accounts.length > 0 || !el('passkey').hidden);
}
async function run(action) {
  if (busy) return;
  busy = true; el('error').textContent = ''; el('status').textContent = 'Just a moment…';
  document.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
  try { await action(); } catch (error) { el('error').textContent = passkeyError(error); }
  finally { busy = false; el('status').textContent = ''; document.querySelectorAll('button').forEach(function (button) { button.disabled = false; }); }
}
function enter() { location.assign('/'); }
el('server-address').textContent = location.host;
el('account').onclick = function () { show('identity'); };
el('back').onclick = function () { el('new-password').value = ''; el('confirm-password').value = ''; el('otp').value = ''; show(stage === 'code' ? 'email' : stage === 'credential' ? credentialBack : 'welcome'); };
el('identity').onsubmit = function (event) { event.preventDefault(); var username = el('username').value.trim(); if (!username) return; selected = { username: username, name: username }; credentialBack = 'identity'; pin = !password; show('credential'); };
el('use-pin').onclick = function () { pin = !pin; show('credential'); };
el('reveal').onclick = function () { var visible = el('secret').type === 'password'; el('secret').type = visible ? 'text' : 'password'; el('reveal').textContent = visible ? 'Hide' : 'Show'; el('reveal').setAttribute('aria-pressed', String(visible)); };
el('credential').onsubmit = function (event) {
  event.preventDefault(); run(async function () {
    var data = { username: selected.username }; data[pin ? 'pin' : 'password'] = el('secret').value;
    var result = await request('/auth/login', data); if (result.passwordRequired) show('enroll'); else enter();
  });
};
el('enroll').onsubmit = function (event) {
  event.preventDefault(); run(async function () {
    var value = el('new-password').value; var confirmation = el('confirm-password').value;
    if (value !== confirmation) throw new Error('Passwords do not match.');
    await request('/auth/password-transition', { password: value, confirmPassword: confirmation }); enter();
  });
};
async function sendCode() { await request('/auth/request-otp', { email: el('email-address').value.trim() }); el('otp').value = ''; show('code'); }
el('email-method').hidden = root.dataset.email !== 'true';
el('email-method').onclick = function () { show('email'); };
el('email').onsubmit = function (event) { event.preventDefault(); run(sendCode); };
el('resend').onclick = function () { run(sendCode); };
el('code').onsubmit = function (event) { event.preventDefault(); run(async function () { await request('/auth/verify-otp', { email: el('email-address').value.trim(), code: el('otp').value }); enter(); }); };
el('passkey').onclick = function () { run(async function () { var options = await request('/auth/passkeys/login/options', {}); var response = await getPasskey(options.options); await request('/auth/passkeys/login/verify', { response: response }); enter(); }); };
async function initialize() {
  try { var result = await request('/auth/accounts'); accounts = result.accounts; renderAccounts(); if (stage === 'welcome') show('welcome', false); } catch (error) { /* Account sign-in remains available without remembered names. */ }
  if (!password || !supported()) return;
  try { var status = await request('/auth/passkeys/status'); if (status.origin === location.origin) { el('passkey').hidden = false; renderAccounts(); } } catch (error) { /* Password sign-in remains available without passkeys. */ }
}
initialize();
