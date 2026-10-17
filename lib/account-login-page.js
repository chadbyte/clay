var fs = require('fs');
var path = require('path');
var assets = {
  '/auth/account-login.js': ['public/auth/account-login.js', 'text/javascript'],
  '/auth/account-login.css': ['public/auth/account-login.css', 'text/css'],
  '/auth/login-symbol.png': ['public/clay-studio-symbol.png', 'image/png'],
  '/auth/login-wordmark.svg': ['public/clay-studio-wordmark-bold.svg', 'image/svg+xml'],
  '/auth/login-font.woff2': ['public/fonts/geist/Geist-Variable.woff2', 'font/woff2'],
};
function handleAsset(req, res, url) {
  if (req.method !== 'GET' || !Object.prototype.hasOwnProperty.call(assets, url)) return false;
  res.writeHead(200, { 'Content-Type': assets[url][1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(fs.readFileSync(path.join(__dirname, assets[url][0]))); return true;
}
function render(options) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Clay</title><link rel="stylesheet" href="/auth/account-login.css"></head><body>' +
    '<main id="login" data-stage="welcome" data-password="' + !!options.password + '" data-email="' + !!options.email + '">' +
    '<header class="brand"><div class="brand-lockup"><img class="symbol" src="/auth/login-symbol.png" alt=""><img class="wordmark" src="/auth/login-wordmark.svg" alt="Clay Studio" width="4742" height="1156"></div></header>' +
    '<section class="panel"><div class="panel-header"><button id="back" class="back" aria-label="Back" title="Back" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg></button><h1 id="heading" tabindex="-1">Sign in</h1></div><p id="description">Choose how to sign in.</p>' +
    '<div id="welcome" class="view"><div id="accounts" aria-label="Remembered accounts"></div><button id="passkey" class="primary method" hidden>Continue with a passkey</button><button id="account" class="primary method">Sign in with an account</button><button id="email-method" class="quiet" hidden>Email me a sign-in code</button></div>' +
    '<form id="identity" class="view" hidden><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="100" required><button class="primary">Continue</button></form>' +
    '<form id="credential" class="view" hidden><div class="identity-chip"><span id="selected-avatar" class="avatar"></span><div><strong id="selected-name"></strong><small id="selected-username"></small></div></div><input id="credential-username" class="offscreen" aria-label="Username" name="username" autocomplete="username" tabindex="-1"><label id="secret-label" for="secret">Password</label><div class="secret-field"><input id="secret" name="password" type="password" autocomplete="current-password" maxlength="256" required><button id="reveal" type="button" aria-pressed="false">Show</button></div><button class="primary">Sign in</button><button id="use-pin" class="quiet" type="button" hidden>I still use an account PIN</button></form>' +
    '<form id="enroll" class="view" hidden><label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" maxlength="256" required><label for="confirm-password">Confirm password</label><input id="confirm-password" type="password" autocomplete="new-password" maxlength="256" required><button class="primary">Save password and continue</button></form>' +
    '<form id="email" class="view" hidden><label for="email-address">Email address</label><input id="email-address" type="email" autocomplete="email" maxlength="100" required><button class="primary">Send sign-in code</button></form>' +
    '<form id="code" class="view" hidden><label for="otp">Sign-in code</label><input id="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required><button class="primary">Sign in</button><button id="resend" class="quiet" type="button">Send another code</button></form>' +
    '<p id="status" role="status"></p><p id="error" role="alert"></p></section><footer><details><summary>Help signing in</summary><p>Contact your server administrator if you cannot sign in. You can forget a remembered account on this browser without deleting the account.</p></details><span id="server-address"></span></footer></main><script type="module" src="/auth/account-login.js"></script></body></html>';
}
module.exports = { render: render, handleAsset: handleAsset };
