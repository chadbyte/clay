// Observational fixture measurements only. Bootstrap timing is separate from
// server snapshot duration; neither proves the browser finished rendering chat.
export function createPaneStartupRecorder() {
  var documents = new WeakMap(), sequence = 0;
  return function (label) {
    var frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not([hidden]) .split-pane-frame'));
    return { label: label, sampledAt: performance.now(), panes: frames.length, frames: frames.map(function (frame) {
      try {
        var doc = frame.contentDocument, previous = documents.get(doc), current = frame.clayPane && frame.clayPane.identity();
        var navigation = frame.contentWindow.performance.getEntriesByType('navigation')[0];
        var resources = frame.contentWindow.performance.getEntriesByType('resource');
        var id = previous || ++sequence; documents.set(doc, id);
        return { documentId: id, documentReusedSinceSample: !!previous, origin: frame.dataset.sessionOriginId,
          bindingGeneration: current && current.binding && current.binding.generation, ready: !!(current && current.ready),
          bootstrap: navigation ? { responseEnd: navigation.responseEnd, domContentLoaded: navigation.domContentLoadedEventEnd, loadEventEnd: navigation.loadEventEnd } : null,
          resourceCount: resources.length, transferredBytes: resources.reduce(function (sum, resource) { return sum + resource.transferSize; }, 0) };
      } catch (error) { return { error: error.message }; }
    }) };
  };
}
