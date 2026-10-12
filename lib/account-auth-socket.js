function guardSocket(ws, req, isAuthed, touchSession) {
  req.claySessionPassive = true;
  var send = ws.send;
  var emit = ws.emit;
  var closed = false;
  function check() {
    if (closed) return false;
    if (isAuthed(req)) return true;
    closed = true;
    if (ws.readyState === 1) send.call(ws, JSON.stringify({ type: 'account_auth_required' }));
    ws.close(4001, 'Account sign-in required');
    return false;
  }
  ws.send = function () { if (check()) return send.apply(ws, arguments); };
  ws.emit = function (name) {
    if (name === 'message') {
      if (!check()) return false;
      var message;
      try { message = JSON.parse(String(arguments[1])); } catch (error) { message = null; }
      if (touchSession && message && ['ping', 'pong', 'heartbeat'].indexOf(message.type) === -1) touchSession(req);
    }
    return emit.apply(ws, arguments);
  };
  var timer = setInterval(check, 1000);
  if (timer.unref) timer.unref();
  ws.on('close', function () { closed = true; clearInterval(timer); });
  return check();
}
module.exports = { guardSocket: guardSocket };
