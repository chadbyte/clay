import { copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;
var basePath = "/";
var onboardingPill, onboardingText, onboardingClose, onboardingDismissed;
var notifAlertEnabled, notifSoundEnabled, notifPermission;
var audioCtx = null;

export function isNotifAlertEnabled() { return notifAlertEnabled; }
export function isNotifSoundEnabled() { return notifSoundEnabled; }
export function getNotifPermission() { return notifPermission; }

export function showOnboarding(html) {
  onboardingText.innerHTML = html;
  onboardingPill.classList.remove("hidden");
  refreshIcons();
}

export function hideOnboarding() {
  onboardingPill.classList.add("hidden");
}

export function playDoneSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch(e) {}
}

export function showDoneNotification() {
  var lastAssistant = ctx.messagesEl.querySelector(".msg-assistant:last-of-type .md-content");
  var preview = lastAssistant ? lastAssistant.textContent.substring(0, 100) : "Response ready";

  var sessionTitle = "Claude";
  var activeItem = ctx.sessionListEl.querySelector(".session-item.active");
  if (activeItem) {
    var textEl = activeItem.querySelector(".session-item-text");
    if (textEl) sessionTitle = textEl.textContent || "Claude";
    else sessionTitle = activeItem.textContent || "Claude";
  }

  var n = new Notification(sessionTitle, {
    body: preview,
    tag: "claude-done",
  });

  n.onclick = function() {
    window.focus();
    n.close();
  };

  setTimeout(function() { n.close(); }, 5000);
}

export function initNotifications(_ctx) {
  ctx = _ctx;
  basePath = ctx.basePath || "/";
  var $ = ctx.$;

  // --- Mobile viewport (iOS keyboard handling) ---
  if (window.visualViewport) {
    var layout = $("layout");
    function onViewportChange() {
      layout.style.height = window.visualViewport.height + "px";
      document.documentElement.scrollTop = 0;
      ctx.scrollToBottom();
    }
    window.visualViewport.addEventListener("resize", onViewportChange);
    window.visualViewport.addEventListener("scroll", onViewportChange);
  }

  // --- Update pill badge ---
  (function () {
    var pillWrap = $("update-pill-wrap");
    var pillBtn = $("update-pill");
    var popover = $("update-popover");
    var updateNowBtn = $("update-now");
    if (!pillWrap) return;

    var copyBtn = popover.querySelector(".popover-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        copyToClipboard("npx clay-server@latest").then(function () {
          copyBtn.classList.add("copied");
          copyBtn.innerHTML = iconHtml("check");
          refreshIcons();
          setTimeout(function () {
            copyBtn.classList.remove("copied");
            copyBtn.innerHTML = iconHtml("copy");
            refreshIcons();
          }, 1500);
        });
      });
    }

    // "Update now" button — trigger server-side update + restart
    if (updateNowBtn) {
      updateNowBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "update_now" }));
          var textNode = updateNowBtn.lastChild;
          if (textNode) textNode.textContent = " Updating...";
          updateNowBtn.disabled = true;
        }
      });
    }

    // Toggle popover on pill click
    if (pillBtn) {
      pillBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        popover.classList.toggle("visible");
      });
    }

    document.addEventListener("click", function (e) {
      if (!popover.contains(e.target) && e.target !== pillBtn && !pillBtn.contains(e.target)) {
        popover.classList.remove("visible");
      }
    });
  })();

  // --- Settings: Check for updates ---
  (function () {
    var settingsUpdateCheck = $("settings-update-check");

    function setUpdateBtn(label, spin, disabled) {
      if (!settingsUpdateCheck) return;
      var icon = settingsUpdateCheck.querySelector(".lucide, [data-lucide]");
      if (icon) {
        icon.setAttribute("data-lucide", spin ? "loader" : "refresh-cw");
        if (spin) icon.classList.add("icon-spin-inline");
        else icon.classList.remove("icon-spin-inline");
      }
      // Update text node
      settingsUpdateCheck.innerHTML = "";
      var i = document.createElement("i");
      i.setAttribute("data-lucide", spin ? "loader" : (disabled ? "check" : "refresh-cw"));
      settingsUpdateCheck.appendChild(i);
      settingsUpdateCheck.appendChild(document.createTextNode(" " + label));
      settingsUpdateCheck.disabled = disabled;
      refreshIcons();
      if (spin) {
        var newIcon = settingsUpdateCheck.querySelector(".lucide");
        if (newIcon) newIcon.classList.add("icon-spin-inline");
      }
    }

    if (settingsUpdateCheck) {
      settingsUpdateCheck.addEventListener("click", function (e) {
        e.stopPropagation();
        if (ctx.ws && ctx.connected) {
          ctx.ws.send(JSON.stringify({ type: "check_update" }));
        }
        setUpdateBtn("Checking…", true, true);
        setTimeout(function () {
          if (settingsUpdateCheck.disabled) {
            setUpdateBtn("Up to date", false, true);
            setTimeout(function () {
              setUpdateBtn("Check for updates", false, false);
            }, 1500);
          }
        }, 2000);
      });
    }

    // --- Footer status (title bar) ---
    var footerStatus = $("footer-status");
    if (footerStatus) {
      footerStatus.addEventListener("click", function (e) {
        e.stopPropagation();
        if (ctx.toggleStatusPanel) ctx.toggleStatusPanel();
      });
    }
  })();

  // --- Onboarding pill badge (HTTPS / Push) ---
  onboardingPill = $("onboarding-pill");
  onboardingText = $("onboarding-pill-text");
  onboardingClose = $("onboarding-pill-close");
  onboardingDismissed = localStorage.getItem("onboarding-dismissed");

  if (onboardingClose) {
    onboardingClose.addEventListener("click", function () {
      hideOnboarding();
      localStorage.setItem("onboarding-dismissed", "1");
      onboardingDismissed = "1";
    });
  }

  // Suggest HTTPS setup for push notification support
  if (location.protocol !== "https:" && location.hostname !== "localhost") {
    if (!onboardingDismissed) {
      showOnboarding(
        iconHtml("bell-ring") +
        ' <a href="/setup">Set up HTTPS</a>'
      );
    }
  }

  // --- Tooltip ---
  var tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip";
  document.body.appendChild(tooltipEl);
  var tooltipTimer = null;

  function showTooltipAt(target) {
    tooltipEl.textContent = target.dataset.tip;
    tooltipEl.style.top = "-9999px";
    tooltipEl.style.left = "0";
    tooltipEl.style.right = "";
    tooltipEl.style.transform = "";
    tooltipEl.classList.add("visible");
    var tipW = tooltipEl.offsetWidth;
    var rect = target.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var leftPos = centerX - tipW / 2;
    tooltipEl.style.top = (rect.bottom + 8) + "px";
    if (leftPos + tipW > window.innerWidth - 8) {
      tooltipEl.style.left = "";
      tooltipEl.style.right = "8px";
    } else {
      tooltipEl.style.left = Math.max(8, leftPos) + "px";
      tooltipEl.style.right = "";
    }
  }

  function hideTooltip() {
    tooltipEl.classList.remove("visible");
    clearTimeout(tooltipTimer);
  }

  document.addEventListener("click", function (e) {
    var target = e.target.closest("[data-tip]");
    if (target) {
      showTooltipAt(target);
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(hideTooltip, 2000);
    } else {
      hideTooltip();
    }
  });

  document.addEventListener("mouseover", function (e) {
    var target = e.target.closest("[data-tip]");
    if (target) {
      clearTimeout(tooltipTimer);
      showTooltipAt(target);
    }
  });

  document.addEventListener("mouseout", function (e) {
    var target = e.target.closest("[data-tip]");
    if (target) {
      hideTooltip();
    }
  });

  // --- iOS Safari detection ---
  var isIOSSafari = (function () {
    var ua = navigator.userAgent;
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
    return isSafari;
  })();
  var isStandalone = window.matchMedia("(display-mode:standalone)").matches || navigator.standalone;

  // --- Browser notifications ---
  notifPermission = ("Notification" in window) ? Notification.permission : "denied";
  notifAlertEnabled = localStorage.getItem("notif-alert") !== "0";
  notifSoundEnabled = localStorage.getItem("notif-sound") !== "0";

  var notifBtn = $("notif-btn");
  var notifMenu = $("notif-menu");
  var notifToggleAlert = $("notif-toggle-alert");
  var notifToggleSound = $("notif-toggle-sound");

  if (notifAlertEnabled && "Notification" in window && Notification.permission === "denied") {
    notifAlertEnabled = false;
    localStorage.setItem("notif-alert", "0");
  }
  notifToggleAlert.checked = notifAlertEnabled;
  notifToggleSound.checked = notifSoundEnabled;

  notifBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = notifMenu.classList.toggle("hidden");
    notifBtn.classList.toggle("active", !open);
  });

  document.addEventListener("click", function (e) {
    if (!notifMenu.contains(e.target) && e.target !== notifBtn) {
      notifMenu.classList.add("hidden");
      notifBtn.classList.remove("active");
    }
  });

  var notifBlockedHint = $("notif-blocked-hint");

  notifToggleAlert.addEventListener("change", function () {
    notifAlertEnabled = notifToggleAlert.checked;
    localStorage.setItem("notif-alert", notifAlertEnabled ? "1" : "0");
    notifBlockedHint.classList.add("hidden");
    if (notifAlertEnabled && notifPermission !== "granted") {
      if ("Notification" in window && Notification.permission === "denied") {
        notifAlertEnabled = false;
        notifToggleAlert.checked = false;
        localStorage.setItem("notif-alert", "0");
        notifBlockedHint.classList.remove("hidden");
        refreshIcons();
        return;
      }
      Notification.requestPermission().then(function (p) {
        notifPermission = p;
        if (p !== "granted") {
          notifAlertEnabled = false;
          notifToggleAlert.checked = false;
          localStorage.setItem("notif-alert", "0");
          notifBlockedHint.classList.remove("hidden");
          refreshIcons();
        }
      });
    }
  });

  // --- Notification help modal ---
  var notifHelpModal = $("notif-help-modal");
  var notifHelpClose = $("notif-help-close");
  var notifLearnMore = $("notif-learn-more");
  var notifUrlCopy = $("notif-url-copy");
  var notifSettingsUrl = $("notif-settings-url");

  // Detect browser and set correct settings URL
  (function () {
    var url = "chrome://settings/content/notifications";
    var ua = navigator.userAgent;
    if (ua.indexOf("Firefox") !== -1) url = "about:preferences#privacy";
    else if (ua.indexOf("Edg/") !== -1) url = "edge://settings/content/notifications";
    else if (ua.indexOf("Arc") !== -1) url = "arc://settings/content/notifications";
    else if (isIOSSafari) url = "Settings > Safari > Notifications";
    notifSettingsUrl.textContent = url;
  })();

  notifLearnMore.addEventListener("click", function (e) {
    e.preventDefault();
    notifHelpModal.classList.remove("hidden");
    refreshIcons();
  });

  notifHelpClose.addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifHelpModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    notifHelpModal.classList.add("hidden");
  });

  notifUrlCopy.addEventListener("click", function () {
    copyToClipboard(notifSettingsUrl.textContent).then(function () {
      notifUrlCopy.classList.add("copied");
      notifUrlCopy.innerHTML = iconHtml("check");
      refreshIcons();
      setTimeout(function () {
        notifUrlCopy.classList.remove("copied");
        notifUrlCopy.innerHTML = iconHtml("copy");
        refreshIcons();
      }, 1500);
    });
  });

  notifToggleSound.addEventListener("change", function () {
    notifSoundEnabled = notifToggleSound.checked;
    localStorage.setItem("notif-sound", notifSoundEnabled ? "1" : "0");
  });

  // --- Push notifications toggle ---
  var notifPushRow = $("notif-push-row");
  var notifTogglePush = $("notif-toggle-push");
  var pushAvailable = ("serviceWorker" in navigator) &&
    (location.protocol === "https:" || location.hostname === "localhost");

  // On iOS Safari (not in PWA mode), replace the push toggle with an info hint
  if (isIOSSafari && !isStandalone) {
    var infoRow = document.createElement("div");
    infoRow.className = "notif-option notif-ios-info";
    infoRow.style.display = "flex";
    infoRow.innerHTML =
      '<span><i data-lucide="smartphone" style="width:14px;height:14px"></i> Push notifications</span>' +
      '<button class="notif-ios-info-btn" title="Info"><i data-lucide="info" style="width:14px;height:14px"></i></button>';
    notifPushRow.parentNode.replaceChild(infoRow, notifPushRow);

    var iosHint = document.createElement("div");
    iosHint.id = "notif-ios-hint";
    iosHint.className = "hidden";
    iosHint.innerHTML =
      'To enable push notifications on iOS, tap <strong>Share</strong> ' +
      '<i data-lucide="share" style="width:12px;height:12px;vertical-align:-2px"></i> ' +
      'then <strong>Add to Home Screen</strong>. ' +
      'Push notifications work inside the installed app.';
    infoRow.parentNode.insertBefore(iosHint, infoRow.nextSibling);

    infoRow.querySelector(".notif-ios-info-btn").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      iosHint.classList.toggle("hidden");
      refreshIcons();
    });
    refreshIcons();
  } else if (pushAvailable) {
    notifPushRow.style.display = "flex";
  }

  function sendPushSubscription(sub) {
    var prevEndpoint = localStorage.getItem("push-endpoint");
    window._pushSubscription = sub;
    localStorage.setItem("push-endpoint", sub.endpoint);
    var json = sub.toJSON();
    var payload = { subscription: json };
    if (prevEndpoint && prevEndpoint !== sub.endpoint) {
      payload.replaceEndpoint = prevEndpoint;
    }
    if (ctx.ws && ctx.ws.readyState === 1) {
      ctx.ws.send(JSON.stringify({ type: "push_subscribe", subscription: json, replaceEndpoint: payload.replaceEndpoint || null }));
    } else {
      fetch(basePath + "api/push-subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify(payload),
      });
    }
  }

  function subscribePush() {
    navigator.serviceWorker.ready.then(function (reg) {
      return fetch(basePath + "api/vapid-public-key", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.publicKey) throw new Error("No VAPID key");
          var raw = atob(data.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
          var key = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        });
    }).then(function (sub) {
      sendPushSubscription(sub);
      localStorage.setItem("notif-push", "1");
      hideOnboarding();
      localStorage.setItem("onboarding-dismissed", "1");
      // Show a welcome notification so the user knows it works
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification("\ud83c\udf89 Welcome to Clay!", {
          body: "\ud83d\udd14 You\u2019ll be notified when Claude responds.",
          tag: "claude-welcome",
        });
      }).catch(function () {});
    }).catch(function () {
      notifTogglePush.checked = false;
      localStorage.setItem("notif-push", "0");
      notifBlockedHint.classList.remove("hidden");
      refreshIcons();
    });
  }

  function unsubscribePush() {
    if (window._pushSubscription) {
      window._pushSubscription.unsubscribe().catch(function () {});
      window._pushSubscription = null;
    }
    localStorage.setItem("notif-push", "0");
  }

  notifTogglePush.addEventListener("change", function () {
    if (notifTogglePush.checked) {
      notifBlockedHint.classList.add("hidden");
      subscribePush();
    } else {
      unsubscribePush();
    }
  });

  // --- Service Worker registration & push state sync ---
  (function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js")
      .then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) {
        // Fetch current VAPID key to detect key changes
        var vapidPromise = fetch(basePath + "api/vapid-public-key", { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) { return d.publicKey || null; })
          .catch(function () { return null; });

        return Promise.all([reg.pushManager.getSubscription(), vapidPromise]).then(function (results) {
          var sub = results[0];
          var serverKey = results[1];

          // If subscription exists but VAPID key changed, unsubscribe and re-subscribe
          if (sub && serverKey) {
            var savedKey = localStorage.getItem("vapid-key");
            if (savedKey && savedKey !== serverKey) {
              sub.unsubscribe().catch(function () {});
              sub = null;
            }
          }
          if (serverKey) localStorage.setItem("vapid-key", serverKey);

          if (sub) {
            window._pushSubscription = sub;
            notifTogglePush.checked = true;
            sendPushSubscription(sub);
            hideOnboarding();
          } else if (serverKey && localStorage.getItem("notif-push") === "1") {
            // Had push enabled but subscription is gone (VAPID key change), re-subscribe
            var raw = atob(serverKey.replace(/-/g, "+").replace(/_/g, "/"));
            var key = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
            reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
              .then(function (newSub) {
                sendPushSubscription(newSub);
                notifTogglePush.checked = true;
              }).catch(function () {
                notifTogglePush.checked = false;
                localStorage.setItem("notif-push", "0");
              });
          } else {
            notifTogglePush.checked = false;
            localStorage.setItem("notif-push", "0");
            // Standalone (PWA) without push: redirect to setup for push onboarding
            // Skip if setup was just completed (setup-done flag)
            var isStandalone = window.matchMedia("(display-mode:standalone)").matches || navigator.standalone;
            if (isStandalone && !localStorage.getItem("setup-done")) {
              var isTailscale = /^100\./.test(location.hostname);
              location.href = "/setup" + (isTailscale ? "" : "?mode=lan");
              return;
            }
            // Browser: show onboarding banner
            if (!onboardingDismissed) {
              showOnboarding(
                iconHtml("bell-ring") +
                ' <button class="onboarding-cta" id="onboarding-enable-push">Enable push</button>'
              );
              var enableBtn = $("onboarding-enable-push");
              if (enableBtn) {
                enableBtn.addEventListener("click", function () {
                  subscribePush();
                  notifTogglePush.checked = true;
                  hideOnboarding();
                  localStorage.setItem("onboarding-dismissed", "1");
                });
              }
            }
          }
        });
      })
      .catch(function () {});
  })();

  // --- Debug panel ---
  (function () {
    var debugBtn = $("debug-btn");
    var debugMenu = $("debug-menu");
    if (!debugBtn || !debugMenu) return;

    var debugToggleUpdate = $("debug-toggle-update");
    var debugToggleOnboarding = $("debug-toggle-onboarding");

    debugBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = debugMenu.classList.toggle("hidden");
      debugBtn.classList.toggle("active", !open);

      // Sync toggle states with current pill visibility
      var updatePillWrap = $("update-pill-wrap");
      if (debugToggleUpdate && updatePillWrap) {
        debugToggleUpdate.checked = !updatePillWrap.classList.contains("hidden");
      }
      if (debugToggleOnboarding && onboardingPill) {
        debugToggleOnboarding.checked = !onboardingPill.classList.contains("hidden");
      }
    });

    document.addEventListener("click", function (e) {
      if (!debugMenu.contains(e.target) && e.target !== debugBtn) {
        debugMenu.classList.add("hidden");
        debugBtn.classList.remove("active");
      }
    });

    if (debugToggleUpdate) {
      debugToggleUpdate.addEventListener("change", function () {
        var pillWrap = $("update-pill-wrap");
        if (!pillWrap) return;
        if (debugToggleUpdate.checked) {
          // Trigger real update check from server (debug mode uses v0.0.9)
          if (ctx.ws && ctx.connected) {
            ctx.ws.send(JSON.stringify({ type: "check_update" }));
          }
        } else {
          pillWrap.classList.add("hidden");
        }
        refreshIcons();
      });
    }

    if (debugToggleOnboarding) {
      debugToggleOnboarding.addEventListener("change", function () {
        if (debugToggleOnboarding.checked) {
          if (!onboardingText.innerHTML.trim()) {
            showOnboarding(
              iconHtml("bell-ring") +
              ' <a href="/setup">Set up HTTPS</a>'
            );
          } else {
            onboardingPill.classList.remove("hidden");
          }
        } else {
          hideOnboarding();
        }
      });
    }
  })();
}
