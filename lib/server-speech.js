var WebSocketServer = require('ws').WebSocketServer;
var catalog = require('./speech-catalog');
var attachSpeechStore = require('./speech-store').attachSpeechStore;
var transcribe = require('./speech-transcribe').transcribe;
var openSpeechStream = require('./speech-stream').openSpeechStream;
var MAX_AUDIO = 10 * 1024 * 1024;

function attachSpeech(ctx) {
  var storage = attachSpeechStore(ctx.CONFIG_DIR);
  var sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  var busy = new Map();
  var destroyed = false;
  function owner(req) {
    if (!ctx.isRequestAuthed(req)) return null;
    if (!ctx.users.isMultiUser()) return 'default';
    var user = ctx.getMultiUserFromReq(req);
    return user && user.id;
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch (error) { return false; }
  }
  function json(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
  }
  function collect(req, limit, signal) {
    return new Promise(function (resolve, reject) {
      var chunks = []; var size = 0;
      function abort() { chunks = []; reject(new Error('Request cancelled')); }
      if (signal) {
        if (signal.aborted) { abort(); return; }
        signal.addEventListener('abort', abort, { once: true });
        req.once('end', function () { signal.removeEventListener('abort', abort); });
      }
      req.on('data', function (chunk) { size += chunk.length; if (size <= limit) chunks.push(chunk); else { chunks = []; reject(new Error('Request is too large')); } });
      req.on('end', function () { if (size <= limit) resolve(Buffer.concat(chunks)); });
      req.on('error', reject); req.on('aborted', function () { reject(new Error('Request cancelled')); });
    });
  }
  function language(value) {
    if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(value)) throw new Error('Choose a valid speech language');
    return value;
  }
  function selection(id, mode, userId) {
    var model = catalog.findModel(id);
    if (!model || model.mode !== mode || model.provider === 'browser') throw new Error('Invalid transcription model');
    var key = storage.key(userId, model.provider);
    if (!key) throw new Error('Connect this provider in Voice input settings first');
    return { model: model, key: key };
  }
  function handleRequest(req, res, fullUrl) {
    if (fullUrl !== '/api/speech/settings' && fullUrl !== '/api/speech/transcribe') return false;
    var userId = owner(req);
    if (!userId) { json(res, 401, { error: 'Sign in to use voice input' }); return true; }
    if (!sameOrigin(req)) { json(res, 403, { error: 'Invalid request origin' }); return true; }
    if (fullUrl === '/api/speech/settings') {
      if (req.method === 'GET') {
        try { json(res, 200, storage.view(userId)); } catch (error) { json(res, 500, { error: 'Voice settings could not be loaded' }); }
      } else if (req.method === 'PUT') {
        collect(req, 8192).then(function (bytes) {
          if (owner(req) !== userId) { json(res, 401, { error: 'Please sign in again' }); return; }
          var data = JSON.parse(bytes.toString());
          if (!data || typeof data !== 'object') throw new Error('Invalid settings');
          var value = storage.update(userId, data);
          if (busy.has(userId)) busy.get(userId)();
          json(res, 200, value);
        }).catch(function () { json(res, 400, { error: 'Could not save voice settings. Check the model and API key.' }); });
      } else json(res, 405, { error: 'Method not allowed' });
      return true;
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return true; }
    if (busy.has(userId)) { json(res, 409, { error: 'Another voice request is already active' }); return true; }
    var controller = new AbortController();
    function cancel() { controller.abort(); }
    busy.set(userId, cancel);
    var timer = setTimeout(cancel, 120000);
    res.on('close', cancel);
    (async function () {
      try {
        var selected = selection(req.headers['x-speech-model'], 'recorded', userId);
        var lang = language(req.headers['x-speech-language']);
        var bytes = await collect(req, MAX_AUDIO, controller.signal);
        if (owner(req) !== userId) throw new Error('Please sign in again');
        if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid voice recording');
        var text = await transcribe(selected.model, selected.key, bytes, lang, controller.signal);
        if (typeof text !== 'string') throw new Error('No transcript returned');
        json(res, 200, { text: text });
      } catch (error) {
        json(res, error.status || 400, { error: controller.signal.aborted ? 'Transcription cancelled or timed out. Please try again.' :
          (error.status ? error.message : 'Could not transcribe this recording. Check your model, key and connection.') });
      } finally { clearTimeout(timer); res.removeListener('close', cancel); if (busy.get(userId) === cancel) busy.delete(userId); }
    })();
    return true;
  }
  function handleUpgrade(req, socket, head) {
    if (req.url.split('?')[0] !== '/api/speech/live') return false;
    var userId = owner(req);
    if (!userId || !sameOrigin(req) || busy.has(userId)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return true;
    }
    sockets.handleUpgrade(req, socket, head, function (ws) {
      var upstream; var ready = false; var finishing = false; var total = 0; var ended = false;
      function send(message) { if (ws.readyState === 1) ws.send(JSON.stringify(message)); }
      function diagnostic(stage, values) { send(Object.assign({ type: 'diagnostic', stage: stage }, values || {})); }
      diagnostic('clay-websocket-accepted');
      function close() {
        if (ended) return; ended = true;
        clearTimeout(timer); clearInterval(authTimer);
        if (upstream) upstream.abort();
        if (busy.get(userId) === cancel) busy.delete(userId);
        ws.close();
      }
      function cancel() { send({ type: 'error', error: 'Voice input cancelled. Your draft has been preserved.' }); close(); }
      function fail(error) { diagnostic('clay-session-failed'); send({ type: 'error', error: error.message }); close(); }
      busy.set(userId, cancel);
      var timer = setTimeout(function () { fail(new Error('Voice input timed out')); }, 15000);
      var authTimer = setInterval(function () { if (owner(req) !== userId) cancel(); }, 5000);
      ws.on('message', function (raw, binary) {
        if (ended) return;
        try {
          if (binary) {
            if (!ready || finishing) throw new Error('Microphone session is not ready');
            total += raw.length;
            if (total === raw.length) diagnostic('clay-first-audio', { bytes: raw.length });
            if (total > MAX_AUDIO || raw.length % 2) throw new Error('Recording limit reached');
            upstream.audio(raw); return;
          }
          var message = JSON.parse(raw.toString());
          if (message.type === 'start' && !upstream) {
            diagnostic('clay-selecting-provider');
            var selected = selection(message.model, 'live', userId);
            var lang = language(message.language);
            diagnostic('clay-provider-connecting');
            upstream = openSpeechStream(selected.model, selected.key, lang, {
              diagnostic: diagnostic,
              ready: function () {
                diagnostic('provider-ready');
                ready = true; clearTimeout(timer);
                timer = setTimeout(function () { fail(new Error('Recording limit reached. Stop within five minutes.')); }, 310000);
                send({ type: 'ready' });
              },
              text: function (text) { send({ type: 'text', text: text }); },
              done: function (text) { send({ type: 'done', text: text }); close(); },
              error: fail
            });
          } else if (message.type === 'finish' && ready && !finishing) { finishing = true; upstream.finish(); }
          else if (message.type === 'cancel') close();
          else throw new Error('Invalid voice message');
        } catch (error) { fail(new Error('Could not start or continue voice input. Check your key and connection.')); }
      });
      ws.on('close', close); ws.on('error', close);
    });
    return true;
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    busy.forEach(function (cancel) { cancel(); });
    sockets.clients.forEach(function (socket) { socket.terminate(); });
    sockets.close();
  }
  return { handleRequest: handleRequest, handleUpgrade: handleUpgrade, destroy: destroy };
}
module.exports = { attachSpeech: attachSpeech };
