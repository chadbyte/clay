var activeEditor = null;

function relativeName(from, to) {
  var source = String(from || '').split('/'); source.pop(); var target = String(to || '').replace(/\.md$/i, '').split('/');
  while (source.length && target.length && source[0] === target[0]) { source.shift(); target.shift(); }
  return new Array(source.length + 1).join('../') + target.join('/');
}

function wikiHint(editor, files, currentName) {
  var cursor = editor.getCursor(); var line = editor.getLine(cursor.line); var before = line.slice(0, cursor.ch); var open = before.lastIndexOf('[[', cursor.ch);
  if (open === -1 || before.slice(open + 2).indexOf(']]') !== -1) return null;
  var typed = before.slice(open + 2).split('|')[0].split('#')[0].toLowerCase();
  var list = (files || []).filter(function (file) { return file.itemType !== 'db' && (!typed || file.name.toLowerCase().indexOf(typed) !== -1); }).slice(0, 30).map(function (file) {
    return { text: relativeName(currentName, file.name) + ']]', displayText: file.name };
  });
  return { list: list, from: window.CodeMirror.Pos(cursor.line, open + 2), to: cursor };
}

function maybeComplete(editor, change, files, currentName) {
  if (!change || change.origin === 'setValue' || change.origin === 'complete') return;
  var cursor = editor.getCursor(); var line = editor.getLine(cursor.line).slice(0, cursor.ch);
  if (line.lastIndexOf('[[') === -1 || line.lastIndexOf(']]') > line.lastIndexOf('[[')) return;
  editor.showHint({ completeSingle: false, hint: function (cm) { return wikiHint(cm, files, currentName); } });
}

export function mountKnowledgeEditor(host, options) {
  destroyKnowledgeEditor();
  var textarea = document.createElement('textarea'); textarea.setAttribute('aria-label', 'Markdown source'); host.appendChild(textarea);
  if (!window.CodeMirror) { textarea.value = options.value || ''; textarea.className = 'knowledge-editor-fallback'; textarea.addEventListener('input', function () { options.onChange(textarea.value, null); }); activeEditor = { fallback: textarea }; return activeEditor; }
  var editor = window.CodeMirror.fromTextArea(textarea, {
    value: options.value || '', mode: { name: 'markdown', highlightFormatting: true }, lineWrapping: true, lineNumbers: false,
    indentUnit: 2, tabSize: 2, indentWithTabs: false, inputStyle: 'contenteditable', spellcheck: true,
    extraKeys: { 'Ctrl-Space': function (cm) { cm.showHint({ completeSingle: false, hint: function (item) { return wikiHint(item, options.files, options.currentName); } }); },
      'Tab': function (cm) { cm.execCommand('indentMore'); }, 'Shift-Tab': function (cm) { cm.execCommand('indentLess'); },
      'Enter': 'newlineAndIndentContinueMarkdownList' },
  });
  editor.setValue(options.value || ''); editor.clearHistory();
  if (options.history) { try { editor.setHistory(options.history); } catch (error) {} }
  if (options.cursor) { try { editor.setCursor(options.cursor); } catch (error) {} }
  editor.on('change', function (cm, change) { options.onChange(cm.getValue(), cm.getCursor()); maybeComplete(cm, change, options.files, options.currentName); });
  editor.on('cursorActivity', function (cm) { if (options.onCursor) options.onCursor(cm.getCursor()); });
  activeEditor = editor; setTimeout(function () { editor.refresh(); editor.focus(); }, 0); return editor;
}

export function captureKnowledgeEditor() {
  if (!activeEditor) return null;
  if (activeEditor.fallback) return { content: activeEditor.fallback.value, cursor: null, history: null, scroll: activeEditor.fallback.scrollTop || 0 };
  return { content: activeEditor.getValue(), cursor: activeEditor.getCursor(), history: activeEditor.getHistory(), scroll: activeEditor.getScrollInfo().top };
}

export function scrollKnowledgeEditor(top) { if (activeEditor && !activeEditor.fallback) activeEditor.scrollTo(null, top || 0); }
export function destroyKnowledgeEditor() {
  if (!activeEditor) return;
  if (!activeEditor.fallback) { try { activeEditor.toTextArea(); } catch (error) {} }
  else if (activeEditor.fallback.parentNode) activeEditor.fallback.parentNode.removeChild(activeEditor.fallback);
  activeEditor = null;
}
