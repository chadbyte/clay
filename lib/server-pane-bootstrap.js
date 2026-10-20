var createPaneAssets = require('./pane-asset-manifest').createPaneAssets;

// Called only from the authenticated app-shell path. Let the browser discover
// imports normally: transitive preload bursts multiply across pane documents.
function createPaneBootstrap(publicDir) {
  var readAssets = createPaneAssets(publicDir);
  return function preparePaneShell(shell, requestUrl) {
    if (new URL(requestUrl, 'http://localhost').searchParams.get('pane') !== '1') return shell;
    // Required globals must execute before the module graph evaluates (notably
    // marked.use). Keep their parser-blocking barrier.
    // Feature-only vendors must not delay ordinary chat startup.
    shell = shell.replace(/<script src="([^" ]+)"><\/script>/g, function (tag, url) {
      var group = url.indexOf('mermaid@') >= 0 ? 'mermaid' : url.indexOf('qrcode-generator@') >= 0 ? 'qr' : url.indexOf('vendor/codemirror/') === 0 ? 'editor' : null;
      return group ? '<script type="application/json" data-pane-asset-group="' + group + '" data-src="' + url + '"></script>' : tag;
    });
    var assets = readAssets();
    if (assets) {
      shell = shell.replace(/(<script type="module" src=")app\.js(?:\?[^"<>]*)?("><\/script>)/, '$1' + assets.js + '$2');
      shell = shell.replace(/(<link rel="stylesheet" href=")style\.css(?:\?[^"<>]*)?(">)/, '$1' + assets.css + '$2');
    }
    return shell;
  };
}
module.exports = { createPaneBootstrap: createPaneBootstrap };
