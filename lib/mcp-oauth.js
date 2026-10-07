var crypto = require('crypto');
var http = require('http');
var assertPublicUrl = require('./mcp-network').assertPublicUrl;

function createOAuthProvider(record, persist, flow) {
  record.auth = record.auth || {};
  var auth = record.auth;
  function guard() { if (flow && flow.cancelled) throw new Error('Sign-in expired.'); }
  function save() { persist(); }
  return {
    get redirectUrl() { return flow ? flow.redirectUrl : auth.redirectUrl; },
    get clientMetadata() { return { client_name: 'Clay', redirect_uris: [flow ? flow.redirectUrl : auth.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
    state: function () { return flow ? flow.state : crypto.randomBytes(32).toString('hex'); },
    clientInformation: function () { return auth.client; },
    saveClientInformation: function (value) { guard(); auth.client = value; save(); },
    tokens: function () { return auth.tokens; },
    saveTokens: function (value) { guard(); auth.tokens = value; save(); },
    saveCodeVerifier: function (value) { if (flow) flow.verifier = value; },
    codeVerifier: function () { if (!flow || !flow.verifier) throw new Error('Sign in again.'); return flow.verifier; },
    redirectToAuthorization: async function (url) {
      if (!flow) { var required = new Error('Sign in to connect this server.'); required.name = 'UnauthorizedError'; throw required; }
      await (flow.validateUrl || assertPublicUrl)(url.href);
      guard();
      if (url.searchParams.get('state') !== flow.state || url.searchParams.get('redirect_uri') !== flow.redirectUrl || !url.searchParams.get('code_challenge')) throw new Error('Invalid sign-in request.');
      flow.authorizationUrl = url.href;
    },
    discoveryState: function () { return auth.discovery; },
    saveDiscoveryState: function (value) {
      // Bind client credentials to the discovered issuer.
      if (auth.discovery && auth.discovery.authorizationServerUrl !== value.authorizationServerUrl) { delete auth.client; delete auth.tokens; }
      guard(); auth.discovery = value; save();
    },
    invalidateCredentials: function (which) {
      if (which === 'all' || which === 'client') delete auth.client;
      if (which === 'all' || which === 'tokens') delete auth.tokens;
      if (which === 'all' || which === 'discovery') delete auth.discovery;
      if (flow && (which === 'all' || which === 'verifier')) flow.verifier = null;
      save();
    },
  };
}
async function createCallback(onCode) {
  var flow = { state: crypto.randomBytes(32).toString('hex'), used: false };
  var server = http.createServer(function (req, res) {
    var url = new URL(req.url, flow.redirectUrl);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method !== 'GET' || url.pathname !== '/callback' || flow.used || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('iss').length > 1 || url.searchParams.get('state') !== flow.state) {
      res.writeHead(400); res.end('Invalid or expired sign-in.'); return;
    }
    var code = url.searchParams.get('code');
    if (!code || code.length > 8192 || url.searchParams.has('error')) { res.writeHead(400); res.end('Sign-in was not completed. Return to Clay and retry.'); return; }
    flow.used = true;
    Promise.resolve().then(function () { return onCode(code, url.searchParams.get('iss')); }).then(function () {
      res.end('Connected. You can return to Clay.');
    }, function () { res.writeHead(400); res.end('Sign-in failed. Return to Clay and retry.'); });
  });
  await new Promise(function (resolve, reject) { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  flow.redirectUrl = 'http://127.0.0.1:' + server.address().port + '/callback';
  flow.close = function () { server.close(); server.closeAllConnections(); flow.verifier = null; };
  return flow;
}
module.exports = { createOAuthProvider: createOAuthProvider, createCallback: createCallback };
