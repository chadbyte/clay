import { enhanceClayIssueLinks, isExactClayIssueReference } from './clay-issue-links.js';
import { enhanceGithubLinks } from './github-links.js';

export function renderClayRecordLink(href, text) {
  if (!isExactClayLogReference(href) && !isExactClayIssueReference(href)) return null;
  return '<a href="#" data-clay-record-ref="' + href.trim() + '">' + text + '</a>';
}
export function parseClayLogReferences(text) {
  var pattern = /\[clayos\/(log:[A-Za-z0-9_-]{24})(?:\s+[\u2014-]\s+([^\]\n]{1,80}))?\]|(^|[^A-Za-z0-9_/:])(log:[A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/g;
  var results = [];
  var match;
  while ((match = pattern.exec(text || ""))) {
    results.push({
      start: match.index,
      end: pattern.lastIndex,
      prefix: match[3] || "",
      ref: match[1] || match[4],
      label: match[2] ? match[2].trim() : "",
    });
  }
  return results;
}

export function isExactClayLogReference(text) {
  return /^log:[A-Za-z0-9_-]{24}$/.test((text || "").trim());
}

function createLogLink(ref, labelText) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "clayos-log-link";
  button.classList.add("clayos-record-link");
  button.contentEditable = "false";
  button.dataset.logRef = ref;
  button.setAttribute("aria-label", "Open Project Log" + (labelText ? " " + labelText : ""));
  var label = document.createElement("span");
  label.textContent = "Log";
  button.appendChild(label);
  if (labelText) {
    var meta = document.createElement("small");
    meta.textContent = labelText;
    button.appendChild(meta);
  }
  return button;
}

export function enhanceClayLogLinks(root) {
  enhanceClayIssueLinks(root);
  root.querySelectorAll('a').forEach(function (anchor) {
    var ref = anchor.getAttribute('data-clay-record-ref') || anchor.getAttribute('href');
    if (anchor.closest('pre, code, button') || !isExactClayLogReference(ref)) return;
    anchor.replaceWith(createLogLink(ref.trim(), anchor.textContent.trim()));
  });
  var codeNodes = root.querySelectorAll("code");
  for (var codeIndex = 0; codeIndex < codeNodes.length; codeIndex++) {
    var code = codeNodes[codeIndex];
    var codeText = (code.textContent || "").trim();
    if (code.closest("pre") || !isExactClayLogReference(codeText)) continue;
    code.parentNode.replaceChild(createLogLink(codeText, ""), code);
  }

  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  var node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest("code, pre, a, button")) continue;
    if (parseClayLogReferences(node.nodeValue).length) nodes.push(node);
  }
  for (var i = 0; i < nodes.length; i++) {
    var text = nodes[i].nodeValue || "";
    var matches = parseClayLogReferences(text);
    var fragment = document.createDocumentFragment();
    var offset = 0;
    for (var j = 0; j < matches.length; j++) {
      var match = matches[j];
      fragment.appendChild(document.createTextNode(text.slice(offset, match.start)));
      if (match.prefix) fragment.appendChild(document.createTextNode(match.prefix));
      fragment.appendChild(createLogLink(match.ref, match.label));
      offset = match.end;
    }
    fragment.appendChild(document.createTextNode(text.slice(offset)));
    nodes[i].parentNode.replaceChild(fragment, nodes[i]);
  }
  // Issues and Logs call this enhancer directly, without the transcript
  // session-link pass. Keep external GitHub chips common to those surfaces.
  enhanceGithubLinks(root);
}
