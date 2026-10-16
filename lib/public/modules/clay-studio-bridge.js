import { adoptDocumentSource, presentedDocument, initDocumentSource } from './clay-studio-document.js';
import { acceptStudioForward, trustedStudioFrame, initStudioReceipts } from './clay-studio-render.js';
import { presentMarkdownEdit, handleFileChanged } from './filebrowser.js';
import { openWireframe } from './wireframe-workbench.js';

export function initStudioBridge() {
  initStudioReceipts(); initDocumentSource();
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.origin === location.origin && data && data.type === 'clay-studio-document-update' && data.message) {
      var view = presentedDocument(data.message.path);
      if (view && view.source === event.source && view.descriptor.token === data.token) handleFileChanged(data.message, view);
      return;
    }
    if (!data || ['clay-pane-present-markdown', 'clay-pane-present-wireframe'].indexOf(data.type) < 0 || !data.message || !data.message.controlPresentation) return;
    if (!trustedStudioFrame(event, data) || !acceptStudioForward(event, data)) return;
    if (data.type === 'clay-pane-present-markdown') { adoptDocumentSource(event, data, trustedStudioFrame(event, data)); presentMarkdownEdit(data.message); }
    else openWireframe(data.message);
  });
}
