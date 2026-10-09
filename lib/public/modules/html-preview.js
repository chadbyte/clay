export function isHtmlFile(path) {
  return /\.html?$/i.test(String(path || ""));
}

export function renderHtmlPreview(body, source, path) {
  var frame = document.createElement("iframe");
  frame.className = "file-viewer-html-preview";
  frame.title = "HTML preview of " + path;
  // Scripts can drive the preview, but cannot access Clay's document or cookies.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  var doc = new DOMParser().parseFromString(source, "text/html");
  var policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'unsafe-inline' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  frame.srcdoc = "<!doctype html>\n" + doc.documentElement.outerHTML;
  body.replaceChildren(frame);
}
