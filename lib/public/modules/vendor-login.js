import { personalLoginCurrent } from './personal-provider-context.js';
// vendor-login.js - Vendor login (auth_required) recovery flow.
//
// The server owns the login terminal (see lib/project-vendor-login.js): exactly
// one per vendor per project, tracked server-side, killed once the login lands.
// This module is the client half of that contract - it asks for the flow, opens
// the modal on whatever terminal the server hands back, and reflects the flow's
// state in a banner.
//
// Nothing here spawns a terminal speculatively. Every auth_required after the
// first is a no-op while a flow is live, which is what stops the login-terminal
// pile-up and the endless auth_required -> login -> 401 loop.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons, iconHtml } from './icons.js';
import { openTuiModal, closeTuiModal, getTuiModalTerminalId } from './tui-attention.js';
import { forwardPaneAuthRequired } from './pane-bridge.js';
import { openLoginBrowser, closeLoginBrowser } from './vendor-login-browser.js';
import { escapeHtml } from './utils.js';

// vendor -> { terminalId, startedAt } as last broadcast by the server.
var activeFlows = Object.create(null);
// vendor -> true between sending vendor_login_start and hearing back.
var pendingStarts = Object.create(null);
// Vendor whose login terminal the modal is currently showing.
var modalVendor = null;
// Set while this module tears the modal down itself, so the modal's close hook
// does not read a programmatic close as "the user gave up".
var closingModalInternally = false;

function vendorDisplayName(vendor) {
  var vendors = store.get('vendorInfo') || {};
  var info = vendors[vendor];
  if (info && info.displayName) return info.displayName;
  return vendor || "Provider";
}

function currentProjectSlug() {
  var slug = store.get('currentSlug') || "";
  if (slug) return slug;
  // Fallback: derive from the URL (/p/<slug>/...).
  try {
    var m = (window.location.pathname || "").match(/^\/p\/([a-z0-9_-]+)/);
    if (m) return m[1];
  } catch (e) {}
  return "";
}

function workerContextMatches(target) {
  return !!target && target.slug === store.get('currentSlug') && target.selectedSessionId === store.get('activeSessionId') &&
    target.selectedOrigin === store.get('sessionOriginId') && target.socketGeneration === store.get('projectSplitViewSocketGeneration');
}

function forgetWorkerRequest(vendor) {
  var requests = Object.assign({}, store.get('workerVendorLoginRequests') || {});
  delete requests[vendor];
  store.set({ workerVendorLoginRequests: requests });
}

// The banner surface belongs to the notification center. Query it rather than
// importing app-notifications so the dependency stays one-directional
// (app-notifications -> vendor-login).
function bannerContainer() {
  return document.querySelector(".notif-banner-container");
}

function removeBannerEl(el) {
  if (!el) return;
  el.classList.remove("show");
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 300);
}

function clearLoginBanners() {
  var container = bannerContainer();
  if (!container) return;
  var existing = container.querySelectorAll('[data-vendor-login="true"]');
  for (var i = 0; i < existing.length; i++) removeBannerEl(existing[i]);
}

function showLoginBanner(opts) {
  var container = bannerContainer();
  if (!container) return null;
  clearLoginBanners();

  var banner = document.createElement("div");
  banner.className = "notif-banner notif-banner-update";
  banner.setAttribute("data-notif-id", "_vendor_login");
  banner.setAttribute("data-vendor-login", "true");
  banner.innerHTML =
    '<div class="notif-banner-icon">' + iconHtml(opts.icon || "check-circle") + '</div>' +
    '<div class="notif-banner-body">' +
      '<div class="notif-banner-project">CLAY</div>' +
      '<div class="notif-banner-title">' + escapeHtml(opts.title) + '</div>' +
      '<div class="notif-banner-text">' + escapeHtml(opts.text) + '</div>' +
    '</div>' +
    '<button class="notif-banner-close">' + iconHtml("x") + '</button>';

  container.appendChild(banner);
  refreshIcons();
  requestAnimationFrame(function () { banner.classList.add("show"); });

  var closeBtn = banner.querySelector(".notif-banner-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      removeBannerEl(banner);
      if (opts.onDismiss) opts.onDismiss();
    });
  }
  if (typeof opts.autoDismissMs === "number") {
    setTimeout(function () { removeBannerEl(banner); }, opts.autoDismissMs);
  }
  return banner;
}

function showLoginStartedBanner(vendor) {
  showLoginBanner({
    icon: "check-circle",
    title: vendorDisplayName(vendor) + " login started",
    text: "Finish sign-in below, then explicitly retry your task.",
    onDismiss: function () { cancelVendorLogin(vendor); },
  });
}

function showLoginCompleteBanner(vendor) {
  showLoginBanner({
    icon: "check-circle",
    title: "Signed in to " + vendorDisplayName(vendor),
    text: "Credentials reloaded. Send your next message to continue.",
    autoDismissMs: 6000,
  });
}

function showLoginErrorBanner(vendor, error) {
  showLoginBanner({
    icon: "alert-triangle",
    title: vendorDisplayName(vendor) + " login could not start",
    text: error || "The login terminal could not be created.",
    autoDismissMs: 8000,
  });
}

function closeModalInternally() {
  modalVendor = null;
  closingModalInternally = true;
  try {
    closeTuiModal();
  } finally {
    closingModalInternally = false;
  }
}

function closeModalForVendor(vendor, terminalId) {
  if (modalVendor !== vendor) return;
  var openId = getTuiModalTerminalId();
  if (typeof terminalId === "number" && openId != null && openId !== terminalId) return;
  closeModalInternally();
}

// ========================================================
// Outgoing
// ========================================================

/**
 * Ask the server to start (or hand back) the login terminal for a vendor.
 * opts.auto marks a request triggered by an auth_required event; those never
 * open a second prompt while a flow is already running.
 */
export function requestVendorLogin(vendor, opts) {
  var options = opts || {};
  var target = vendor || "claude";
  if (options.personalRequestId && !personalLoginCurrent({personalRequestId:options.personalRequestId})) return false;
  if (options.auto && (activeFlows[target] || pendingStarts[target])) return false;

  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  if (options.workerAuthRequestId) {
    var requests = Object.assign({}, store.get('workerVendorLoginRequests') || {});
    requests[target] = { requestId: options.workerAuthRequestId, slug: store.get('currentSlug'),
      selectedSessionId: store.get('activeSessionId'), selectedOrigin: store.get('sessionOriginId'),
      socketGeneration: store.get('projectSplitViewSocketGeneration') };
    store.set({ workerVendorLoginRequests: requests });
  }

  if (options.personalRequestId) store.set({personalProviderSigningIn:target});
  pendingStarts[target] = true;
  ws.send(JSON.stringify({
    type: "vendor_login_start",
    vendor: target,
    auto: !!options.auto,
    sessionId: options.personalRequestId ? null : options.sessionId || store.get('activeSessionId') || null,
    personalRequestId: options.personalRequestId || null,
    workerAuthRequestId: options.workerAuthRequestId || null,
    mode: options.mode || ((((store.get("vendorInfo") || {})[target] || {}).browserLoginSupported === true) ? "browser" : "terminal"),
  }));
  showLoginStartedBanner(target);
  return true;
}

export function cancelVendorLogin(vendor) {
  var target = vendor || modalVendor;
  if (!target) return;
  var flow = activeFlows[target];
  forgetWorkerRequest(target);
  var browser = store.get('vendorLoginBrowser');
  var browserId = flow && flow.browserId || (browser && browser.vendor === target ? browser.browserId : null);
  if (browser && browser.vendor === target) closeLoginBrowser();
  delete pendingStarts[target];
  delete activeFlows[target];
  clearLoginBanners();
  if (modalVendor === target) closeModalInternally();
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "vendor_login_cancel", vendor: target, browserId: browserId, workerAuthRequestId: flow && flow.workerAuthRequestId, personalRequestId: store.get('personalProviderSigningIn') === target ? store.get('personalProviderRevision') : null }));
  }
}

/**
 * Auto-open the login flow when the server reports the vendor isn't logged in.
 *
 * Split panes have no banner surface of their own (the parent shell owns the
 * single visible one), so a pane hands the event up instead of running two
 * competing flows.
 */
export function autoStartLoginIfNeeded(msg) {
  if (!msg) return false;
  if (store.get('paneMode')) {
    return forwardPaneAuthRequired({
      vendor: msg.vendor || "claude",
      sessionId: msg.sessionId || store.get('activeSessionId') || null,
      workerAuthRequestId: msg.workerAuthRequestId || null,
      loginCommand: msg.loginCommand,
      canAutoLogin: msg.canAutoLogin,
    });
  }
  if (msg.canAutoLogin === false || msg.loginCommand === '') {
    showLoginErrorBanner(msg.vendor, 'Automatic sign-in is unavailable. Sign in manually on the server, then explicitly retry the task.');
    return false;
  }
  var vendor = msg.vendor || "claude";
  if (activeFlows[vendor] || pendingStarts[vendor]) return false;
  return requestVendorLogin(vendor, { auto: true, sessionId: msg.sessionId || null, workerAuthRequestId: msg.workerAuthRequestId || null });
}

export function handleWorkerAuthRequired(msg) {
  if (!msg || store.get('replayingHistory') || msg.slug !== store.get('currentSlug') || store.get('paneMode')) return false;
  return autoStartLoginIfNeeded(msg);
}

// ========================================================
// Incoming
// ========================================================

export function handleVendorLoginReady(msg) {
  if (!msg || typeof msg.terminalId !== "number" || !personalLoginCurrent(msg)) return;
  var vendor = msg.vendor || "claude";
  var request = (store.get('workerVendorLoginRequests') || {})[vendor];
  if (msg.workerAuthRequestId && (!workerContextMatches(request) || request.requestId !== msg.workerAuthRequestId)) return;
  delete pendingStarts[vendor];
  activeFlows[vendor] = { terminalId: msg.terminalId, startedAt: Date.now(), browserId: msg.browserId || null, workerAuthRequestId: msg.workerAuthRequestId || null };
  if (msg.browserId) {
    openLoginBrowser(msg);
    return;
  }

  var slug = msg.slug || currentProjectSlug();
  if (!slug) return;
  modalVendor = vendor;
  openTuiModal(msg.terminalId, slug, {
    sessionTitle: vendorDisplayName(vendor) + " login",
    projectName: slug,
    compact: true,
    // Dismissing the modal abandons the login: kill the terminal server-side
    // so it never lingers in the sidebar terminal list.
    onClose: function () {
      if (closingModalInternally) return;
      modalVendor = null;
      cancelVendorLogin(vendor);
    },
  });
}

export function handleVendorLoginState(msg) {
  if (!msg) return;
  pendingStarts = Object.create(null);
  var next = Object.create(null);
  var flows = msg.flows || [];
  for (var i = 0; i < flows.length; i++) {
    if (!personalLoginCurrent(flows[i])) continue;
    next[flows[i].vendor] = { terminalId: flows[i].terminalId, startedAt: flows[i].startedAt, browserId: flows[i].browserId || null, workerAuthRequestId: flows[i].workerAuthRequestId || null };
    delete pendingStarts[flows[i].vendor];
  }

  // A flow the server dropped without an auth_refreshed (cancelled elsewhere,
  // terminal killed from the sidebar) must not leave a stale modal behind.
  var previous = Object.keys(activeFlows);
  for (var p = 0; p < previous.length; p++) {
    if (!next[previous[p]] && modalVendor === previous[p]) {
      closeModalInternally();
      clearLoginBanners();
    }
  }
  activeFlows = next;
  var browser = store.get('vendorLoginBrowser');
  if (browser && (!next[browser.vendor] || next[browser.vendor].browserId !== browser.browserId)) {
    closeLoginBrowser();
    clearLoginBanners();
  }
}

export function handleAuthRefreshed(msg) {
  if (!msg || !personalLoginCurrent(msg)) return;
  var vendor = msg.vendor || "claude";
  var request = (store.get('workerVendorLoginRequests') || {})[vendor];
  if (msg.workerAuthRequestId && (!workerContextMatches(request) || request.requestId !== msg.workerAuthRequestId)) return;
  forgetWorkerRequest(vendor);
  var browser = store.get('vendorLoginBrowser');
  if (browser && browser.vendor === vendor) closeLoginBrowser();
  var flow = activeFlows[vendor];
  delete pendingStarts[vendor];
  delete activeFlows[vendor];
  closeModalForVendor(vendor, flow ? flow.terminalId : undefined);
  clearLoginBanners();
  showLoginCompleteBanner(vendor);
}

export function handleVendorLoginError(msg) {
  if (!msg || !personalLoginCurrent(msg)) return;
  var vendor = msg.vendor || "claude";
  forgetWorkerRequest(vendor);
  var browser = store.get('vendorLoginBrowser');
  if (browser && browser.vendor === vendor) closeLoginBrowser();
  delete pendingStarts[vendor];
  delete activeFlows[vendor];
  if (modalVendor === vendor) closeModalInternally();
  clearLoginBanners();
  showLoginErrorBanner(vendor, msg.error);
}

export function requestVendorLoginState() {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "vendor_login_state_request" }));
}

export function getActiveLoginFlow(vendor) {
  return activeFlows[vendor] || null;
}

store.subscribe(function (state, previous) {
  var requests = state.workerVendorLoginRequests || {};
  Object.keys(requests).forEach(function (vendor) {
    if (workerContextMatches(requests[vendor]) && state.connected !== false) return;
    if (requests[vendor].slug === state.currentSlug && requests[vendor].socketGeneration === state.projectSplitViewSocketGeneration) cancelVendorLogin(vendor);
    else forgetWorkerRequest(vendor);
  });
  if (state.connected !== false || previous.connected === false) return;
  pendingStarts = Object.create(null);
  activeFlows = Object.create(null);
  closeLoginBrowser();
  closeModalInternally();
  clearLoginBanners();
});
