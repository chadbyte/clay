// Shared recognition lifecycle. Recognition callbacks belong to one immutable draft context.
import { store } from './store.js';

export function speechConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechContext() {
  var s = store.snap();
  return JSON.stringify([s.currentSlug, s.activeSessionId, s.dmMode, s.dmKey,
    s.dmTargetUser && s.dmTargetUser.id, s.homePrimarySurface, s.homeSubSurface,
    s.homeChatMateId, s.homeChatSessionId]);
}

export function setSpeechStatus(id, message) {
  var statuses = Object.assign({}, store.get('speechStatuses'));
  statuses[id] = message;
  store.set({ speechStatuses: statuses });
}

export function usableSpeechInput(input) {
  if (!(input && input.isConnected && !input.disabled && !input.readOnly &&
      !input.closest('[hidden], .hidden, [aria-hidden="true"]') && input.getClientRects().length &&
      !document.hidden)) return false;
  try {
    var frame = window.frameElement;
    while (frame) {
      if (!frame.isConnected || !frame.getClientRects().length ||
          frame.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;
      frame = frame.ownerDocument.defaultView.frameElement;
    }
  } catch (error) { return false; }
  return true;
}

export function stopSTT(message) {
  var active = store.get('speechActive');
  if (!active) return;
  // Invalidate before abort: late results and end events must never revive an old draft.
  store.set({ speechActive: null });
  clearTimeout(active.timeout);
  try { active.recognition.abort(); } catch (error) { /* Already ended. */ }
  setSpeechStatus(active.id, typeof message === 'string' ? message : 'Voice input stopped.');
}

function current(active) {
  if (store.get('speechActive') !== active) return false;
  if (active.context !== speechContext() || !usableSpeechInput(active.input) ||
      active.input.value !== active.lastValue) {
    stopSTT();
    return false;
  }
  return true;
}

export function startSTT(id, input) {
  if (!usableSpeechInput(input)) return;
  var Constructor = speechConstructor();
  if (!window.isSecureContext || !Constructor) {
    setSpeechStatus(id, !window.isSecureContext ? 'Voice input requires a secure HTTPS connection.' :
      'Voice input is unavailable in this browser. You can still type your message.');
    return;
  }
  // Same-origin split panes share the top document as a synchronous ownership signal.
  // This event only stops recognition; it can never start a microphone.
  try { window.top.document.dispatchEvent(new window.top.Event('clay:voice-claim')); }
  catch (error) { stopSTT(); }
  stopSTT();
  var recognition;
  try { recognition = new Constructor(); }
  catch (error) { setSpeechStatus(id, 'Voice input could not start. You can still type your message.'); return; }
  var active = { id: id, input: input, recognition: recognition, context: speechContext(),
    before: input.value, lastValue: input.value, writing: false, started: false, timeout: null };
  recognition.lang = store.get('speechLang') || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = function () {
    if (!current(active)) return;
    clearTimeout(active.timeout);
    active.started = true;
    store.set({ speechActive: active });
    setSpeechStatus(id, 'Listening. Select the microphone to stop.');
  };
  recognition.onresult = function (event) {
    if (!current(active)) return;
    var parts = [];
    for (var i = 0; i < event.results.length; i++) parts.push(event.results[i][0].transcript);
    var transcript = parts.join('');
    var separator = active.before && transcript && !/\s$/.test(active.before) ? ' ' : '';
    active.lastValue = active.before + separator + transcript;
    input.value = active.lastValue;
    active.writing = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { active.writing = false; }
  };
  recognition.onerror = function (event) {
    if (store.get('speechActive') !== active) return;
    var messages = {
      'not-allowed': 'Microphone access was denied. Allow microphone access in your browser settings to try again.',
      'service-not-allowed': 'Speech recognition is not allowed by this browser or device.',
      'audio-capture': 'No microphone is available. Check your microphone connection and permissions.',
      'no-speech': 'No speech detected. Select the microphone to try again.',
      'network': 'The speech recognition service could not be reached. Check your connection or try another browser.',
      'language-not-supported': 'This recognition language is unavailable. Choose another language.',
      'aborted': 'Voice input stopped.'
    };
    stopSTT(messages[event.error] || 'Voice input failed. You can still type your message.');
  };
  recognition.onend = function () {
    if (store.get('speechActive') === active) stopSTT('Voice input finished. Review your draft before sending.');
  };
  store.set({ speechActive: active });
  setSpeechStatus(id, 'Starting microphone… Your browser may ask for permission.');
  active.timeout = setTimeout(function () {
    if (store.get('speechActive') === active) stopSTT('Microphone did not start. Check browser permissions and try again.');
  }, 15000);
  try { recognition.start(); }
  catch (error) { if (store.get('speechActive') === active) stopSTT('Voice input could not start. Check microphone permissions and try again.'); }
}

export function initSpeechLifecycle() {
  if (store.get('speechLifecycleBound')) return;
  store.set({ speechLifecycleBound: true });
  store.subscribe(function () {
    var active = store.get('speechActive');
    if (active) current(active);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopSTT(); });
  document.addEventListener('focusin', function (event) {
    var target = event.target;
    var active = store.get('speechActive');
    if (!target || !target.matches || !target.matches('textarea, input, [contenteditable="true"]') ||
        (active && active.input === target)) return;
    try { window.top.document.dispatchEvent(new window.top.Event('clay:voice-claim')); }
    catch (error) { stopSTT(); }
  });
  var stopForClaim = function () { stopSTT(); };
  function attachClaim() {
    try { window.top.document.addEventListener('clay:voice-claim', stopForClaim); } catch (error) { /* Standalone cross-origin host. */ }
  }
  attachClaim();
  window.addEventListener('pageshow', attachClaim);
  window.addEventListener('pagehide', function () {
    stopSTT();
    observer.disconnect();
    try { window.top.document.removeEventListener('clay:voice-claim', stopForClaim); } catch (error) { /* Host unavailable. */ }
  });
  var observer = new MutationObserver(function () {
    var active = store.get('speechActive');
    if (active) current(active);
  });
  function observeVisibility() {
    var options = { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'readonly', 'aria-hidden'] };
    observer.observe(document.body, options);
    try { if (window.top !== window) observer.observe(window.top.document.body, options); }
    catch (error) { /* Cross-origin host. */ }
  }
  observeVisibility();
  window.addEventListener('pageshow', observeVisibility);
}
