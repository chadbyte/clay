import { copyToClipboard } from './utils.js';

function getShareUrl() {
  var url = window.location.href;
  var h = window.location.hostname;
  if ((h === "localhost" || h === "127.0.0.1") && window.__lanHost) {
    url = url.replace(h + ":" + window.location.port, window.__lanHost);
  }
  return url;
}

export function triggerShare() {
  var url = getShareUrl();

  // Use Web Share API if available
  if (navigator.share) {
    navigator.share({ title: document.title || "Clay", url: url }).catch(function () {});
    return;
  }

  // Fallback: show QR overlay
  var qrOverlay = document.getElementById("qr-overlay");
  var qrCanvas = document.getElementById("qr-canvas");
  var qrUrl = document.getElementById("qr-url");

  var qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  qrCanvas.innerHTML = qr.createSvgTag(5, 0);
  qrUrl.innerHTML = url + '<span class="qr-hint">click to copy</span>';

  qrOverlay.classList.remove("hidden");
}

export function initQrCode() {
  var qrOverlay = document.getElementById("qr-overlay");
  var qrUrl = document.getElementById("qr-url");

  // click URL to copy
  qrUrl.addEventListener("click", function () {
    var url = getShareUrl();
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
  });

  // prevent closing when clicking the inner card
  document.getElementById("qr-overlay-inner").addEventListener("click", function (e) {
    e.stopPropagation();
  });

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !qrOverlay.classList.contains("hidden")) {
      qrOverlay.classList.add("hidden");
    }
  });
}
