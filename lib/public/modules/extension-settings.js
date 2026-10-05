import { openMcpSkillsWorkbench } from "./mcp-skills-workbench.js";
import { copyToClipboard, showToast } from "./utils.js";
import { iconHtml, refreshIcons } from "./icons.js";

export function initExtensionSettings() {
  var extPillWrap = document.getElementById("ext-pill-wrap");
  var extPillBtn = document.getElementById("ext-pill");
  var extPopover = document.getElementById("ext-popover");
  var extDownloadBtn = document.getElementById("ext-download-btn");
  var extDownloadStatus = document.getElementById("ext-download-status");
  var extCopyUrl = document.getElementById("ext-copy-url");
  if (!extPillWrap || !extPillBtn || !extPopover) return;

  // Detect extension connection via postMessage from content.js

  var connectedBanner = document.getElementById("ext-connected-banner");
  var extDivider = document.getElementById("ext-popover-divider");
  var extGuideTitle = document.getElementById("ext-popover-guide-title");
  var extSteps = extPopover.querySelector(".ext-popover-steps");

  function setExtConnected() {
    if (extPillBtn.classList.contains("ext-connected")) return;
    extPillBtn.classList.add("ext-connected");
    extPillBtn.innerHTML = '<i data-lucide="check"></i> Extension';
    refreshIcons(extPillBtn);
    if (connectedBanner) connectedBanner.classList.remove("hidden");
    if (extDownloadBtn) extDownloadBtn.style.display = "none";
    if (extDownloadStatus) extDownloadStatus.classList.add("hidden");
    if (extDivider) extDivider.style.display = "none";
    if (extGuideTitle) extGuideTitle.style.display = "none";
    if (extSteps) extSteps.style.display = "none";
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "clay-chrome-extension") return;
    setExtConnected();
  });

  // Toggle popover
  extPillBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    openMcpSkillsWorkbench("mcp");
    var expanded = extPopover.classList.toggle("visible");
    extPillBtn.setAttribute("aria-expanded", String(expanded));
    refreshIcons(extPopover);
  });

  document.addEventListener("click", function (e) {
    if (!extPopover.contains(e.target) && e.target !== extPillBtn && !extPillBtn.contains(e.target)) {
      extPopover.classList.remove("visible");
      extPillBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Download button
  if (extDownloadBtn) {
    extDownloadBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      extDownloadBtn.disabled = true;
      extDownloadBtn.innerHTML = iconHtml("loader") + " Downloading...";
      refreshIcons(extDownloadBtn);
      var loaderIcon = extDownloadBtn.querySelector(".lucide");
      if (loaderIcon) loaderIcon.style.animation = "spin 1s linear infinite";
      if (extDownloadStatus) {
        extDownloadStatus.classList.remove("hidden");
        extDownloadStatus.textContent = "Fetching from GitHub...";
        extDownloadStatus.style.color = "";
      }
      fetch("/api/extension/download").then(function (resp) {
        if (!resp.ok) throw new Error("Download failed (" + resp.status + ")");
        return resp.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "clay-chrome-extension.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (extDownloadStatus) {
          extDownloadStatus.textContent = "Download complete!";
          extDownloadStatus.style.color = "var(--accent)";
        }
        showToast("Extension downloaded");
      }).catch(function (err) {
        if (extDownloadStatus) {
          extDownloadStatus.textContent = "Failed: " + err.message;
          extDownloadStatus.style.color = "var(--danger, #e53935)";
        }
        showToast("Download failed");
      }).finally(function () {
        extDownloadBtn.disabled = false;
        extDownloadBtn.innerHTML = iconHtml("download") + " Download Extension (.zip)";
        refreshIcons(extDownloadBtn);
      });
    });
  }

  // Copy chrome://extensions URL
  if (extCopyUrl) {
    extCopyUrl.addEventListener("click", function (e) {
      e.stopPropagation();
      copyToClipboard("chrome://extensions").then(function () {
        showToast("Copied chrome://extensions");
      });
    });
  }
}
