'use strict';
// Deterministic stand-ins for the CDN scripts the production page loads, so browser
// tests never need the network. Lucide is the checked-in, unmodified 0.468.0 UMD build
// that the page pins (see vendor/README.md), and marked comes from node_modules; no icon
// is faked. DOMPurify is only served if WBX_PURIFY_UMD points at a copy. Every other
// external request is aborted. WBX_LUCIDE_UMD can override the Lucide file.
var fs = require('node:fs');
var path = require('node:path');

var FILES = {
  lucide: process.env.WBX_LUCIDE_UMD || path.join(__dirname, 'vendor', 'lucide-0.468.0.umd.js'),
  purify: process.env.WBX_PURIFY_UMD || '',
  marked: path.join(__dirname, '..', '..', 'node_modules', 'marked', 'lib', 'marked.umd.js')
};

async function install(context) {
  await context.route(function (url) { return !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url.href) && /^https?:/.test(url.href); }, function (route) {
    var url = route.request().url(); var file = null;
    if (/lucide(@[\d.]+)?\/dist\/umd\/lucide\.min\.js/.test(url)) file = FILES.lucide;
    else if (/dompurify@\d+\/dist\/purify\.min\.js/.test(url)) file = FILES.purify;
    else if (/marked@\d+\/marked\.min\.js/.test(url)) file = FILES.marked;
    if (file && fs.existsSync(file)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(file) });
    return route.abort();
  });
}

module.exports = { install: install, FILES: FILES };
