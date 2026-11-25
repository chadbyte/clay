import { runtimeVersion } from '../a2ui/version.js';

// Fetch only host-authored assets with the parent session. The opaque frame
// receives their bytes, never cookies, credentials or response-authored code.
var pending;
function asset(name, type) {
  var url = new URL('../a2ui/' + name + '?v=' + runtimeVersion, import.meta.url);
  return fetch(url, { credentials: 'same-origin', redirect: 'error' }).then(function (response) {
    if (!response.ok || !(response.headers.get('content-type') || '').includes(type)) throw new Error('Renderer asset unavailable');
    return response.text();
  }).then(function (text) {
    if (text.length > 2000000) throw new Error('Renderer asset too large');
    return text;
  });
}
export function loadA2uiDocument() {
  if (pending) return pending;
  pending = Promise.all([asset('runtime.js', 'javascript'), asset('frame.css', 'css')]).then(function (assets) {
    var nonce = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    var script = assets[0].replace(/<\/script/gi, '<\\/script');
    var css = assets[1].replace(/<\/style/gi, '<\\/style');
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-' + nonce + '&#39;; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; img-src &#39;none&#39;; font-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">' +
      '<style>' + css + '</style></head><body><div id="surface"></div><script nonce="' + nonce + '">' + script + '</script></body></html>';
  }).catch(function (error) { pending = null; throw error; });
  return pending;
}
