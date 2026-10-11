import { copyToClipboard } from './utils.js';

var activeShareUrl = null;
var activeShareTitle = null;

export function getShareUrl(projectSlug) {
  var locationUrl = new URL(window.location.href);
  if (projectSlug) {
    var projectIndex = locationUrl.pathname.indexOf("/p/");
    var prefix = projectIndex === -1 ? "" : locationUrl.pathname.substring(0, projectIndex);
    locationUrl.pathname = prefix + "/p/" + encodeURIComponent(projectSlug) + "/";
    locationUrl.search = "";
    locationUrl.hash = "";
  }
  var url = locationUrl.href;
  var h = window.location.hostname;
  if ((h === "localhost" || h === "127.0.0.1") && window.__lanHost) {
    url = url.replace(h + ":" + window.location.port, window.__lanHost);
  }
  return url;
}

export function triggerShare(options) {
  options = options || {};
  var url = getShareUrl(options.projectSlug);
  var title = options.title || document.title || "Clay";

  // Use Web Share API on mobile only
  var isMobile = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
  if (isMobile && navigator.share) {
    navigator.share({ title: title, url: url }).catch(function () {});
    return;
  }

  // Show QR overlay
  var qrOverlay = document.getElementById("qr-overlay");
  var qrCanvas = document.getElementById("qr-canvas");
  var qrUrl = document.getElementById("qr-url");
  var qrShareBtn = document.getElementById("qr-share-btn");

  var qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  activeShareUrl = url;
  activeShareTitle = title;
  qrCanvas.innerHTML = qr.createSvgTag(5, 0);
  qrUrl.innerHTML = url + '<span class="qr-hint">click to copy</span>';

  // Show browser share button if Web Share API is available
  if (qrShareBtn) {
    if (navigator.share) {
      qrShareBtn.classList.remove("hidden");
    } else {
      qrShareBtn.classList.add("hidden");
    }
  }

  qrOverlay.classList.remove("hidden");
}

export function initQrCode() {
  var qrOverlay = document.getElementById("qr-overlay");
  var qrUrl = document.getElementById("qr-url");

  // click URL to copy
  qrUrl.addEventListener("click", function () {
    var url = activeShareUrl || getShareUrl();
    copyToClipboard(url).then(function () {
      qrUrl.innerHTML = "Copied!";
      qrUrl.classList.add("copied");
      setTimeout(function () {
        qrUrl.innerHTML = url + '<span class="qr-hint">click to copy</span>';
        qrUrl.classList.remove("copied");
      }, 1500);
    });
  });

  qrOverlay.addEventListener("click", function () {
    qrOverlay.classList.add("hidden");
    activeShareUrl = null;
    activeShareTitle = null;
  });

  // prevent closing when clicking the inner card
  document.getElementById("qr-overlay-inner").addEventListener("click", function (e) {
    e.stopPropagation();
  });

  // Browser share button
  var qrShareBtn = document.getElementById("qr-share-btn");
  if (qrShareBtn) {
    qrShareBtn.addEventListener("click", function () {
      var url = activeShareUrl || getShareUrl();
      navigator.share({ title: activeShareTitle || document.title || "Clay", url: url }).catch(function () {});
    });
  }

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !qrOverlay.classList.contains("hidden")) {
      qrOverlay.classList.add("hidden");
      activeShareUrl = null;
      activeShareTitle = null;
    }
  });
}
