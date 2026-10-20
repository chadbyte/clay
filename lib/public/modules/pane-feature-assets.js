// In-flight promises are module-owned resources, never store data.
var featureRequests = {};

// Only server-authored, inert feature tags are eligible. Parent documents retain
// their normal vendor loading; pane documents load these groups on first use.
export function ensurePaneFeatureAssets(group) {
  if (['editor', 'mermaid', 'qr'].indexOf(group) === -1) return Promise.reject(new Error('Unknown feature assets'));
  var existing = featureRequests[group];
  if (existing) return existing;
  var tags = Array.from(document.querySelectorAll('script[data-pane-asset-group="' + group + '"]'));
  var promise = tags.reduce(function (previous, tag) {
    return previous.then(function () {
      if (tag.dataset.loaded === 'true') return;
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script'), timer;
        function failed() {
          clearTimeout(timer); script.onload = null; script.onerror = null; script.remove();
          reject(new Error('Could not load ' + group + ' assets. Try again.'));
        }
        script.src = tag.dataset.src; script.async = false;
        script.onload = function () { clearTimeout(timer); tag.dataset.loaded = 'true'; resolve(); };
        script.onerror = failed; timer = setTimeout(failed, 15000);
        tag.after(script);
      });
    });
  }, Promise.resolve());
  promise = promise.then(function () {
    var value = group === 'editor' ? window.CodeMirror : group === 'mermaid' ? window.mermaid : window.qrcode;
    if (!value) throw new Error('Could not load ' + group + ' assets. Try again.');
  }).catch(function (error) {
    delete featureRequests[group]; throw error;
  });
  featureRequests[group] = promise;
  return promise;
}
