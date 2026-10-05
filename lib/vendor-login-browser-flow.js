var createLoginBrowser = require("./vendor-login-browser").createLoginBrowser;

function attachBrowserLogin(ctx) {
  function allowed(ws, flow) {
    var userId = ws && ws._clayUser ? String(ws._clayUser.id) : null;
    return userId === flow.ownerId && ctx.hasTerminalPermission(ws);
  }
  function prepare(ws, flow, identity) {
    if (ctx.osUsers && !identity.osUserInfo) throw new Error("OS user identity is unavailable");
    flow.ownerId = ws && ws._clayUser ? String(ws._clayUser.id) : null;
    flow.browser = (ctx.createLoginBrowser || createLoginBrowser)({
      ws: ws, vendor: flow.vendor, osUserInfo: identity.osUserInfo,
      sendTo: ctx.sendTo,
      canAccess: function (peer) { return allowed(peer, flow); },
    });
    flow.expiryTimer = setTimeout(function () { ctx.cancel(flow.key); }, 15 * 60 * 1000);
    flow.expiryTimer.unref();
  }
  function handle(ws, msg, flows) {
    var flow = flows[ctx.flowKey(ws, String(msg.vendor || "claude"))];
    if (msg.type === "vendor_login_cancel" && msg.browserId && (!flow || !flow.browser)) return true;
    if (typeof msg.type === "string" && msg.type.indexOf("term_") === 0) {
      var vendors = Object.keys(flows);
      for (var i = 0; i < vendors.length; i++) {
        var candidate = flows[vendors[i]];
        if (candidate.terminalId === msg.id && !allowed(ws, candidate)) return true;
      }
    }
    if (msg.type === "vendor_login_browser_attach" || msg.type === "vendor_login_browser_input") {
      if (!flow || !flow.browser || flow.browser.id !== msg.browserId || !allowed(ws, flow)) return true;
      if (msg.type === "vendor_login_browser_attach") flow.browser.attach(ws);
      else flow.browser.input(ws, msg.event);
      return true;
    }
    if (flow && flow.browser && (msg.type === "vendor_login_start" || msg.type === "vendor_login_cancel")) {
      if (!allowed(ws, flow) || (msg.type === "vendor_login_cancel" && msg.browserId !== flow.browser.id)) {
        ctx.sendTo(ws, { type: "vendor_login_error", vendor: msg.vendor, error: "This sign-in belongs to another request. Reopen sign-in to continue." });
        return true;
      }
    }
    return false;
  }
  return { prepare: prepare, handle: handle };
}

module.exports = { attachBrowserLogin: attachBrowserLogin };
