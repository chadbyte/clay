// Known provider login operations and output grammar; never accepts a command
// from model/client input. Identity and terminal permission stay in the host.
var PATTERNS = [/successfully logged in(?![ \t]+to[ \t]+mcp)/i, /logged in successfully/i, /login successful/i,
  /successfully authenticated/i, /authentication successful/i, /signed in successfully/i,
  /signed in with your [a-z ]+ account/i, /you(?:'re| are) (?:now )?(?:logged|signed) in/i];
function stripAnsi(text) { return String(text).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\r/g, ''); }
function successful(text) { return PATTERNS.some(function(pattern) { return pattern.test(text); }); }
function command(vendor, browser) {
  var info = require('./provider-contract').resolve(vendor);
  var operation = browser ? info.browserLoginCommand : info.terminalLoginCommand || info.loginCommand;
  if (typeof operation !== 'string' || !/^[a-zA-Z0-9_.-]+(?: [a-zA-Z0-9_.-]+)*$/.test(operation)) throw new Error('Provider sign-in is unavailable.');
  return operation;
}
function loginUrl(value, provider) {
  try {
    var hosts = require('./provider-contract').resolve(provider).oauthHosts || [];
    var url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || hosts.indexOf(url.hostname) < 0) return null;
    if (!url.searchParams.get('state') || !url.searchParams.get('code_challenge')) return null;
    var callback = new URL(url.searchParams.get('redirect_uri'));
    if (callback.protocol !== 'http:' || ['localhost', '127.0.0.1', '[::1]'].indexOf(callback.hostname) < 0) return null;
    return url.href;
  } catch (error) { return null; }
}
module.exports = { stripAnsi: stripAnsi, successful: successful, command: command, loginUrl: loginUrl };
