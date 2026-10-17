function client() {
  var list = document.getElementById('sessions'); var status = document.getElementById('status');
  var confirmation = document.getElementById('confirmation'); var target = null; var otherCount = 0;
  async function request(data) {
    var response = await fetch('/api/account-sessions', data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {});
    var result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not manage sessions.'); return result;
  }
  function describe(value) {
    if (!value) return 'Unknown device';
    var browser = /Edg\//.test(value) ? 'Edge' : /Firefox\//.test(value) ? 'Firefox' : /Chrome\//.test(value) ? 'Chrome' : /Safari\//.test(value) ? 'Safari' : 'Browser';
    var system = /Android/.test(value) ? 'Android' : /iPhone|iPad/.test(value) ? 'iOS' : /Windows/.test(value) ? 'Windows' : /Macintosh/.test(value) ? 'macOS' : /Linux/.test(value) ? 'Linux' : '';
    return value === 'Earlier session' ? value : browser + (system ? ' on ' + system : '');
  }
  function choose(id) { target = id; confirmation.hidden = false; document.getElementById('confirm').focus(); }
  function render(entries) {
    list.replaceChildren();
    entries.forEach(function (entry) {
      var row = document.createElement('li'); var detail = document.createElement('div'); var title = document.createElement('strong');
      title.textContent = describe(entry.userAgent) + (entry.current ? ' · This session' : ''); detail.appendChild(title);
      var info = document.createElement('small');
      info.textContent = entry.method + (entry.lastSeenAt ? ' · Last active ' + new Date(entry.lastSeenAt).toLocaleString() : ' · Previous activity unknown') + (entry.address ? ' · Last observed IP ' + entry.address : ''); detail.appendChild(info);
      var expiry = document.createElement('small');
      expiry.textContent = entry.expiresAt ? 'Expires ' + new Date(entry.expiresAt).toLocaleDateString() + (entry.migrated ? ' · Earlier session given a transition period' : '') : 'Compatibility session'; detail.appendChild(expiry);
      var button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Sign out';
      button.setAttribute('aria-label', 'Sign out ' + describe(entry.userAgent) + (entry.current ? ' current session' : ''));
      button.onclick = function () { choose(entry.id); }; row.append(detail, button); list.appendChild(row);
    });
    otherCount = entries.filter(function (entry) { return !entry.current; }).length;
    document.getElementById('others').disabled = otherCount === 0;
  }
  document.getElementById('others').onclick = function () { choose('others'); };
  document.getElementById('cancel').onclick = function () { target = null; confirmation.hidden = true; document.getElementById('others').focus(); };
  document.getElementById('confirm').onclick = async function () {
    document.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
    status.textContent = 'Signing out…';
    try {
      var result = await request({ id: target });
      if (result.signedOut) { location.href = '/'; return; }
      confirmation.hidden = true; target = null; render(result.sessions); status.textContent = 'Selected sessions signed out.';
    } catch (error) { status.textContent = error.message; }
    finally { document.querySelectorAll('button').forEach(function (button) { button.disabled = false; }); document.getElementById('others').disabled = otherCount === 0; }
  };
  request().then(function (data) { render(data.sessions); }).catch(function (error) { status.textContent = error.message; });
}
function render() {
  return require('./account-password-page').shell('Signed-in devices', '<h1>Signed-in devices</h1><p>Account sessions expire after 30 days, or after 7 days without use. Each entry is a browser session, not a verified physical device.</p>' +
    '<ul id="sessions" aria-label="Signed-in sessions"></ul><button id="others" class="secondary" disabled>Sign out other sessions</button>' +
    '<div id="confirmation" role="group" aria-label="Confirm sign-out" hidden><p>Sign out the selected sessions? Their open connections will close.</p><div class="actions"><button id="confirm">Sign out</button><button id="cancel" class="secondary">Cancel</button></div></div>' +
    '<p id="status" role="status"></p><a href="/">Back to Clay</a><script>(' + client.toString() + ')();</script>');
}
module.exports = { render: render };
