import '@a2ui/lit';
import { MessageProcessor } from '@a2ui/web_core';
import { injectBasicCatalogStyles } from '@a2ui/web_core/catalogs/basic/v1';
import { validateResponse } from './contract.mjs';
import { explorationCatalog } from './catalog.mjs';

// This document has an opaque origin, no network access, and no host capabilities.
window.addEventListener('message', function initialize(event) {
  if (event.source !== parent || event.data !== 'clay-a2ui-init' || !event.ports[0]) return;
  window.removeEventListener('message', initialize);
  var port = event.ports[0];
  var started = false;
  var failed = false;
  function fail(error) {
    if (failed) return;
    failed = true;
    document.getElementById('surface').replaceChildren();
    port.postMessage({ type: 'error' });
  }
  port.onmessage = function (message) {
    if (message.data && message.data.type === 'theme') { document.documentElement.className = message.data.dark ? 'a2ui-dark' : 'a2ui-light'; return; }
    if (started) return;
    started = true;
    try {
      var doc = validateResponse(message.data.source);
      document.documentElement.className = message.data.dark ? 'a2ui-dark' : 'a2ui-light';
      injectBasicCatalogStyles();
      var processor = new MessageProcessor([explorationCatalog], fail, { outboundListener: fail, errorHandler: fail });
      processor.onSurfaceCreated(function (surface) {
        var element = document.createElement('a2ui-surface');
        element.surface = surface;
        document.getElementById('surface').appendChild(element);
      });
      var errors = processor.processMessagesWithErrors(doc.messages);
      if (errors.length || failed) { fail(); return; }
      var lastHeight = 0;
      var observer = new ResizeObserver(function () {
        var height = Math.ceil(document.getElementById('surface').getBoundingClientRect().height + 24);
        if (height !== lastHeight) { lastHeight = height; port.postMessage({ type: 'height', height: height }); }
      });
      observer.observe(document.getElementById('surface'));
      window.addEventListener('error', fail);
      window.addEventListener('unhandledrejection', fail);
      requestAnimationFrame(function () {
        var element = document.querySelector('a2ui-surface');
        if (!element || !element.firstElementChild) { fail(); return; }
        if (!failed) port.postMessage({ type: 'ready' });
      });
    } catch (error) { fail(error); }
  };
  port.start();
});
