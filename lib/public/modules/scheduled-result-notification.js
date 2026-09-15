import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml } from './utils.js';

function removeBanner(banner) {
  if (!banner || !banner.parentNode) return;
  banner.classList.remove("show");
  setTimeout(function () { if (banner.parentNode) banner.remove(); }, 220);
}

export function showScheduledResultNotification(title, body, onOpen) {
  var container = document.querySelector(".notif-banner-container");
  if (!container) return false;
  var banner = document.createElement("div");
  banner.className = "notif-banner";
  banner.innerHTML =
    '<div class="notif-banner-icon">' + iconHtml("calendar-check") + '</div>' +
    '<div class="notif-banner-body"><div class="notif-banner-project">SCHEDULED TASKS</div>' +
      '<div class="notif-banner-title">' + escapeHtml(title || "Scheduled task finished") + '</div>' +
      (body ? '<div class="notif-banner-text">' + escapeHtml(body) + '</div>' : '') +
      '<div class="notif-banner-actions"><button class="notif-banner-result-open">View result</button></div></div>' +
    '<button class="notif-banner-close" aria-label="Dismiss notification">' + iconHtml("x") + '</button>';
  container.appendChild(banner);
  refreshIcons(banner);
  requestAnimationFrame(function () { banner.classList.add("show"); });
  banner.querySelector(".notif-banner-result-open").addEventListener("click", function (event) {
    event.stopPropagation(); removeBanner(banner); if (typeof onOpen === "function") onOpen();
  });
  banner.querySelector(".notif-banner-close").addEventListener("click", function (event) { event.stopPropagation(); removeBanner(banner); });
  setTimeout(function () { removeBanner(banner); }, 8000);
  return true;
}
