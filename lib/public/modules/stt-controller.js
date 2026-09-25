// Shared recognition lifecycle. Recognition callbacks belong to one immutable draft context.
import { store } from './store.js';
import { speechTrace } from './stt-debug.js';
import { startBrowserSpeechSignal } from './stt-signal.js';
import { browserSpeechInfo } from './stt-browser.js';

export function speechConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechContext() {
  var s = store.snap();
  return JSON.stringify([s.currentSlug, s.activeSessionId, s.dmMode, s.dmKey,
    s.dmTargetUser && s.dmTargetUser.id, s.homePrimarySurface, s.homeSubSurface,
    s.homeChatMateId, s.homeChatSessionId]);
}

export function setSpeechStatus(id, message, isError) {
  var statuses = Object.assign({}, store.get('speechStatuses'));
  var errors = Object.assign({}, store.get('speechErrors'));
  statuses[id] = message;
  errors[id] = isError ? { message: message } : null;
  store.set({ speechStatuses: statuses, speechErrors: errors });
}

export function failSTT(message) {
  var active = store.get('speechActive');
  if (!active) return;
  stopSTT(message);
  setSpeechStatus(active.id, message, true);
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

export function stopSTT(message, reason) {
  var active = store.get('speechActive');
  if (!active) return;
  speechTrace(active, 'stop', { reason: reason || (typeof message === 'string' ? message : 'unspecified caller'), bytes: active.bytes || 0 });
  console.trace('[Clay voice] Stop caller · ' + (active.traceId || 'browser'));
  // Invalidate before abort: late results and end events must never revive an old draft.
  store.set({ speechActive: null });
  clearTimeout(active.timeout);
  if (active.visualCapture) active.visualCapture.abort();
  try { active.recognition.abort(); } catch (error) { /* Already ended. */ }
  setSpeechStatus(active.id, typeof message === 'string' ? message : 'Voice input stopped.');
}

export function currentSpeech(active) {
  if (store.get('speechActive') !== active) return false;
  if (active.context !== speechContext() || !usableSpeechInput(active.input) ||
      active.input.value !== active.lastValue) {
    stopSTT(undefined, active.context !== speechContext() ? 'draft context changed' :
      active.input.value !== active.lastValue ? 'draft text changed outside voice input' : 'input hidden, disabled, detached or document hidden');
    return false;
  }
  return true;
}

export function claimSpeech(id, input, recognition) {
  try { window.top.document.dispatchEvent(new window.top.Event('clay:voice-claim')); }
  catch (error) { stopSTT(); }
  stopSTT();
  var active = { id: id, input: input, recognition: recognition, context: speechContext(),
    before: input.value, lastValue: input.value, writing: false, started: false, timeout: null };
  active.traceId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  active.traceStarted = Date.now();
  store.set({ speechActive: active, speechRetry: null });
  return active;
}

export function writeSpeech(active, transcript) {
  if (!currentSpeech(active)) return false;
  var separator = active.before && transcript && !/\s$/.test(active.before) ? ' ' : '';
  active.lastValue = active.before + separator + transcript;
  active.input.value = active.lastValue;
  active.writing = true;
  try { active.input.dispatchEvent(new Event('input', { bubbles: true })); }
  finally { active.writing = false; }
  return true;
}

export function startSTT(id, input) {
  if (!usableSpeechInput(input)) return;
  var browser = browserSpeechInfo();
  if (!browser.available) { setSpeechStatus(id, browser.reason, true); return; }
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
    if (!currentSpeech(active)) return;
    clearTimeout(active.timeout);
    active.started = true;
    store.set({ speechActive: active });
    setSpeechStatus(id, 'Listening. Select the microphone to stop.');
  };
  recognition.onresult = function (event) {
    if (!currentSpeech(active)) return;
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
    if (event.error === 'aborted' || event.error === 'no-speech') stopSTT(messages[event.error]);
    else failSTT(messages[event.error] || 'Voice input failed. You can still type your message.');
  };
  recognition.onend = function () {
    if (store.get('speechActive') === active) stopSTT('Voice input finished. Review your draft before sending.');
  };
  store.set({ speechActive: active, speechRetry: null });
  setSpeechStatus(id, 'Starting microphone… Your browser may ask for permission.');
  active.timeout = setTimeout(function () {
    if (store.get('speechActive') === active) stopSTT('Microphone did not start. Check browser permissions and try again.');
  }, 15000);
  try { startBrowserSpeechSignal(active); recognition.start(); }
  catch (error) { if (store.get('speechActive') === active) stopSTT('Voice input could not start. Check microphone permissions and try again.'); }
}

export function initSpeechLifecycle() {
  if (store.get('speechLifecycleBound')) return;
  store.set({ speechLifecycleBound: true });
  store.subscribe(function () {
    var active = store.get('speechActive');
    if (active) currentSpeech(active);
    var retry = store.get('speechRetry');
    if (retry && (retry.context !== speechContext() || !usableSpeechInput(retry.input) || retry.input.value !== retry.value)) store.set({ speechRetry: null });
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopSTT(undefined, 'document visibility changed to hidden'); });
  document.addEventListener('focusin', function (event) {
    var target = event.target;
    var active = store.get('speechActive');
    if (!target || !target.matches || !target.matches('textarea, input, [contenteditable="true"]') ||
        (active && active.input === target)) return;
    try { window.top.document.dispatchEvent(new window.top.Event('clay:voice-claim')); }
    catch (error) { stopSTT(); }
  });
  var stopForClaim = function () { stopSTT(undefined, 'another composer or input claimed voice ownership'); };
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
    if (active) currentSpeech(active);
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
