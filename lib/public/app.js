import { showToast, copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml, randomThinkingVerb } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal, parseEmojis } from './modules/markdown.js';
import { initSidebar, closeSidebar, renderSessionList, handleSearchResults, updateSessionPresence, updateAgentStatus, getAttentionSessionIds, updatePageTitle, getActiveSearchQuery, buildSearchTimeline, removeSearchTimeline, populateCliSessionList, renderIconStrip, renderSidebarPresence, initIconStrip, getEmojiCategories, renderUserStrip, setCurrentDmUser, updateDmBadge } from './modules/sidebar.js';
import { initRewind, setRewindMode, isRewindMode, showRewindModal, clearPendingRewindUuid, addRewindButton } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync, autoResize, builtinCommands, sendMessage } from './modules/input.js';
import { initQrCode } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, refreshTree, handleFsList, handleFsRead, handleDirChanged, refreshIfOpen, handleFileChanged, handleFileHistory, handleGitDiff, handleFileAt, getPendingNavigate, closeFileViewer, resetFileBrowser, openFile } from './modules/filebrowser.js';
import { initTerminal, openTerminal, closeTerminal, resetTerminals, handleTermList, handleTermCreated, handleTermOutput, handleTermExited, handleTermClosed, sendTerminalCommand } from './modules/terminal.js';
import { initStickyNotes, handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted, openArchive, closeArchive, isArchiveOpen } from './modules/sticky-notes.js';
import { initTheme, getThemeColor, getComputedVar, onThemeChange, getCurrentTheme } from './modules/theme.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderElicitationRequest, markElicitationResolved, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, updateSubagentProgress, initSubagentStop, closeToolGroup, removeToolFromGroup } from './modules/tools.js';
import { initServerSettings, updateSettingsStats, updateSettingsModels, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './modules/server-settings.js';
import { initProjectSettings, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, isProjectSettingsOpen, handleProjectSharedEnv, handleProjectSharedEnvSaved } from './modules/project-settings.js';
import { initSkills, handleSkillInstalled, handleSkillUninstalled } from './modules/skills.js';
import { initScheduler, resetScheduler, handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, openSchedulerToTab, isSchedulerOpen, closeScheduler, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles, getUpcomingSchedules } from './modules/scheduler.js';
import { initAsciiLogo, startLogoAnimation, stopLogoAnimation } from './modules/ascii-logo.js';
import { initPlaybook, openPlaybook, getPlaybooks, getPlaybookForTip, isCompleted as isPlaybookCompleted } from './modules/playbook.js';
import { initSTT } from './modules/stt.js';
import { initProfile } from './modules/profile.js';
import { initAdmin, checkAdminAccess } from './modules/admin.js';
import { initPaneManager, createPane, splitPane, setFocusedPane, getFocusedPane, getPaneCount, getSessionPanes, connectPane, getPanes } from './modules/pane-manager.js';
import { initPaneRenderer, getPrimaryRenderer, createPaneRenderer } from './modules/pane-renderer.js';

// --- Base path for multi-project routing ---
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var basePath = slugMatch ? "/p/" + slugMatch[1] + "/" : "/";
  var wsPath = slugMatch ? "/p/" + slugMatch[1] + "/ws" : "/ws";

// --- DOM refs ---
  var primaryPaneEl = document.querySelector('.pane[data-pane-id="primary"]');
  var $ = function (name) { return primaryPaneEl.querySelector('.pane-' + name); };
  var $g = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  function getStatusDot() {
    return document.querySelector("#icon-strip-projects .icon-strip-item.active .icon-strip-status");
  }
  var headerTitleEl = $("header-title");
  var headerRenameBtn = $("header-rename-btn");
  var slashMenu = $("slash-menu");
  var suggestionChipsEl = $("suggestion-chips");
  var sidebar = $g("sidebar");
  var sidebarOverlay = $g("sidebar-overlay");
  var sessionListEl = $g("session-list");
  var newSessionBtn = $g("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var sidebarToggleBtn = $g("sidebar-toggle-btn");
  var sidebarExpandBtn = $("sidebar-expand-btn");
  var resumeSessionBtn = $g("resume-session-btn");
  var imagePreviewBar = $("image-preview-bar");
  var connectOverlay = $("connect-overlay");

  // --- DM Mode ---
  var dmMode = false;
  var dmKey = null;
  var dmTargetUser = null;
  var dmUnread = {}; // { otherUserId: count }
  var cachedAllUsers = [];

  // --- Home Hub ---
  var homeHub = $g("home-hub");
  var homeHubVisible = false;
  var hubSchedules = [];

  var hubTips = [
    "Sticky notes let you pin important info that persists across sessions.",
    "You can run terminal commands directly from the terminal tab — no need to switch windows.",
    "Rename your sessions to keep conversations organized and easy to find later.",
    "The file browser lets you explore and open any file in your project.",
    "Paste images from your clipboard into the chat to include them in your message.",
    "Use /commands (slash commands) for quick access to common actions.",
    "You can resize the sidebar by dragging its edge.",
    "Click the session info button in the header to see token usage and costs.",
    "You can switch between projects without losing your conversation history.",
    "The status dot on project icons shows whether Claude is currently processing.",
    "Right-click on a project icon for quick actions like rename or delete.",
    "Push notifications can alert you when Claude finishes a long task.",
    "You can search through your conversation history within a session.",
    "Session history is preserved — come back anytime to continue where you left off.",
    "Use the rewind feature to go back to an earlier point in your conversation.",
    "You can open multiple terminal tabs for parallel command execution.",
    "Clay works offline as a PWA — install it from your browser for quick access.",
    "Schedule recurring tasks with cron expressions to automate your workflow.",
    "Use Ralph Loops to run autonomous coding sessions while you're away.",
    "Right-click a project icon to set a custom emoji — make each project instantly recognizable.",
    "Multiple people can connect to the same project at once — great for pair programming.",
    "Drag and drop project icons to reorder them in the sidebar.",
    "Drag a project icon to the trash to delete it.",
    "Honey never spoils. 🍯",
    "The Earth is round. 🌍",
    "Computers use electricity. 🔌",
    "Christmas is in summer in some countries. 🎄",
  ];
  // Fisher-Yates shuffle
  for (var _si = hubTips.length - 1; _si > 0; _si--) {
    var _sj = Math.floor(Math.random() * (_si + 1));
    var _tmp = hubTips[_si];
    hubTips[_si] = hubTips[_sj];
    hubTips[_sj] = _tmp;
  }
  var hubTipIndex = 0;
  var hubTipTimer = null;

  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // --- Weather (hidden detail) ---
  var weatherEmoji = null;   // null = not yet fetched, "" = failed
  var weatherCondition = "";  // e.g. "Light rain, Auckland"
  var weatherFetchedAt = 0;
  var WEATHER_CACHE_MS = 60 * 60 * 1000; // 1 hour
  // WMO weather code → emoji + description
  var WMO_MAP = {
    0: ["☀️", "Clear sky"], 1: ["🌤", "Mainly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫", "Fog"], 48: ["🌫", "Depositing rime fog"],
    51: ["🌦", "Light drizzle"], 53: ["🌦", "Moderate drizzle"], 55: ["🌧", "Dense drizzle"],
    56: ["🌧", "Light freezing drizzle"], 57: ["🌧", "Dense freezing drizzle"],
    61: ["🌧", "Slight rain"], 63: ["🌧", "Moderate rain"], 65: ["🌧", "Heavy rain"],
    66: ["🌧", "Light freezing rain"], 67: ["🌧", "Heavy freezing rain"],
    71: ["🌨", "Slight snow"], 73: ["🌨", "Moderate snow"], 75: ["❄️", "Heavy snow"],
    77: ["🌨", "Snow grains"],
    80: ["🌦", "Slight rain showers"], 81: ["🌧", "Moderate rain showers"], 82: ["🌧", "Violent rain showers"],
    85: ["🌨", "Slight snow showers"], 86: ["❄️", "Heavy snow showers"],
    95: ["⛈", "Thunderstorm"], 96: ["⛈", "Thunderstorm with slight hail"], 99: ["⛈", "Thunderstorm with heavy hail"],
  };

  function fetchWeather() {
    // Use cache if we have a successful result within the last hour
    if (weatherEmoji && weatherFetchedAt && (Date.now() - weatherFetchedAt < WEATHER_CACHE_MS)) return;
    // Try localStorage cache
    if (!weatherEmoji) {
      try {
        var cached = JSON.parse(localStorage.getItem("clay-weather") || "null");
        if (cached && cached.emoji && (Date.now() - cached.ts < WEATHER_CACHE_MS)) {
          weatherEmoji = cached.emoji;
          weatherCondition = cached.condition || "";
          weatherFetchedAt = cached.ts;
          if (homeHubVisible) updateGreetingWeather();
          return;
        }
      } catch (e) {}
    }
    if (weatherFetchedAt && (Date.now() - weatherFetchedAt < 30000)) return; // don't retry within 30s
    weatherFetchedAt = Date.now();
    // Step 1: IP geolocation → lat/lon + city
    fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (geo) {
        var lat = geo.latitude;
        var lon = geo.longitude;
        var city = geo.city || geo.region || "";
        var country = geo.country_name || "";
        var locationStr = city + (country ? ", " + country : "");
        // Step 2: Open-Meteo → current weather
        var meteoUrl = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current=weather_code&timezone=auto";
        return fetch(meteoUrl, { signal: AbortSignal.timeout(4000) })
          .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
          .then(function (data) {
            var code = data && data.current && data.current.weather_code;
            if (code === undefined || code === null) return;
            var mapped = WMO_MAP[code] || WMO_MAP[0];
            weatherEmoji = mapped[0];
            weatherCondition = mapped[1] + (locationStr ? " in " + locationStr : "");
            weatherFetchedAt = Date.now();
            try {
              localStorage.setItem("clay-weather", JSON.stringify({
                emoji: weatherEmoji, condition: weatherCondition, ts: weatherFetchedAt
              }));
            } catch (e) {}
            if (homeHubVisible) updateGreetingWeather();
          });
      })
      .catch(function () {
        if (!weatherEmoji) weatherEmoji = "";
      });
  }

  var SLOT_EMOJIS = ["☀️", "🌤", "⛅", "☁️", "🌧", "🌦", "⛈", "🌨", "❄️", "🌫", "🌙", "✨"];
  var weatherSlotPlayed = false;

  function updateGreetingWeather() {
    var greetEl = $g("hub-greeting-text");
    if (!greetEl) return;
    // If we have real weather and haven't played the slot yet, do the reel
    if (weatherEmoji && !weatherSlotPlayed && homeHubVisible) {
      weatherSlotPlayed = true;
      playWeatherSlot(greetEl);
      return;
    }
    // Normal update (no animation)
    greetEl.textContent = getGreeting();

    applyWeatherTooltip(greetEl);
  }

  function applyWeatherTooltip(greetEl) {
    if (!weatherCondition) return;
    var emojis = greetEl.querySelectorAll("img.emoji");
    var lastEmoji = emojis.length > 0 ? emojis[emojis.length - 1] : null;
    if (lastEmoji) {
      lastEmoji.title = weatherCondition;
      lastEmoji.style.cursor = "default";
    }
  }

  function playWeatherSlot(greetEl) {
    var h = new Date().getHours();
    var prefix;
    if (h < 6) prefix = "Good night";
    else if (h < 12) prefix = "Good morning";
    else if (h < 18) prefix = "Good afternoon";
    else prefix = "Good evening";

    // Build schedule: fast ticks → slow ticks → land (~3s total)
    var intervals = [50, 50, 50, 60, 70, 80, 100, 120, 150, 190, 240, 300, 370, 450, 530, 640];
    var totalSteps = intervals.length;
    var step = 0;
    var startIdx = Math.floor(Math.random() * SLOT_EMOJIS.length);

    function tick() {
      if (step < totalSteps) {
        var idx = (startIdx + step) % SLOT_EMOJIS.length;
        greetEl.textContent = prefix + " " + SLOT_EMOJIS[idx];
    
        step++;
        setTimeout(tick, intervals[step - 1]);
      } else {
        // Final: land on actual weather
        greetEl.textContent = prefix + " " + weatherEmoji;
    
        applyWeatherTooltip(greetEl);
      }
    }
    tick();
  }

  function getGreeting() {
    var h = new Date().getHours();
    var emoji = weatherEmoji || "";
    // Fallback to time-based emoji if weather not available
    if (!emoji) {
      if (h < 6) emoji = "✨";
      else if (h < 12) emoji = "☀️";
      else if (h < 18) emoji = "🌤";
      else emoji = "🌙";
    }
    var prefix;
    if (h < 6) prefix = "Good night";
    else if (h < 12) prefix = "Good morning";
    else if (h < 18) prefix = "Good afternoon";
    else prefix = "Good evening";
    return prefix + " " + emoji;
  }

  function getFormattedDate() {
    var now = new Date();
    return WEEKDAY_NAMES[now.getDay()] + ", " + MONTH_NAMES[now.getMonth()] + " " + now.getDate() + ", " + now.getFullYear();
  }

  function formatScheduleTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    var schedStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, "0");
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12 || 12;
    var timeStr = h12 + ":" + m + " " + ampm;
    if (schedStr === todayStr) return timeStr;
    // Tomorrow check
    var tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var tomStr = tomorrow.getFullYear() + "-" + String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" + String(tomorrow.getDate()).padStart(2, "0");
    if (schedStr === tomStr) return "Tomorrow";
    return DAY_NAMES[d.getDay()] + " " + timeStr;
  }

  function renderHomeHub(projects) {
    // Greeting + weather tooltip
    updateGreetingWeather();

    // Date
    var dateEl = $g("hub-greeting-date");
    if (dateEl) dateEl.textContent = getFormattedDate();

    // --- Upcoming tasks ---
    var upcomingList = $g("hub-upcoming-list");
    var upcomingCount = $g("hub-upcoming-count");
    if (upcomingList) {
      var now = Date.now();
      var upcoming = hubSchedules.filter(function (s) {
        return s.enabled && s.nextRunAt && s.nextRunAt > now;
      }).sort(function (a, b) {
        return a.nextRunAt - b.nextRunAt;
      });
      // Show up to next 48 hours
      var cutoff = now + 48 * 60 * 60 * 1000;
      var filtered = upcoming.filter(function (s) { return s.nextRunAt <= cutoff; });

      if (upcomingCount) {
        upcomingCount.textContent = filtered.length > 0 ? filtered.length : "";
      }

      upcomingList.innerHTML = "";
      if (filtered.length === 0) {
        // Empty state with CTA
        var emptyDiv = document.createElement("div");
        emptyDiv.className = "hub-upcoming-empty";
        emptyDiv.innerHTML = '<div class="hub-upcoming-empty-icon">📋</div>' +
          '<div class="hub-upcoming-empty-text">No upcoming tasks</div>' +
          '<button class="hub-upcoming-cta" id="hub-upcoming-cta">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' +
          'Create a schedule</button>';
        upcomingList.appendChild(emptyDiv);
        var ctaBtn = emptyDiv.querySelector("#hub-upcoming-cta");
        if (ctaBtn) {
          ctaBtn.addEventListener("click", function () {
            hideHomeHub();
            openSchedulerToTab("calendar");
          });
        }
      } else {
        var maxShow = 5;
        var shown = filtered.slice(0, maxShow);
        for (var i = 0; i < shown.length; i++) {
          (function (sched) {
            var item = document.createElement("div");
            item.className = "hub-upcoming-item";
            var dotColor = sched.color || "";
            item.innerHTML = '<span class="hub-upcoming-dot"' + (dotColor ? ' style="background:' + dotColor + '"' : '') + '></span>' +
              '<span class="hub-upcoming-time">' + formatScheduleTime(sched.nextRunAt) + '</span>' +
              '<span class="hub-upcoming-name">' + escapeHtml(sched.name || "Untitled") + '</span>' +
              '<span class="hub-upcoming-project">' + escapeHtml(sched.projectTitle || "") + '</span>';
            item.addEventListener("click", function () {
              if (sched.projectSlug) {
                switchProject(sched.projectSlug);
                setTimeout(function () {
                  openSchedulerToTab("library");
                }, 300);
              }
            });
            upcomingList.appendChild(item);
          })(shown[i]);
        }
        if (filtered.length > maxShow) {
          var moreEl = document.createElement("div");
          moreEl.className = "hub-upcoming-more";
          moreEl.textContent = "+" + (filtered.length - maxShow) + " more";
          upcomingList.appendChild(moreEl);
        }
      }
    }

    // --- Projects summary ---
    var projectsList = $g("hub-projects-list");
    if (projectsList && projects) {
      projectsList.innerHTML = "";
      for (var p = 0; p < projects.length; p++) {
        (function (proj) {
          var item = document.createElement("div");
          item.className = "hub-project-item";
          var dotClass = "hub-project-dot" + (proj.isProcessing ? " processing" : "");
          var iconHtml = proj.icon ? '<span class="hub-project-icon">' + proj.icon + '</span>' : '';
          var sessionsLabel = typeof proj.sessions === "number" ? proj.sessions : "";
          item.innerHTML = '<span class="' + dotClass + '"></span>' +
            iconHtml +
            '<span class="hub-project-name">' + escapeHtml(proj.title || proj.project || proj.slug) + '</span>' +
            (sessionsLabel !== "" ? '<span class="hub-project-sessions">' + sessionsLabel + '</span>' : '');
          item.addEventListener("click", function () {
            switchProject(proj.slug);
          });
          projectsList.appendChild(item);
        })(projects[p]);
      }
      // Render emoji icons

    }

    // --- Week strip ---
    var weekStrip = $g("hub-week-strip");
    if (weekStrip) {
      weekStrip.innerHTML = "";
      var today = new Date();
      var todayDate = today.getDate();
      var todayMonth = today.getMonth();
      var todayYear = today.getFullYear();
      // Find Monday of current week
      var dayOfWeek = today.getDay();
      var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      var monday = new Date(today);
      monday.setDate(today.getDate() + mondayOffset);

      // Build set of dates that have events
      var eventDates = {};
      for (var si = 0; si < hubSchedules.length; si++) {
        var sched = hubSchedules[si];
        if (!sched.enabled) continue;
        if (sched.nextRunAt) {
          var sd = new Date(sched.nextRunAt);
          var key = sd.getFullYear() + "-" + sd.getMonth() + "-" + sd.getDate();
          eventDates[key] = (eventDates[key] || 0) + 1;
        }
        if (sched.date) {
          var parts = sched.date.split("-");
          var dateKey = parseInt(parts[0], 10) + "-" + (parseInt(parts[1], 10) - 1) + "-" + parseInt(parts[2], 10);
          eventDates[dateKey] = (eventDates[dateKey] || 0) + 1;
        }
      }

      for (var d = 0; d < 7; d++) {
        var dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + d);
        var isToday = dayDate.getDate() === todayDate && dayDate.getMonth() === todayMonth && dayDate.getFullYear() === todayYear;
        var dateKey = dayDate.getFullYear() + "-" + dayDate.getMonth() + "-" + dayDate.getDate();
        var eventCount = eventDates[dateKey] || 0;

        var cell = document.createElement("div");
        cell.className = "hub-week-day" + (isToday ? " today" : "");
        var dotsHtml = '<div class="hub-week-dots">';
        var dotCount = Math.min(eventCount, 3);
        for (var di = 0; di < dotCount; di++) {
          dotsHtml += '<span class="hub-week-dot"></span>';
        }
        dotsHtml += '</div>';
        cell.innerHTML = '<span class="hub-week-label">' + DAY_NAMES[(dayDate.getDay())] + '</span>' +
          '<span class="hub-week-num">' + dayDate.getDate() + '</span>' +
          dotsHtml;
        weekStrip.appendChild(cell);
      }
    }

    // --- Playbooks ---
    var pbGrid = $g("hub-playbooks-grid");
    var pbSection = $g("hub-playbooks");
    if (pbGrid) {
      var pbs = getPlaybooks();
      if (pbs.length === 0) {
        if (pbSection) pbSection.style.display = "none";
      } else {
        if (pbSection) pbSection.style.display = "";
        pbGrid.innerHTML = "";
        for (var pi = 0; pi < pbs.length; pi++) {
          (function (pb) {
            var card = document.createElement("div");
            card.className = "hub-playbook-card" + (pb.completed ? " completed" : "");
            card.innerHTML = '<span class="hub-playbook-card-icon">' + pb.icon + '</span>' +
              '<div class="hub-playbook-card-body">' +
              '<div class="hub-playbook-card-title">' + escapeHtml(pb.title) + '</div>' +
              '<div class="hub-playbook-card-desc">' + escapeHtml(pb.description) + '</div>' +
              '</div>' +
              (pb.completed ? '<span class="hub-playbook-card-check">✓</span>' : '');
            card.addEventListener("click", function () {
              openPlaybook(pb.id, function () {
                // Re-render hub after playbook closes to update completion state
                renderHomeHub(cachedProjects);
              });
            });
            pbGrid.appendChild(card);
          })(pbs[pi]);
        }

      }
    }


    // --- Tip ---
    var currentTip = hubTips[hubTipIndex % hubTips.length];
    var tipEl = $g("hub-tip-text");
    if (tipEl) tipEl.textContent = currentTip;

    // "Try it" button if tip has a linked playbook
    var existingTry = homeHub.querySelector(".hub-tip-try");
    if (existingTry) existingTry.remove();
    var linkedPb = getPlaybookForTip(currentTip);
    if (linkedPb && tipEl) {
      var tryBtn = document.createElement("button");
      tryBtn.className = "hub-tip-try";
      tryBtn.textContent = "Try it →";
      tryBtn.addEventListener("click", function () {
        openPlaybook(linkedPb, function () {
          renderHomeHub(cachedProjects);
        });
      });
      tipEl.appendChild(tryBtn);
    }

    // Tip prev/next buttons
    var prevBtn = $g("hub-tip-prev");
    if (prevBtn && !prevBtn._hubWired) {
      prevBtn._hubWired = true;
      prevBtn.addEventListener("click", function () {
        hubTipIndex = (hubTipIndex - 1 + hubTips.length) % hubTips.length;
        renderHomeHub(cachedProjects);
        startTipRotation();
      });
    }
    var nextBtn = $g("hub-tip-next");
    if (nextBtn && !nextBtn._hubWired) {
      nextBtn._hubWired = true;
      nextBtn.addEventListener("click", function () {
        hubTipIndex = (hubTipIndex + 1) % hubTips.length;
        renderHomeHub(cachedProjects);
        startTipRotation();
      });
    }

    // Render twemoji for all emoji in the hub

  }

  function handleHubSchedules(msg) {
    if (msg.schedules) {
      hubSchedules = msg.schedules;
      if (homeHubVisible) renderHomeHub(cachedProjects);
    }
  }

  function startTipRotation() {
    stopTipRotation();
    hubTipTimer = setInterval(function () {
      hubTipIndex = (hubTipIndex + 1) % hubTips.length;
      renderHomeHub(cachedProjects);
    }, 15000);
  }

  function stopTipRotation() {
    if (hubTipTimer) {
      clearInterval(hubTipTimer);
      hubTipTimer = null;
    }
  }

  // --- DM Mode Functions ---
  function openDm(targetUserId) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "dm_open", targetUserId: targetUserId }));
  }

  function enterDmMode(key, targetUser, messages) {
    dmMode = true;
    dmKey = key;
    dmTargetUser = targetUser;

    // Clear unread for this user
    if (targetUser) {
      dmUnread[targetUser.id] = 0;
      updateDmBadge(targetUser.id, 0);
    }

    // Update icon strip active state
    setCurrentDmUser(targetUser ? targetUser.id : null);
    var activeProj = document.querySelector("#icon-strip-projects .icon-strip-item.active");
    if (activeProj) activeProj.classList.remove("active");
    var homeIcon = document.querySelector(".icon-strip-home");
    if (homeIcon) homeIcon.classList.remove("active");
    // Re-render user strip to show active state
    if (cachedProjects && cachedProjects.length > 0) {
      renderProjectList();
    }

    // Hide home hub if visible
    hideHomeHub();

    // Hide project UI + sidebar, show DM UI
    if (primaryPaneEl) primaryPaneEl.classList.add("dm-mode");
    var sidebarCol = document.getElementById("sidebar-column");
    if (sidebarCol) sidebarCol.classList.add("dm-mode");
    var resizeHandle = document.getElementById("sidebar-resize-handle");
    if (resizeHandle) resizeHandle.classList.add("dm-mode");

    // Hide user-island (my avatar behind it becomes visible)
    var userIsland = document.getElementById("user-island");
    if (userIsland) userIsland.classList.add("dm-hidden");

    // Render DM messages
    messagesEl.innerHTML = "";
    if (messages && messages.length > 0) {
      for (var i = 0; i < messages.length; i++) {
        appendDmMessage(messages[i]);
      }
    }
    scrollToBottom();

    // Focus input
    if (inputEl) {
      inputEl.placeholder = "Message " + (targetUser ? targetUser.displayName : "");
      inputEl.focus();
    }

    // Populate DM header bar with user avatar, name, and personal color
    if (targetUser) {
      var dmHeaderBar = $("dm-header-bar");
      var dmAvatar = $("dm-header-avatar");
      var dmName = $("dm-header-name");
      if (dmAvatar) {
        dmAvatar.src = "https://api.dicebear.com/9.x/" + (targetUser.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(targetUser.avatarSeed || targetUser.username) + "&size=28";
      }
      if (dmName) dmName.textContent = targetUser.displayName;
      if (dmHeaderBar && targetUser.avatarColor) {
        dmHeaderBar.style.background = targetUser.avatarColor;
      }
    }
  }

  function exitDmMode() {
    if (!dmMode) return;
    dmMode = false;
    dmKey = null;
    dmTargetUser = null;
    setCurrentDmUser(null);

    if (primaryPaneEl) primaryPaneEl.classList.remove("dm-mode");
    var sidebarCol = document.getElementById("sidebar-column");
    if (sidebarCol) sidebarCol.classList.remove("dm-mode");
    var resizeHandle = document.getElementById("sidebar-resize-handle");
    if (resizeHandle) resizeHandle.classList.remove("dm-mode");

    // Reset DM header
    var dmHeaderBar = $("dm-header-bar");
    if (dmHeaderBar) dmHeaderBar.style.background = "";

    // Restore user-island (covers my avatar again)
    var userIsland = document.getElementById("user-island");
    if (userIsland) userIsland.classList.remove("dm-hidden");

    // Restore project UI
    if (inputEl) inputEl.placeholder = "";
    renderProjectList();
  }

  function appendDmMessage(msg) {
    var isMe = msg.from === myUserId;
    var d = new Date(msg.ts);
    var timeStr = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");

    // Check if we can compact (same sender as previous, within 5 min)
    var prev = messagesEl.lastElementChild;
    var compact = false;
    if (prev && prev.dataset.from === msg.from) {
      var prevTs = parseInt(prev.dataset.ts || "0", 10);
      if (msg.ts - prevTs < 300000) compact = true;
    }

    var div = document.createElement("div");
    div.className = "dm-msg" + (compact ? " dm-msg-compact" : "");
    div.dataset.from = msg.from;
    div.dataset.ts = msg.ts;

    if (compact) {
      // Compact: just hover-time + text, no avatar/name
      var hoverTime = document.createElement("span");
      hoverTime.className = "dm-msg-hover-time";
      hoverTime.textContent = timeStr;
      div.appendChild(hoverTime);

      var body = document.createElement("div");
      body.className = "dm-msg-body";
      body.textContent = msg.text;
      div.appendChild(body);
    } else {
      // Full: avatar + header(name, time) + text
      var avatar = document.createElement("img");
      avatar.className = "dm-msg-avatar";
      if (isMe) {
        var myUser = cachedAllUsers.find(function (u) { return u.id === myUserId; });
        var myStyle = myUser ? myUser.avatarStyle : "thumbs";
        var mySeed = myUser ? (myUser.avatarSeed || myUser.username) : myUserId;
        avatar.src = "https://api.dicebear.com/9.x/" + (myStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(mySeed) + "&size=36";
      } else if (dmTargetUser) {
        avatar.src = "https://api.dicebear.com/9.x/" + (dmTargetUser.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(dmTargetUser.avatarSeed || dmTargetUser.username) + "&size=36";
      }
      div.appendChild(avatar);

      var content = document.createElement("div");
      content.className = "dm-msg-content";

      var header = document.createElement("div");
      header.className = "dm-msg-header";

      var name = document.createElement("span");
      name.className = "dm-msg-name";
      if (isMe) {
        var mu = cachedAllUsers.find(function (u) { return u.id === myUserId; });
        name.textContent = mu ? mu.displayName : "Me";
      } else {
        name.textContent = dmTargetUser ? dmTargetUser.displayName : "User";
      }
      header.appendChild(name);

      var time = document.createElement("span");
      time.className = "dm-msg-time";
      time.textContent = timeStr;
      header.appendChild(time);

      content.appendChild(header);

      var body = document.createElement("div");
      body.className = "dm-msg-body";
      body.textContent = msg.text;
      content.appendChild(body);

      div.appendChild(content);
    }

    messagesEl.appendChild(div);
  }

  var dmTypingTimer = null;

  function showDmTypingIndicator(typing) {
    var existing = document.getElementById("dm-typing-indicator");
    if (!typing) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return; // already showing
    if (!dmTargetUser) return;

    var div = document.createElement("div");
    div.id = "dm-typing-indicator";
    div.className = "dm-msg dm-typing-indicator";

    var avatar = document.createElement("img");
    avatar.className = "dm-msg-avatar";
    avatar.src = "https://api.dicebear.com/9.x/" + (dmTargetUser.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(dmTargetUser.avatarSeed || dmTargetUser.username) + "&size=36";
    div.appendChild(avatar);

    var dots = document.createElement("div");
    dots.className = "dm-typing-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    div.appendChild(dots);

    messagesEl.appendChild(div);
    scrollToBottom();

    // Auto-hide after 5s in case stop signal is missed
    clearTimeout(dmTypingTimer);
    dmTypingTimer = setTimeout(function () {
      showDmTypingIndicator(false);
    }, 5000);
  }

  function handleDmSend() {
    if (!dmMode || !dmKey || !inputEl) return false;
    var text = inputEl.value.trim();
    if (!text) return false;
    ws.send(JSON.stringify({ type: "dm_send", dmKey: dmKey, text: text }));
    inputEl.value = "";
    autoResize();
    return true;
  }

  var hubCloseBtn = document.getElementById("home-hub-close");

  function showHomeHub() {
    if (dmMode) exitDmMode();
    homeHubVisible = true;
    homeHub.classList.remove("hidden");
    // Show close button only if there's a project to return to
    if (hubCloseBtn) {
      if (currentSlug) hubCloseBtn.classList.remove("hidden");
      else hubCloseBtn.classList.add("hidden");
    }
    // Fetch weather silently (once)
    fetchWeather();
    // Request cross-project schedules
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "hub_schedules_list" }));
    }
    renderHomeHub(cachedProjects);
    startTipRotation();
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", "/");
    } else {
      history.pushState(null, "", "/");
    }
    // Update icon strip active state
    var homeIcon = document.querySelector(".icon-strip-home");
    if (homeIcon) homeIcon.classList.add("active");
    var activeProj = document.querySelector("#icon-strip-projects .icon-strip-item.active");
    if (activeProj) activeProj.classList.remove("active");
    // Mobile home button active
    var mobileHome = document.getElementById("mobile-home-btn");
    if (mobileHome) mobileHome.classList.add("active");
  }

  if (hubCloseBtn) {
    hubCloseBtn.addEventListener("click", function () {
      hideHomeHub();
      if (currentSlug) {
        if (document.documentElement.classList.contains("pwa-standalone")) {
          history.replaceState(null, "", "/p/" + currentSlug + "/");
        } else {
          history.pushState(null, "", "/p/" + currentSlug + "/");
        }
        // Restore icon strip active state
        var homeIcon = document.querySelector(".icon-strip-home");
        if (homeIcon) homeIcon.classList.remove("active");
        renderProjectList();
      }
    });
  }

  function hideHomeHub() {
    if (!homeHubVisible) return;
    homeHubVisible = false;
    homeHub.classList.add("hidden");
    stopTipRotation();
    var mobileHome = document.getElementById("mobile-home-btn");
    if (mobileHome) mobileHome.classList.remove("active");
  }

  // --- Project List ---
  var projectListSection = $g("project-list-section");
  var projectListEl = $g("project-list");
  var projectListAddBtn = $g("project-list-add");
  var projectHint = $g("project-hint");
  var projectHintDismiss = $g("project-hint-dismiss");
  var cachedProjects = [];
  var cachedProjectCount = 0;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  function updateProjectList(msg) {
    if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
    if (msg.projects) cachedProjects = msg.projects;
    var count = cachedProjectCount || 0;
    renderProjectList();
    if (count === 1 && projectHint) {
      try {
        if (!localStorage.getItem("clay-project-hint-dismissed")) {
          projectHint.classList.remove("hidden");
        }
      } catch (e) {}
    } else if (projectHint) {
      projectHint.classList.add("hidden");
    }
    // Update topbar with server-wide presence
    if (msg.serverUsers) {
      renderTopbarPresence(msg.serverUsers);
    }
    // Update user strip (DM targets) in icon strip
    if (msg.allUsers) {
      cachedAllUsers = msg.allUsers;
      var onlineIds = (msg.serverUsers || []).map(function (u) { return u.id; });
      renderUserStrip(msg.allUsers, onlineIds, myUserId);
      // Render my avatar (always present, hidden behind user-island)
      var meEl = document.getElementById("icon-strip-me");
      if (meEl && !meEl.hasChildNodes()) {
        var myUser = cachedAllUsers.find(function (u) { return u.id === myUserId; });
        if (myUser) {
          var meAvatar = document.createElement("img");
          meAvatar.className = "icon-strip-me-avatar";
          meAvatar.src = "https://api.dicebear.com/9.x/" + (myUser.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(myUser.avatarSeed || myUser.username) + "&size=34";
          meEl.appendChild(meAvatar);
        }
      }
    }
  }

  function renderTopbarPresence(serverUsers) {
    var countEl = document.getElementById("client-count");
    if (!countEl) return;
    if (serverUsers.length > 1) {
      countEl.innerHTML = "";
      for (var cui = 0; cui < serverUsers.length; cui++) {
        var cu = serverUsers[cui];
        var cuImg = document.createElement("img");
        cuImg.className = "client-avatar";
        cuImg.src = "https://api.dicebear.com/9.x/" + (cu.avatarStyle || "thumbs") + "/svg?seed=" + encodeURIComponent(cu.avatarSeed || cu.username) + "&size=24";
        cuImg.alt = cu.displayName;
        cuImg.dataset.tip = cu.displayName + " (@" + cu.username + ")";
        if (cui > 0) cuImg.style.marginLeft = "-6px";
        countEl.appendChild(cuImg);
      }
      countEl.classList.remove("hidden");
    } else {
      countEl.classList.add("hidden");
    }
  }

  function renderProjectList() {
    // Render icon strip projects
    var iconStripProjects = cachedProjects.map(function (p) {
      return { slug: p.slug, name: p.title || p.project, icon: p.icon || null, isProcessing: p.isProcessing, onlineUsers: p.onlineUsers || [], parentSlug: p.parentSlug || null };
    });
    renderIconStrip(iconStripProjects, currentSlug);
    // Update title bar project name and icon if it changed
    for (var pi = 0; pi < cachedProjects.length; pi++) {
      if (cachedProjects[pi].slug === currentSlug) {
        var updatedName = cachedProjects[pi].title || cachedProjects[pi].project;
        var tbName = document.getElementById("title-bar-project-name");
        if (tbName && updatedName) tbName.textContent = updatedName;
        var tbIcon = document.getElementById("title-bar-project-icon");
        if (tbIcon) {
          var pIcon = cachedProjects[pi].icon || null;
          if (pIcon) {
            tbIcon.textContent = pIcon;
            parseEmojis(tbIcon);
            tbIcon.classList.add("has-icon");
            try { localStorage.setItem("clay-project-icon-" + (currentSlug || "default"), pIcon); } catch (e) {}
          } else {
            tbIcon.textContent = "";
            tbIcon.classList.remove("has-icon");
            try { localStorage.removeItem("clay-project-icon-" + (currentSlug || "default")); } catch (e) {}
          }
        }
        break;
      }
    }
    // Re-apply current socket status to the active icon's dot
    var dot = getStatusDot();
    if (dot) {
      if (connected && _primaryRenderer && _primaryRenderer.processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
      else if (connected) { dot.classList.add("connected"); }
    }
    // Start/stop cross-project IO blink for non-active processing projects
    updateCrossProjectBlink();
  }

  if (projectListAddBtn) {
    projectListAddBtn.addEventListener("click", function () {
      openAddProjectModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (homeHubVisible && currentSlug) {
        hubCloseBtn.click();
        return;
      }
      closeImageModal();
    }
    // Ctrl+. — cycle through sessions needing attention
    if (e.ctrlKey && e.key === ".") {
      e.preventDefault();
      var attentionIds = getAttentionSessionIds();
      if (attentionIds.length === 0) return;
      var currentIdx = attentionIds.indexOf(getActiveSessionId());
      var nextIdx = (currentIdx + 1) % attentionIds.length;
      var nextId = attentionIds[nextIdx];
      if (ws && connected) {
        ws.send(JSON.stringify({ type: "switch_session", id: nextId }));
      }
    }
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("clay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $g("paste-modal").querySelector(".confirm-backdrop").addEventListener("click", function() {
    $g("paste-modal").classList.add("hidden");
  });
  $g("paste-modal").querySelector(".paste-modal-close").addEventListener("click", function() {
    $g("paste-modal").classList.add("hidden");
  });
  $g("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $g("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);
  $g("image-modal").querySelector(".confirm-backdrop").addEventListener("click", closeImageModal);
  $g("image-modal").querySelector(".image-modal-close").addEventListener("click", closeImageModal);

  function showImageModal(src) {
    var modal = $g("image-modal");
    var img = $g("image-modal-img");
    if (!modal || !img) return;
    img.src = src;
    modal.classList.remove("hidden");
    refreshIcons(modal);
  }

  function closeImageModal() {
    var modal = $g("image-modal");
    if (modal) modal.classList.add("hidden");
  }

  // --- State ---
  var ws = null;
  var connected = false;
  var wasConnected = false;
  // processing, activityEl, currentMsgEl, currentFullText, highlightTimer -> modules/pane-renderer.js
  // activeSessionId, sessionDrafts, turnCounter, messageUuidMap -> modules/pane-renderer.js
  // loopActive, loopAvailable, loopIteration, loopMaxIterations -> modules/pane-renderer.js (per-pane)
  // cliSessionId -> modules/pane-renderer.js
  // isComposing -> modules/input.js
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var disconnectNotifTimer = null;
  var disconnectNotifShown = false;
  // ralphPhase/ralphCraftingSessionId per-pane state in pane-renderer; wizard state stays global
  var ralphPhase = "idle"; // idle | wizard | crafting | approval | executing | done
  var ralphCraftingSessionId = null;
  var wizardStep = 1;
  var wizardData = { name: "", task: "", maxIterations: 3, cron: null };
  var ralphFilesReady = { promptReady: false, judgeReady: false, bothReady: false };
  var ralphPreviewContent = { prompt: "", judge: "" };
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var projectName = "";

  // Restore cached project name and icon for instant display (before WS connects)
  try {
    var _cachedProjectName = localStorage.getItem("clay-project-name-" + (currentSlug || "default"));
    if (_cachedProjectName) {
      projectName = _cachedProjectName;
      if (headerTitleEl) headerTitleEl.textContent = _cachedProjectName;
      var _tbp = $g("title-bar-project-name");
      if (_tbp) _tbp.textContent = _cachedProjectName;
    }
    var _cachedProjectIcon = localStorage.getItem("clay-project-icon-" + (currentSlug || "default"));
    if (_cachedProjectIcon) {
      var _tbi = $g("title-bar-project-icon");
      if (_tbi) {
        _tbi.textContent = _cachedProjectIcon;
        parseEmojis(_tbi);
        _tbi.classList.add("has-icon");
      }
    }
  } catch (e) {}
  // messageUuidMap, historyFrom, historyTotal, prependAnchor, loadingMore,
  // historySentinelObserver, replayingHistory, isUserScrolledUp, scrollThreshold
  // -> modules/pane-renderer.js

  // builtinCommands -> modules/input.js

  // --- Header session rename ---
  if (headerRenameBtn) {
    headerRenameBtn.addEventListener("click", function () {
      if (!getActiveSessionId()) return;
      var currentText = headerTitleEl.textContent;
      var input = document.createElement("input");
      input.type = "text";
      input.className = "header-rename-input";
      input.value = currentText;
      headerTitleEl.style.display = "none";
      headerRenameBtn.style.display = "none";
      headerTitleEl.parentNode.insertBefore(input, headerTitleEl.nextSibling);
      input.focus();
      input.select();

      function commit() {
        var newTitle = input.value.trim();
        if (newTitle && newTitle !== currentText && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "rename_session", id: getActiveSessionId(), title: newTitle }));
          headerTitleEl.textContent = newTitle;
        }
        input.remove();
        headerTitleEl.style.display = "";
        headerRenameBtn.style.display = "";
      }

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          e.preventDefault();
          input.remove();
          headerTitleEl.style.display = "";
          headerRenameBtn.style.display = "";
        }
      });
      input.addEventListener("blur", commit);
    });
  }

  // --- Session info popover ---
  var headerInfoBtn = $("header-info-btn");
  var sessionInfoPopover = null;

  function closeSessionInfoPopover() {
    if (sessionInfoPopover) {
      sessionInfoPopover.remove();
      sessionInfoPopover = null;
    }
  }

  if (headerInfoBtn) {
    headerInfoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (sessionInfoPopover) { closeSessionInfoPopover(); return; }

      var pop = document.createElement("div");
      pop.className = "session-info-popover";

      function addRow(label, value) {
        var val = value == null ? "-" : String(value);
        var row = document.createElement("div");
        row.className = "info-row";
        row.innerHTML =
          '<span class="info-label">' + label + '</span>' +
          '<span class="info-value">' + escapeHtml(val) + '</span>' +
          '<button class="info-copy-btn" title="Copy">' + iconHtml("copy") + '</button>';
        var btn = row.querySelector(".info-copy-btn");
        btn.addEventListener("click", function () {
          copyToClipboard(value || "").then(function () {
            btn.innerHTML = iconHtml("check");
            refreshIcons();
            setTimeout(function () { btn.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
          });
        });
        pop.appendChild(row);
      }

      if (getCliSessionId()) addRow("Session ID", getCliSessionId());
      if (getActiveSessionId()) addRow("Local ID", getActiveSessionId());
      if (getCliSessionId()) addRow("Resume", "claude --resume " + getCliSessionId());

      document.body.appendChild(pop);
      sessionInfoPopover = pop;
      refreshIcons();

      var btnRect = headerInfoBtn.getBoundingClientRect();
      pop.style.top = (btnRect.bottom + 6) + "px";
      pop.style.left = btnRect.left + "px";
      var popRect = pop.getBoundingClientRect();
      if (popRect.right > window.innerWidth - 8) {
        pop.style.left = (window.innerWidth - popRect.width - 8) + "px";
      }
    });

    document.addEventListener("click", function (e) {
      if (sessionInfoPopover && !sessionInfoPopover.contains(e.target) && !e.target.closest("#header-info-btn")) {
        closeSessionInfoPopover();
      }
    });
  }

  // --- Confirm modal ---
  var confirmModal = $g("confirm-modal");
  var confirmText = $g("confirm-text");
  var confirmOk = $g("confirm-ok");
  var confirmCancel = $g("confirm-cancel");
  // --- Paste content viewer modal ---
  function showPasteModal(text) {
    var modal = $g("paste-modal");
    var body = $g("paste-modal-body");
    if (!modal || !body) return;
    body.textContent = text;
    modal.classList.remove("hidden");
  }

  function closePasteModal() {
    var modal = $g("paste-modal");
    if (modal) modal.classList.add("hidden");
  }

  var confirmCallback = null;

  function showConfirm(text, onConfirm, okLabel, destructive) {
    confirmText.textContent = text;
    confirmCallback = onConfirm;
    confirmOk.textContent = okLabel || "Delete";
    confirmOk.className = "confirm-btn " + (destructive === false ? "confirm-ok" : "confirm-delete");
    confirmModal.classList.remove("hidden");
  }

  function hideConfirm() {
    confirmModal.classList.add("hidden");
    confirmCallback = null;
  }

  confirmOk.addEventListener("click", function () {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  confirmCancel.addEventListener("click", hideConfirm);
  confirmModal.querySelector(".confirm-backdrop").addEventListener("click", hideConfirm);

  // --- Rewind (module) ---
  initRewind({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return _primaryRenderer ? _primaryRenderer.processing : false; },
    messagesEl: messagesEl,
    addSystemMessage: addSystemMessage,
  });

  // --- Theme (module) ---
  initTheme();

  // --- Sidebar (module) ---
  var sidebarCtx = {
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get projectName() { return projectName; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    sidebar: sidebar,
    sidebarOverlay: sidebarOverlay,
    sidebarToggleBtn: sidebarToggleBtn,
    sidebarExpandBtn: sidebarExpandBtn,
    hamburgerBtn: hamburgerBtn,
    newSessionBtn: newSessionBtn,
    resumeSessionBtn: resumeSessionBtn,
    headerTitleEl: headerTitleEl,
    showConfirm: showConfirm,
    onFilesTabOpen: function () { loadRootDirectory(); },
    switchProject: function (slug) { switchProject(slug); },
    openTerminal: function () { openTerminal(); },
    showHomeHub: function () { showHomeHub(); },
    openRalphWizard: function () { openRalphWizard(); },
    getUpcomingSchedules: getUpcomingSchedules,
    get multiUser() { return isMultiUserMode; },
    get myUserId() { return myUserId; },
    openDm: function (userId) { openDm(userId); },
    switchSessionInFocusedPane: function(sessionId) {
      var focused = getFocusedPane();
      if (!focused) return;
      if (focused.isPrimary) {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "switch_session", id: sessionId }));
        }
      } else if (focused.ws && focused.ws.readyState === 1) {
        focused.ws.send(JSON.stringify({ type: "switch_session", id: sessionId }));
      }
    },
    openSessionInNewPane: function(sessionId) {
      var newPane = splitPane("horizontal");
      if (newPane) connectPane(newPane, sessionId);
    },
  };
  initSidebar(sidebarCtx);
  initIconStrip(sidebarCtx);

  // --- Connect overlay (animated ASCII logo) ---
  var asciiLogoCanvas = $("ascii-logo-canvas");
  initAsciiLogo(asciiLogoCanvas);
  startLogoAnimation();
  function startVerbCycle() { startLogoAnimation(); }
  function stopVerbCycle() { stopLogoAnimation(); }

  // Reset favicon cache when theme changes
  onThemeChange(function () {
    faviconOrigHref = null;
  });

  function startPixelAnim() {}
  function stopPixelAnim() {}

  // --- Dynamic favicon (canvas-based banded C with color flow animation) ---
  var faviconLink = document.querySelector('link[rel="icon"]');
  var faviconOrigHref = null;
  var faviconCanvas = document.createElement("canvas");
  faviconCanvas.width = 32;
  faviconCanvas.height = 32;
  var faviconCtx = faviconCanvas.getContext("2d");
  var faviconImg = null;
  var faviconImgReady = false;

  // Banded colors from the Clay CLI logo gradient
  var BAND_COLORS = [
    [0, 235, 160],
    [0, 200, 220],
    [30, 100, 255],
    [88, 50, 255],
    [200, 60, 180],
    [255, 90, 50],
  ];

  // Load the banded favicon image for masking
  (function () {
    faviconImg = new Image();
    faviconImg.onload = function () { faviconImgReady = true; };
    faviconImg.src = basePath + "favicon-banded.png";
  })();

  function updateFavicon(bgColor) {
    if (!faviconLink) return;
    if (!bgColor) {
      if (faviconOrigHref) { faviconLink.href = faviconOrigHref; faviconOrigHref = null; }
      return;
    }
    if (!faviconOrigHref) faviconOrigHref = faviconLink.href;
    // Simple solid-color favicon for non-animated states
    faviconCtx.clearRect(0, 0, 32, 32);
    faviconCtx.fillStyle = bgColor;
    faviconCtx.beginPath();
    faviconCtx.arc(16, 16, 14, 0, Math.PI * 2);
    faviconCtx.fill();
    faviconCtx.fillStyle = "#fff";
    faviconCtx.font = "bold 22px Nunito, sans-serif";
    faviconCtx.textAlign = "center";
    faviconCtx.textBaseline = "middle";
    faviconCtx.fillText("C", 16, 17);
    faviconLink.href = faviconCanvas.toDataURL("image/png");
  }

  // Animated favicon: banded colors flow top-to-bottom
  var faviconAnimTimer = null;
  var faviconAnimFrame = 0;

  function drawFaviconAnimFrame() {
    if (!faviconImgReady) return;
    var S = 32;
    var bands = BAND_COLORS.length;
    var totalFrames = bands * 2;
    var offset = faviconAnimFrame % totalFrames;

    // Draw flowing color bands as background
    faviconCtx.clearRect(0, 0, S, S);
    var bandH = Math.ceil(S / bands);
    for (var i = 0; i < bands + totalFrames; i++) {
      var ci = ((i + offset) % bands + bands) % bands;
      var c = BAND_COLORS[ci];
      faviconCtx.fillStyle = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      faviconCtx.fillRect(0, (i - offset) * bandH, S, bandH);
    }

    // Use the banded C image as a mask — draw it on top with destination-in
    faviconCtx.globalCompositeOperation = "destination-in";
    faviconCtx.drawImage(faviconImg, 0, 0, S, S);
    faviconCtx.globalCompositeOperation = "source-over";

    faviconLink.href = faviconCanvas.toDataURL("image/png");
    faviconAnimFrame++;
  }

  // --- Status & Activity ---
  function setSendBtnMode(mode) {
    if (mode === "stop") {
      sendBtn.disabled = false;
      sendBtn.classList.add("stop");
      sendBtn.innerHTML = '<i data-lucide="square"></i>';
    } else {
      sendBtn.classList.remove("stop");
      sendBtn.innerHTML = '<i data-lucide="arrow-up"></i>';
    }
    refreshIcons();
  }

  var ioTimer = null;
  function blinkIO() {
    if (!connected) return;
    var dot = getStatusDot();
    if (dot) dot.classList.add("io");
    // Also blink the active session's processing dot in sidebar
    var sessionDot = document.querySelector(".session-item.active .session-processing");
    if (sessionDot) sessionDot.classList.add("io");
    clearTimeout(ioTimer);
    ioTimer = setTimeout(function () {
      var d = getStatusDot();
      if (d) d.classList.remove("io");
      var sd = document.querySelector(".session-item.active .session-processing.io");
      if (sd) sd.classList.remove("io");
    }, 80);
  }

  // --- Per-session IO blink for non-active sessions ---
  var sessionIoTimers = {};
  function blinkSessionDot(sessionId) {
    var el = document.querySelector('.session-item[data-session-id="' + sessionId + '"] .session-processing');
    if (!el) return;
    el.classList.add("io");
    clearTimeout(sessionIoTimers[sessionId]);
    sessionIoTimers[sessionId] = setTimeout(function () {
      el.classList.remove("io");
      delete sessionIoTimers[sessionId];
    }, 80);
  }

  // --- Cross-project IO blink for non-active processing projects ---
  var crossProjectBlinkTimer = null;
  function updateCrossProjectBlink() {
    if (crossProjectBlinkTimer) { clearTimeout(crossProjectBlinkTimer); crossProjectBlinkTimer = null; }
    function doBlink() {
      var dots = document.querySelectorAll("#icon-strip-projects .icon-strip-item:not(.active) .icon-strip-status.processing");
      if (dots.length === 0) { crossProjectBlinkTimer = null; return; }
      for (var i = 0; i < dots.length; i++) { dots[i].classList.add("io"); }
      setTimeout(function () {
        for (var j = 0; j < dots.length; j++) { dots[j].classList.remove("io"); }
        crossProjectBlinkTimer = setTimeout(doBlink, 150 + Math.random() * 350);
      }, 80);
    }
    crossProjectBlinkTimer = setTimeout(doBlink, 50);
  }

  // --- Urgent favicon animation (banded color flow + title blink) ---
  var urgentBlinkTimer = null;
  var urgentTitleTimer = null;
  var savedTitle = null;
  function startUrgentBlink() {
    if (urgentBlinkTimer) return;
    savedTitle = document.title;
    if (!faviconOrigHref && faviconLink) faviconOrigHref = faviconLink.href;
    faviconAnimFrame = 0;
    // Color flow animation at ~12fps
    urgentBlinkTimer = setInterval(drawFaviconAnimFrame, 83);
    // Title blink separately
    var titleTick = 0;
    urgentTitleTimer = setInterval(function () {
      document.title = titleTick % 2 === 0 ? "\u26A0 Input needed" : savedTitle;
      titleTick++;
    }, 500);
  }
  function stopUrgentBlink() {
    if (!urgentBlinkTimer) return;
    clearInterval(urgentBlinkTimer);
    clearInterval(urgentTitleTimer);
    urgentBlinkTimer = null;
    urgentTitleTimer = null;
    faviconAnimFrame = 0;
    updateFavicon(null);
    if (savedTitle) document.title = savedTitle;
    savedTitle = null;
  }

  // setStatus and setActivity are now delegated to the primary pane renderer
  function setStatus(status) {
    if (status === "connected") connected = true;
    else if (status !== "processing") connected = false;
    if (_primaryRenderer) _primaryRenderer.setStatus(status);
  }
  function setActivity(text) { if (_primaryRenderer) _primaryRenderer.setActivity(text); }

  // --- Config chip (model + mode + effort) ---
  var configChipWrap = $("config-chip-wrap");
  var configChip = $("config-chip");
  var configChipLabel = $("config-chip-label");
  var configPopover = $("config-popover");
  var configModelList = $("config-model-list");
  var configModeList = $("config-mode-list");
  var configEffortSection = $("config-effort-section");
  var configEffortBar = $("config-effort-bar");

  var configBetaSection = $("config-beta-section");
  var configBeta1mBtn = $("config-beta-1m");

  var configThinkingSection = $("config-thinking-section");
  var configThinkingBar = $("config-thinking-bar");
  var configThinkingBudgetRow = $("config-thinking-budget-row");
  var configThinkingBudgetInput = $("config-thinking-budget");

  var currentModels = [];
  var currentModel = "";
  var currentMode = "default";
  var currentEffort = "medium";
  var currentBetas = [];
  var currentThinking = "adaptive";
  var currentThinkingBudget = 10000;
  var skipPermsEnabled = false;

  var MODE_OPTIONS = [
    { value: "default", label: "Default" },
    { value: "plan", label: "Plan" },
    { value: "acceptEdits", label: "Auto-accept edits" },
  ];
  var MODE_FULL_AUTO = { value: "bypassPermissions", label: "Full auto" };

  var EFFORT_LEVELS = ["low", "medium", "high", "max"];
  var THINKING_OPTIONS = ["disabled", "adaptive", "budget"];

  function modelDisplayName(value, models) {
    if (!value) return "";
    if (models) {
      for (var i = 0; i < models.length; i++) {
        if (models[i].value === value && models[i].displayName) return models[i].displayName;
      }
    }
    return value;
  }

  function modeDisplayName(value) {
    for (var i = 0; i < MODE_OPTIONS.length; i++) {
      if (MODE_OPTIONS[i].value === value) return MODE_OPTIONS[i].label;
    }
    if (value === "bypassPermissions") return "Full auto";
    if (value === "dontAsk") return "Don\u2019t ask";
    return value;
  }

  function effortDisplayName(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function thinkingDisplayName(value) {
    if (value === "disabled") return "Off";
    if (value === "adaptive") return "Adaptive";
    if (value === "budget") return "Budget";
    return value || "Adaptive";
  }

  function isSonnetModel(model) {
    if (!model) return false;
    var lower = model.toLowerCase();
    return lower.indexOf("sonnet") !== -1;
  }

  function hasBeta(name) {
    for (var i = 0; i < currentBetas.length; i++) {
      if (currentBetas[i].indexOf(name) !== -1) return true;
    }
    return false;
  }

  function updateConfigChip() {
    if (!configChipWrap || !configChip) return;
    configChipWrap.classList.remove("hidden");
    var parts = [modelDisplayName(currentModel, currentModels)];
    parts.push(modeDisplayName(currentMode));
    // Only show effort if model supports it
    var modelSupportsEffort = getModelSupportsEffort();
    if (modelSupportsEffort) {
      parts.push(effortDisplayName(currentEffort));
    }
    if (currentThinking && currentThinking !== "adaptive") {
      parts.push(thinkingDisplayName(currentThinking));
    }
    if (hasBeta("context-1m")) {
      parts.push("1M");
    }
    configChipLabel.textContent = parts.join(" \u00b7 ");
    rebuildModelList();
    rebuildModeList();
    rebuildEffortBar();
    rebuildThinkingSection();
    rebuildBetaSection();
  }

  function getModelSupportsEffort() {
    if (!currentModels || currentModels.length === 0) return true; // assume yes if no info
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportsEffort === false) return false;
        return true;
      }
    }
    return true;
  }

  function getModelEffortLevels() {
    if (!currentModels || currentModels.length === 0) return EFFORT_LEVELS;
    for (var i = 0; i < currentModels.length; i++) {
      if (currentModels[i].value === currentModel) {
        if (currentModels[i].supportedEffortLevels && currentModels[i].supportedEffortLevels.length > 0) {
          return currentModels[i].supportedEffortLevels;
        }
        return EFFORT_LEVELS;
      }
    }
    return EFFORT_LEVELS;
  }

  function rebuildModelList() {
    if (!configModelList) return;
    configModelList.innerHTML = "";
    var list = currentModels.length > 0 ? currentModels : (currentModel ? [{ value: currentModel, displayName: currentModel }] : []);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var value = item.value || "";
      var label = item.displayName || value;
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (value === currentModel) btn.classList.add("active");
      btn.dataset.model = value;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        var model = this.dataset.model;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_model", model: model }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModelList.appendChild(btn);
    }
  }

  function rebuildModeList() {
    if (!configModeList) return;
    configModeList.innerHTML = "";
    var options = MODE_OPTIONS.slice();
    if (skipPermsEnabled) {
      options.push(MODE_FULL_AUTO);
    }
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var btn = document.createElement("button");
      btn.className = "config-radio-item";
      if (opt.value === currentMode) btn.classList.add("active");
      btn.dataset.mode = opt.value;
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        var mode = this.dataset.mode;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_permission_mode", mode: mode }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configModeList.appendChild(btn);
    }
  }

  function rebuildEffortBar() {
    if (!configEffortBar || !configEffortSection) return;
    var supportsEffort = getModelSupportsEffort();
    if (!supportsEffort) {
      configEffortSection.style.display = "none";
      return;
    }
    configEffortSection.style.display = "";
    configEffortBar.innerHTML = "";
    var levels = getModelEffortLevels();
    for (var i = 0; i < levels.length; i++) {
      var level = levels[i];
      var btn = document.createElement("button");
      btn.className = "config-segment-btn";
      if (level === currentEffort) btn.classList.add("active");
      btn.dataset.effort = level;
      btn.textContent = effortDisplayName(level);
      btn.addEventListener("click", function () {
        var effort = this.dataset.effort;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "set_effort", effort: effort }));
        }
        configPopover.classList.add("hidden");
        configChip.classList.remove("active");
      });
      configEffortBar.appendChild(btn);
    }
  }

  function rebuildBetaSection() {
    if (!configBetaSection || !configBeta1mBtn) return;
    // Only show for Sonnet models
    if (!isSonnetModel(currentModel)) {
      configBetaSection.style.display = "none";
      return;
    }
    configBetaSection.style.display = "";
    var active = hasBeta("context-1m");
    configBeta1mBtn.classList.toggle("active", active);
    configBeta1mBtn.setAttribute("aria-checked", active ? "true" : "false");
  }

  function rebuildThinkingSection() {
    if (!configThinkingBar || !configThinkingSection) return;
    configThinkingSection.style.display = "";
    configThinkingBar.innerHTML = "";
    for (var i = 0; i < THINKING_OPTIONS.length; i++) {
      var opt = THINKING_OPTIONS[i];
      var btn = document.createElement("button");
      btn.className = "config-segment-btn";
      if (opt === currentThinking) btn.classList.add("active");
      btn.dataset.thinking = opt;
      btn.textContent = thinkingDisplayName(opt);
      btn.addEventListener("click", function () {
        var thinking = this.dataset.thinking;
        var msg = { type: "set_thinking", thinking: thinking };
        if (thinking === "budget") {
          msg.budgetTokens = currentThinkingBudget;
        }
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(msg));
        }
      });
      configThinkingBar.appendChild(btn);
    }
    // Show/hide budget input
    if (configThinkingBudgetRow) {
      configThinkingBudgetRow.style.display = currentThinking === "budget" ? "" : "none";
    }
    if (configThinkingBudgetInput) {
      configThinkingBudgetInput.value = currentThinkingBudget;
    }
  }

  if (configThinkingBudgetInput) {
    configThinkingBudgetInput.addEventListener("change", function () {
      var val = parseInt(this.value, 10);
      if (isNaN(val) || val < 1024) val = 1024;
      if (val > 128000) val = 128000;
      currentThinkingBudget = val;
      this.value = val;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "set_thinking", thinking: "budget", budgetTokens: val }));
      }
    });
  }

  configBeta1mBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    var active = hasBeta("context-1m");
    var newBetas;
    if (active) {
      // Remove context-1m beta
      newBetas = [];
      for (var i = 0; i < currentBetas.length; i++) {
        if (currentBetas[i].indexOf("context-1m") === -1) {
          newBetas.push(currentBetas[i]);
        }
      }
    } else {
      // Add context-1m beta
      newBetas = currentBetas.slice();
      newBetas.push("context-1m-2025-08-07");
    }
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "set_betas", betas: newBetas }));
    }
  });

  configChip.addEventListener("click", function (e) {
    e.stopPropagation();
    var wasHidden = configPopover.classList.toggle("hidden");
    configChip.classList.toggle("active", !wasHidden);
  });

  document.addEventListener("click", function (e) {
    if (!configPopover.contains(e.target) && e.target !== configChip) {
      configPopover.classList.add("hidden");
      configChip.classList.remove("active");
    }
  });

  // --- Usage panel (delegated to pane renderer) ---
  function accumulateUsage(cost, usage) { if (_primaryRenderer) _primaryRenderer.accumulateUsage(cost, usage); }
  function resetUsage() { if (_primaryRenderer) _primaryRenderer.resetUsage(); }
  function updateUsagePanel() { if (_primaryRenderer) _primaryRenderer.updateUsagePanel(); }
  function toggleUsagePanel() { if (_primaryRenderer) _primaryRenderer.toggleUsagePanel(); }

  // --- Status panel ---
  var statusPanel = $("status-panel");
  var statusPanelClose = $("status-panel-close");
  var statusPidEl = $("status-pid");
  var statusUptimeEl = $("status-uptime");
  var statusRssEl = $("status-rss");
  var statusHeapUsedEl = $("status-heap-used");
  var statusHeapTotalEl = $("status-heap-total");
  var statusExternalEl = $("status-external");
  var statusSessionsEl = $("status-sessions");
  var statusProcessingEl = $("status-processing");
  var statusClientsEl = $("status-clients");
  var statusTerminalsEl = $("status-terminals");
  var statusRefreshTimer = null;

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }

  function formatUptime(seconds) {
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (d > 0) return d + "d " + h + "h " + m + "m";
    if (h > 0) return h + "h " + m + "m " + s + "s";
    return m + "m " + s + "s";
  }

  function updateStatusPanel(data) {
    if (!statusPidEl) return;
    statusPidEl.textContent = String(data.pid);
    statusUptimeEl.textContent = formatUptime(data.uptime);
    statusRssEl.textContent = formatBytes(data.memory.rss);
    statusHeapUsedEl.textContent = formatBytes(data.memory.heapUsed);
    statusHeapTotalEl.textContent = formatBytes(data.memory.heapTotal);
    statusExternalEl.textContent = formatBytes(data.memory.external);
    statusSessionsEl.textContent = String(data.sessions);
    statusProcessingEl.textContent = String(data.processing);
    statusClientsEl.textContent = String(data.clients);
    statusTerminalsEl.textContent = String(data.terminals);
  }

  function requestProcessStats() {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "process_stats" }));
    }
  }

  function toggleStatusPanel() {
    if (!statusPanel) return;
    var opening = statusPanel.classList.contains("hidden");
    statusPanel.classList.toggle("hidden");
    if (opening) {
      requestProcessStats();
      statusRefreshTimer = setInterval(requestProcessStats, 5000);
    } else {
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    }
    refreshIcons();
  }

  if (statusPanelClose) {
    statusPanelClose.addEventListener("click", function () {
      statusPanel.classList.add("hidden");
      if (statusRefreshTimer) {
        clearInterval(statusRefreshTimer);
        statusRefreshTimer = null;
      }
    });
  }

  // --- Context panel (delegated to pane renderer) ---
  function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) { if (_primaryRenderer) _primaryRenderer.accumulateContext(cost, usage, modelUsage, lastStreamInputTokens); }
  function resetContextData() { if (_primaryRenderer) _primaryRenderer.resetContextData(); }
  function resetContext() { if (_primaryRenderer) _primaryRenderer.resetContext(); }
  function updateContextPanel() { if (_primaryRenderer) _primaryRenderer.updateContextPanel(); }
  function toggleContextPanel() { if (_primaryRenderer) _primaryRenderer.toggleContextPanel(); }

  // addToMessages, scroll wiring, newMsgBtn -> now in pane-renderer.js
  var newMsgBtn = $("new-msg-btn");
  function addToMessages(el) { if (_primaryRenderer) _primaryRenderer.addToMessages(el); }

  // Fork session handler -> now in pane-renderer.js
  // scrollToBottom, forceScrollToBottom -> now delegated to pane renderer
  function scrollToBottom() { if (_primaryRenderer) _primaryRenderer.scrollToBottom(); }
  function forceScrollToBottom() { if (_primaryRenderer) _primaryRenderer.forceScrollToBottom(); }

  // --- Primary Pane Renderer ---
  var _primaryRenderer = initPaneRenderer({
    $: $,
    paneEl: primaryPaneEl,
    messagesEl: messagesEl,
    inputEl: inputEl,
    sendBtn: sendBtn,
    connectOverlay: connectOverlay,
    newMsgBtn: newMsgBtn,
    suggestionChipsEl: suggestionChipsEl,
    get ws() { return ws; },
    get connected() { return connected; },
    // Module instances — wired after tools init below
    modules: null,
    // Singleton tools accessor for primary pane (set after initTools)
    toolsSingleton: null,
    // Global callbacks
    getStatusDot: getStatusDot,
    getStatusArea: function () { return document.querySelector(".title-bar-content .status"); },
    setSendBtnMode: function (mode) { setSendBtnMode(mode); },
    startVerbCycle: function () { startVerbCycle(); },
    stopVerbCycle: function () { stopVerbCycle(); },
    startUrgentBlink: function () { startUrgentBlink(); },
    stopUrgentBlink: function () { stopUrgentBlink(); },
    showImageModal: showImageModal,
    showPasteModal: function (text) { showPasteModal(text); },
    showConfirm: showConfirm,
    sendMessage: function () { sendMessage(); },
    autoResize: function () { autoResize(); },
    enableMainInput: function () { enableMainInput(); },
    clearPendingImages: function () { clearPendingImages(); },
    setRewindMode: function (v) { setRewindMode(v); },
    showRewindModal: function (msg) { showRewindModal(msg); },
    clearPendingRewindUuid: function () { clearPendingRewindUuid(); },
    addRewindButton: function (el) { addRewindButton(el); },
    removeSearchTimeline: function () { removeSearchTimeline(); },
    getActiveSearchQuery: function () { return getActiveSearchQuery(); },
    buildSearchTimeline: function (q) { buildSearchTimeline(q); },
    getPendingNavigate: function () { return getPendingNavigate(); },
    handleInputSync: function (text) { if (!dmMode) handleInputSync(text); },
    hideHomeHub: function () { hideHomeHub(); },
    closeSessionInfoPopover: function () { closeSessionInfoPopover(); },
    updateRalphBars: function () { updateRalphBars(); },
    updateLoopInputVisibility: function (loop) { updateLoopInputVisibility(loop); },
    updateLoopButton: function () { updateLoopButton(); },
    showLoopBanner: function (show) { showLoopBanner(show); },
    updateLoopBanner: function (iter, max, phase) { updateLoopBanner(iter, max, phase); },
    enterCraftingMode: function (sessionId, taskId) { enterCraftingMode(sessionId, taskId); },
    handleRalphFilesStatus: function (msg, phase) {
      ralphFilesReady = { promptReady: msg.promptReady, judgeReady: msg.judgeReady, bothReady: msg.bothReady };
      if (msg.bothReady && (phase === "crafting" || phase === "approval")) {
        if (isSchedulerOpen()) {
          exitCraftingMode(msg.taskId);
        } else {
          showRalphApprovalBar(true);
        }
      }
      updateRalphApprovalStatus();
    },
    handleLoopRegistryFiles: function (msg) { handleLoopRegistryFiles(msg); },
    handleRalphFilesContent: function (msg) {
      ralphPreviewContent = { prompt: msg.prompt || "", judge: msg.judge || "" };
      openRalphPreviewModal();
    },
    // File browser delegates
    handleFsList: function (msg) { handleFsList(msg); },
    handleFsRead: function (msg) { handleFsRead(msg); },
    isProjectSettingsOpen: function () { return isProjectSettingsOpen(); },
    handleInstructionsRead: function (msg) { handleInstructionsRead(msg); },
    handleInstructionsWrite: function (msg) { handleInstructionsWrite(msg); },
    handleFileChanged: function (msg) { handleFileChanged(msg); },
    handleDirChanged: function (msg) { handleDirChanged(msg); },
    handleFileHistory: function (msg) { handleFileHistory(msg); },
    handleGitDiff: function (msg) { handleGitDiff(msg); },
    handleFileAt: function (msg) { handleFileAt(msg); },
    refreshIfOpen: function (path) { refreshIfOpen(path); },
    // Terminal delegates
    handleTermList: function (msg) { handleTermList(msg); },
    handleTermCreated: function (msg) { handleTermCreated(msg); },
    handleTermOutput: function (msg) { handleTermOutput(msg); },
    handleTermExited: function (msg) { handleTermExited(msg); },
    handleTermClosed: function (msg) { handleTermClosed(msg); },
    // Sticky notes delegates
    handleNotesList: function (msg) { handleNotesList(msg); },
    handleNoteCreated: function (msg) { handleNoteCreated(msg); },
    handleNoteUpdated: function (msg) { handleNoteUpdated(msg); },
    handleNoteDeleted: function (msg) { handleNoteDeleted(msg); },
    // Notification delegates
    showDoneNotification: function () { showDoneNotification(); },
    playDoneSound: function () { playDoneSound(); },
    isNotifAlertEnabled: function () { return isNotifAlertEnabled(); },
    isNotifSoundEnabled: function () { return isNotifSoundEnabled(); },
    // Phase 3D: update primary pane header on session switch
    onSessionSwitched: function(sessionId, title) {
      var primaryPane = document.querySelector('.pane[data-pane-id="primary"]');
      if (primaryPane) {
        var titleEl = primaryPane.querySelector(".pane-header-title-text");
        if (titleEl) titleEl.textContent = title || "Session";
      }
    },
  });

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get turnCounter() { return _primaryRenderer ? _primaryRenderer.turnCounter : 0; },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showImageModal: showImageModal,
    openFile: function(filePath, opts) { openFile(filePath, opts); },
    getContextPercent: function() {
      return _primaryRenderer ? _primaryRenderer.getContextPercent() : 0;
    },
  });

  // Wire the tools singleton into the primary renderer
  // (tools was initialized as a singleton via initTools, so we expose its API)
  _primaryRenderer.toolsSingleton = {
    closeToolGroup: closeToolGroup,
    resetToolState: resetToolState,
    markAllToolsDone: markAllToolsDone,
    saveToolState: saveToolState,
    restoreToolState: restoreToolState,
    getTools: getTools,
    getTodoTools: getTodoTools,
    createToolItem: createToolItem,
    updateToolExecuting: updateToolExecuting,
    updateToolResult: updateToolResult,
    addTurnMeta: addTurnMeta,
    renderPermissionRequest: renderPermissionRequest,
    markPermissionCancelled: markPermissionCancelled,
    markPermissionResolved: markPermissionResolved,
    renderElicitationRequest: renderElicitationRequest,
    markElicitationResolved: markElicitationResolved,
    startThinking: startThinking,
    appendThinking: appendThinking,
    stopThinking: stopThinking,
    resetThinkingGroup: resetThinkingGroup,
    renderAskUserQuestion: renderAskUserQuestion,
    markAskUserAnswered: markAskUserAnswered,
    initSubagentStop: initSubagentStop,
    updateSubagentActivity: updateSubagentActivity,
    addSubagentToolEntry: addSubagentToolEntry,
    markSubagentDone: markSubagentDone,
    updateSubagentProgress: updateSubagentProgress,
    handleTodoWrite: handleTodoWrite,
    handleTaskCreate: handleTaskCreate,
    handleTaskUpdate: handleTaskUpdate,
    renderPlanBanner: renderPlanBanner,
    renderPlanCard: renderPlanCard,
    setPlanContent: setPlanContent,
    getPlanContent: getPlanContent,
    isPlanFilePath: isPlanFilePath,
    removeToolFromGroup: removeToolFromGroup,
  };

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- Messages, streaming, rate limit, fast mode, suggestion chips, resetClientState ---
  // All delegated to pane renderer (pane-renderer.js)
  function addUserMessage(text, images, pastes) { if (_primaryRenderer) _primaryRenderer.addUserMessage(text, images, pastes); }
  function ensureAssistantBlock() { if (_primaryRenderer) return _primaryRenderer.ensureAssistantBlock(); }
  function appendDelta(text) { if (_primaryRenderer) _primaryRenderer.appendDelta(text); }
  function flushStreamBuffer() { if (_primaryRenderer) _primaryRenderer.flushStreamBuffer(); }
  function finalizeAssistantBlock() { if (_primaryRenderer) _primaryRenderer.finalizeAssistantBlock(); }
  function addSystemMessage(text, isError) { if (_primaryRenderer) _primaryRenderer.addSystemMessage(text, isError); }
  function addConflictMessage(msg) { if (_primaryRenderer) _primaryRenderer.addConflictMessage(msg); }
  function addContextOverflowMessage(msg) { if (_primaryRenderer) _primaryRenderer.addContextOverflowMessage(msg); }
  function handleRateLimitEvent(msg) { if (_primaryRenderer) _primaryRenderer.handleRateLimitEvent(msg); }
  function clearRateLimitIndicator() { if (_primaryRenderer) _primaryRenderer.clearRateLimitIndicator(); }
  function handleFastModeState(state) { if (_primaryRenderer) _primaryRenderer.handleFastModeState(state); }
  function showSuggestionChips(suggestion) { if (_primaryRenderer) _primaryRenderer.showSuggestionChips(suggestion); }
  function hideSuggestionChips() { if (_primaryRenderer) _primaryRenderer.hideSuggestionChips(); }
  function resetClientState() { if (_primaryRenderer) _primaryRenderer.resetClientState(); }

  // Convenience accessor for per-pane state that app.js still references
  // These read from the primary renderer when it exists
  Object.defineProperty(window, '_clayActiveSessionId', {
    get: function () { return _primaryRenderer ? _primaryRenderer.activeSessionId : null; },
    set: function (v) { if (_primaryRenderer) _primaryRenderer.activeSessionId = v; },
  });
  // Backwards-compat: local-scope getters that replace the old closure vars.
  // We use a global shim since we can't redefine `var` in the same IIFE scope.
  // Instead we'll access them through functions:
  function getActiveSessionId() { return _primaryRenderer ? _primaryRenderer.activeSessionId : null; }
  function getLoopActive() { return _primaryRenderer ? _primaryRenderer.loopActive : false; }
  function getCliSessionId() { return _primaryRenderer ? _primaryRenderer.cliSessionId : null; }
  function getTurnCounter() { return _primaryRenderer ? _primaryRenderer.turnCounter : 0; }
  function getMessageUuidMap() { return _primaryRenderer ? _primaryRenderer.messageUuidMap : []; }

  // --- Project switching (no full reload) ---
  function switchProject(slug) {
    if (!slug) return;
    if (dmMode) exitDmMode();
    if (homeHubVisible) {
      hideHomeHub();
      if (slug === currentSlug) return;
    }
    if (slug === currentSlug) return;
    resetFileBrowser();
    closeArchive();
    if (isSchedulerOpen()) closeScheduler();
    resetScheduler(slug);
    currentSlug = slug;
    basePath = "/p/" + slug + "/";
    wsPath = "/p/" + slug + "/ws";
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", basePath);
    } else {
      history.pushState(null, "", basePath);
    }
    resetClientState();
    connect();
  }

  window.addEventListener("popstate", function () {
    var m = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
    var newSlug = m ? m[1] : null;
    if (newSlug && newSlug !== currentSlug) {
      resetFileBrowser();
      closeArchive();
      if (isSchedulerOpen()) closeScheduler();
      resetScheduler(newSlug);
      currentSlug = newSlug;
      basePath = "/p/" + newSlug + "/";
      wsPath = "/p/" + newSlug + "/ws";
      resetClientState();
      connect();
    }
  });

  // --- WebSocket ---
  var connectTimeoutId = null;

  function connect() {
    if (ws) { ws.onclose = null; ws.close(); }
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + wsPath);


    // If not connected within 3s, force retry
    connectTimeoutId = setTimeout(function () {
      if (!connected) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        connect();
      }
    }, 3000);

    ws.onopen = function () {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      // Cancel pending "connection lost" notification if reconnected quickly
      if (disconnectNotifTimer) {
        clearTimeout(disconnectNotifTimer);
        disconnectNotifTimer = null;
      }
      // Only show "restored" notification if "lost" was actually shown
      if (wasConnected && disconnectNotifShown && !document.hasFocus() && "serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification("Clay", {
            body: "Server connection restored",
            tag: "claude-disconnect",
          });
        }).catch(function () {});
      }
      disconnectNotifShown = false;
      wasConnected = true;
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

      // Wrap ws.send to blink LED on outgoing traffic
      var _origSend = ws.send.bind(ws);
      ws.send = function (data) {
        blinkIO();
        return _origSend(data);
      };

      // Reset terminal xterm instances (server will send fresh term_list)
      resetTerminals();

      // Re-send push subscription on reconnect
      if (window._pushSubscription) {
        try {
          ws.send(JSON.stringify({
            type: "push_subscribe",
            subscription: window._pushSubscription.toJSON(),
          }));
        } catch(e) {}
      }
    };

    ws.onclose = function (e) {
      if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
      setStatus("disconnected");
      setActivity(null);
      // Delay "connection lost" notification by 5s to suppress brief disconnects
      if (!disconnectNotifTimer) {
        disconnectNotifTimer = setTimeout(function () {
          disconnectNotifTimer = null;
          disconnectNotifShown = true;
          if (!document.hasFocus() && "serviceWorker" in navigator) {
            navigator.serviceWorker.ready.then(function (reg) {
              reg.showNotification("Clay", {
                body: "Server connection lost",
                tag: "claude-disconnect",
              });
            }).catch(function () {});
          }
        }, 5000);
      }
      scheduleReconnect();
    };

    ws.onerror = function () {
    };

    ws.onmessage = function (event) {
      // Backup: if we're receiving messages, we're connected
      if (!connected) {
        setStatus("connected");
        reconnectDelay = 1000;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }

      blinkIO();
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      processMessage(msg);
    };
  }

  // --- Message type routing ---
  var GLOBAL_MESSAGE_TYPES = {
    info: 1, update_available: 1, update_started: 1,
    slash_commands: 1, model_info: 1, config_state: 1,
    client_count: 1, toast: 1,
    skill_installed: 1, skill_uninstalled: 1,
    loop_registry_updated: 1, schedule_run_started: 1, schedule_run_finished: 1,
    loop_scheduled: 1, schedule_move_result: 1,
    remove_project_check_result: 1, hub_schedules: 1,
    session_list: 1, session_presence: 1, agent_status: 1, session_io: 1,
    search_results: 1, cli_session_list: 1,
    process_stats: 1,
    browse_dir_result: 1, add_project_result: 1, remove_project_result: 1,
    reorder_projects_result: 1, set_project_title_result: 1, set_project_icon_result: 1,
    projects_updated: 1,
    dm_history: 1, dm_message: 1, dm_typing: 1, dm_list: 1,
    daemon_config: 1, set_pin_result: 1, set_keep_awake_result: 1,
    keep_awake_changed: 1, restart_server_result: 1, shutdown_server_result: 1,
    project_env_result: 1, set_project_env_result: 1,
    global_claude_md_result: 1, write_global_claude_md_result: 1,
    shared_env_result: 1, set_shared_env_result: 1,
  };

  function processMessage(msg) {
    if (GLOBAL_MESSAGE_TYPES[msg.type]) {
      processGlobalMessage(msg);
    } else {
      processPaneMessage(msg);
    }
  }

  function processGlobalMessage(msg) {
      switch (msg.type) {
        case "info":
          if (msg.text && !msg.project && !msg.cwd) {
            addSystemMessage(msg.text, false);
            break;
          }
          projectName = msg.project || msg.cwd;
          if (msg.slug) currentSlug = msg.slug;
          try { localStorage.setItem("clay-project-name-" + (currentSlug || "default"), projectName); } catch (e) {}
          headerTitleEl.textContent = projectName;
          var tbProjectName = $g("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || projectName;
          updatePageTitle();
          if (msg.version) {
            var vEl = $g("footer-version");
            if (vEl) vEl.textContent = "v" + msg.version;
          }
          if (msg.lanHost) window.__lanHost = msg.lanHost;
          if (msg.dangerouslySkipPermissions) {
            skipPermsEnabled = true;
            var spBanner = $g("skip-perms-pill");
            if (spBanner) spBanner.classList.remove("hidden");
          }
          updateProjectList(msg);
          break;

        case "update_available":
          var updatePillWrap = $g("update-pill-wrap");
          var updateVersion = $g("update-version");
          if (updatePillWrap && updateVersion && msg.version) {
            updateVersion.textContent = "v" + msg.version;
            updatePillWrap.classList.remove("hidden");
            var updResetBtn = $g("update-now");
            if (updResetBtn) {
              updResetBtn.innerHTML = '<i data-lucide="download"></i> Update now';
              updResetBtn.disabled = false;
            }
            refreshIcons();
          }
          var settingsUpdBtn = $g("settings-update-check");
          if (settingsUpdBtn && msg.version) {
            settingsUpdBtn.innerHTML = "";
            var ic = document.createElement("i");
            ic.setAttribute("data-lucide", "arrow-up-circle");
            settingsUpdBtn.appendChild(ic);
            settingsUpdBtn.appendChild(document.createTextNode(" Update available (v" + msg.version + ")"));
            settingsUpdBtn.classList.add("settings-btn-update-available");
            settingsUpdBtn.disabled = false;
            refreshIcons();
          }
          break;

        case "update_started":
          var updNowBtn = $g("update-now");
          if (updNowBtn) {
            updNowBtn.innerHTML = '<i data-lucide="loader"></i> Updating...';
            updNowBtn.disabled = true;
            refreshIcons();
            var spinIcon = updNowBtn.querySelector(".lucide");
            if (spinIcon) spinIcon.classList.add("icon-spin-inline");
          }
          connectOverlay.classList.remove("hidden");
          break;

        case "slash_commands":
          var reserved = new Set(builtinCommands.map(function (c) { return c.name; }));
          slashCommands = (msg.commands || []).filter(function (name) {
            return !reserved.has(name);
          }).map(function (name) {
            return { name: name, desc: "Skill" };
          });
          break;

        case "model_info":
          currentModel = msg.model || currentModel;
          currentModels = msg.models || [];
          updateConfigChip();
          updateSettingsModels(msg.model, msg.models || []);
          break;

        case "config_state":
          if (msg.model) currentModel = msg.model;
          if (msg.mode) currentMode = msg.mode;
          if (msg.effort) currentEffort = msg.effort;
          if (msg.betas) currentBetas = msg.betas;
          if (msg.thinking) currentThinking = msg.thinking;
          if (msg.thinkingBudget) currentThinkingBudget = msg.thinkingBudget;
          if (currentModels.length > 0) {
            var levels = getModelEffortLevels();
            var effortValid = false;
            for (var ei = 0; ei < levels.length; ei++) {
              if (levels[ei] === currentEffort) { effortValid = true; break; }
            }
            if (!effortValid) currentEffort = "medium";
          }
          updateConfigChip();
          break;

        case "client_count":
          if (msg.users) {
            renderSidebarPresence(msg.users);
          }
          if (!msg.users) {
            var countEl = document.getElementById("client-count");
            var countTextEl = document.getElementById("client-count-text");
            if (countEl && countTextEl) {
              if (msg.count > 1) {
                countTextEl.textContent = msg.count + " connected";
                countEl.classList.remove("hidden");
              } else {
                countEl.classList.add("hidden");
              }
            }
          }
          break;

        case "toast":
          showToast(msg.message, msg.level, msg.detail);
          break;

        case "skill_installed":
          handleSkillInstalled(msg);
          if (msg.success) knownInstalledSkills[msg.skill] = true;
          handleSkillInstallWs(msg);
          break;

        case "skill_uninstalled":
          handleSkillUninstalled(msg);
          if (msg.success) delete knownInstalledSkills[msg.skill];
          break;

        case "loop_registry_updated":
          handleLoopRegistryUpdated(msg);
          break;

        case "schedule_run_started":
          handleScheduleRunStarted(msg);
          break;

        case "schedule_run_finished":
          handleScheduleRunFinished(msg);
          break;

        case "loop_scheduled":
          handleLoopScheduled(msg);
          break;

        case "schedule_move_result":
          if (msg.ok) {
            showToast("Task moved", "success");
          } else {
            showToast(msg.error || "Failed to move task", "error");
          }
          break;

        case "remove_project_check_result":
          handleRemoveProjectCheckResult(msg);
          break;

        case "hub_schedules":
          handleHubSchedules(msg);
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "session_presence":
          updateSessionPresence(msg.presence || {});
          break;

        case "agent_status":
          updateAgentStatus(msg.sessionId, msg.status);
          // Update pane header dots for any pane showing this session
          for (var _p of getPanes().values()) {
            if (_p.sessionId === msg.sessionId) {
              updatePaneHeader(_p.id, undefined, msg.status);
            }
          }
          break;

        case "session_io":
          blinkSessionDot(msg.id);
          break;

        case "search_results":
          handleSearchResults(msg);
          break;

        case "cli_session_list":
          populateCliSessionList(msg.sessions || []);
          break;

        case "process_stats":
          updateStatusPanel(msg);
          updateSettingsStats(msg);
          break;

        case "browse_dir_result":
          handleBrowseDirResult(msg);
          break;

        case "add_project_result":
          handleAddProjectResult(msg);
          break;

        case "remove_project_result":
          handleRemoveProjectResult(msg);
          break;

        case "reorder_projects_result":
          if (!msg.ok) {
            showToast(msg.error || "Failed to reorder projects", "error");
          }
          break;

        case "set_project_title_result":
          if (!msg.ok) {
            showToast(msg.error || "Failed to rename project", "error");
          }
          break;

        case "set_project_icon_result":
          if (!msg.ok) {
            showToast(msg.error || "Failed to set icon", "error");
          }
          break;

        case "projects_updated":
          updateProjectList(msg);
          break;

        // --- DM ---
        case "dm_history":
          enterDmMode(msg.dmKey, msg.targetUser, msg.messages);
          break;

        case "dm_message":
          if (dmMode && msg.dmKey === dmKey) {
            showDmTypingIndicator(false);
            appendDmMessage(msg.message);
            scrollToBottom();
          } else if (msg.message) {
            var fromId = msg.message.from;
            if (fromId && fromId !== myUserId) {
              dmUnread[fromId] = (dmUnread[fromId] || 0) + 1;
              updateDmBadge(fromId, dmUnread[fromId]);
            }
          }
          break;

        case "dm_typing":
          if (dmMode && msg.dmKey === dmKey) {
            showDmTypingIndicator(msg.typing);
          }
          break;

        case "dm_list":
          break;

        case "daemon_config":
          updateDaemonConfig(msg.config);
          break;

        case "set_pin_result":
          handleSetPinResult(msg);
          break;

        case "set_keep_awake_result":
          handleKeepAwakeChanged(msg);
          break;

        case "keep_awake_changed":
          handleKeepAwakeChanged(msg);
          break;

        case "restart_server_result":
          handleRestartResult(msg);
          break;

        case "shutdown_server_result":
          handleShutdownResult(msg);
          break;

        case "project_env_result":
          handleProjectEnv(msg);
          break;

        case "set_project_env_result":
          handleProjectEnvSaved(msg);
          break;

        case "global_claude_md_result":
          handleGlobalClaudeMdRead(msg);
          break;

        case "write_global_claude_md_result":
          handleGlobalClaudeMdWrite(msg);
          break;

        case "shared_env_result":
          handleSharedEnv(msg);
          handleProjectSharedEnv(msg);
          break;

        case "set_shared_env_result":
          handleSharedEnvSaved(msg);
          handleProjectSharedEnvSaved(msg);
          break;
      }
  }

  // processPaneMessage, updateHistorySentinel, requestMoreHistory, prependOlderHistory
  // -> all in pane-renderer.js now
  function processPaneMessage(msg) { if (_primaryRenderer) _primaryRenderer.processPaneMessage(msg); }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      // Check if auth is still valid before reconnecting
      fetch("/info").then(function (res) {
        if (res.status === 401) {
          location.reload();
          return;
        }
        connect();
      }).catch(function () {
        // Server still down, try connecting anyway
        connect();
      });
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
  }

  // --- Input module (sendMessage, autoResize, paste/image, slash menu, input handlers) ---
  initInput({
    get ws() { return ws; },
    get connected() { return connected; },
    get processing() { return _primaryRenderer ? _primaryRenderer.processing : false; },
    get basePath() { return basePath; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return slashCommands; },
    messageUuidMap: function() { return _primaryRenderer ? _primaryRenderer.messageUuidMap : []; },
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
    toggleContextPanel: toggleContextPanel,
    resetContextData: resetContextData,
    showImageModal: showImageModal,
    hideSuggestionChips: hideSuggestionChips,
    setSendBtnMode: setSendBtnMode,
    isDmMode: function () { return dmMode; },
    getDmKey: function () { return dmKey; },
    handleDmSend: function () { handleDmSend(); },
    setRewindMode: setRewindMode,
    isRewindMode: isRewindMode,
  });

  // --- STT module (voice input via Web Speech API) ---
  initSTT({
    inputEl: inputEl,
    addSystemMessage: addSystemMessage,
  });

  // --- User profile (Discord-style popover on user island) ---
  initProfile({
    basePath: basePath,
  });

  // --- Admin (multi-user mode) ---
  var isMultiUserMode = false;
  var myUserId = null;
  initAdmin({
    get projectList() { return cachedProjects; },
  });
  fetch("/api/me").then(function (r) { return r.json(); }).then(function (d) {
    if (d.multiUser) isMultiUserMode = true;
    if (d.user && d.user.id) myUserId = d.user.id;
  }).catch(function () {});
  // Hide server settings and update controls for non-admin users in multi-user mode
  checkAdminAccess().then(function (isAdmin) {
    if (isMultiUserMode && !isAdmin) {
      var settingsBtn = document.getElementById("server-settings-btn");
      if (settingsBtn) settingsBtn.style.display = "none";
      var updatePill = document.getElementById("update-pill-wrap");
      if (updatePill) updatePill.style.display = "none";
    }
  });

  // --- Notifications module (viewport, banners, notifications, debug, service worker) ---
  initNotifications({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    scrollToBottom: scrollToBottom,
    basePath: basePath,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
  });

  // --- Server Settings ---
  initServerSettings({
    get ws() { return ws; },
    get projectName() { return projectName; },
    get currentSlug() { return currentSlug; },
    wsPath: wsPath,
    get currentModels() { return currentModels; },
    set currentModels(v) { currentModels = v; updateConfigChip(); },
    get currentModel() { return currentModel; },
    get currentMode() { return currentMode; },
    get currentEffort() { return currentEffort; },
    get currentBetas() { return currentBetas; },
    setContextView: setContextView,
    applyContextView: applyContextView,
  });

  // --- Project Settings ---
  initProjectSettings({
    get ws() { return ws; },
    get connected() { return connected; },
    get currentModels() { return currentModels; },
    get currentModel() { return currentModel; },
    get currentMode() { return currentMode; },
    get currentEffort() { return currentEffort; },
    get currentBetas() { return currentBetas; },
  }, getEmojiCategories());

  // --- QR code ---
  initQrCode();

  // --- File browser ---
  initFileBrowser({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return getActiveSessionId(); },
    messagesEl: messagesEl,
    fileTreeEl: $g("file-tree"),
    fileViewerEl: $("file-viewer"),
    closeSidebar: function() { closeSidebar(); },
  });

  // --- Terminal ---
  initTerminal({
    get ws() { return ws; },
    get connected() { return connected; },
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
    closeSidebar: function() { closeSidebar(); },
    closeFileViewer: function() { closeFileViewer(); },
  });

  // --- Playbook Engine ---
  initPlaybook();

  // --- Sticky Notes ---
  initStickyNotes({
    get ws() { return ws; },
    get connected() { return connected; },
  });

  // --- Pane Manager ---
  initPaneManager({
    get basePath() { return basePath; },
    get wsPath() { return wsPath; },
    showImageModal: showImageModal,
    showPasteModal: function(t) { showPasteModal(t); },
    showConfirm: showConfirm,
    showRewindModal: function(m) { showRewindModal(m); },
    startUrgentBlink: function() { startUrgentBlink(); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showDoneNotification: function() { showDoneNotification(); },
    playDoneSound: function() { playDoneSound(); },
    isNotifAlertEnabled: function() { return isNotifAlertEnabled(); },
    isNotifSoundEnabled: function() { return isNotifSoundEnabled(); },
    slashCommands: function () { return slashCommands; },
  });

  // Wire primary pane header buttons
  var primaryPaneSplitH = primaryPaneEl.querySelector(".pane-split-h-btn");
  var primaryPaneSplitV = primaryPaneEl.querySelector(".pane-split-v-btn");
  var primaryPaneCloseBtn = primaryPaneEl.querySelector(".pane-close-btn");
  if (primaryPaneSplitH) {
    primaryPaneSplitH.addEventListener("click", function () {
      splitPane("horizontal");
    });
  }
  if (primaryPaneSplitV) {
    primaryPaneSplitV.addEventListener("click", function () {
      splitPane("vertical");
    });
  }
  if (primaryPaneCloseBtn) {
    primaryPaneCloseBtn.addEventListener("click", function () {
      // Don't close the primary pane if it's the only one
      if (getPaneCount() > 1) {
        // For now, just close the pane
      }
    });
  }

  // --- Sticky Notes sidebar button (archive view) ---
  var stickyNotesSidebarBtn = $g("sticky-notes-sidebar-btn");
  if (stickyNotesSidebarBtn) {
    stickyNotesSidebarBtn.addEventListener("click", function () {
      if (isSchedulerOpen()) closeScheduler();
      if (isArchiveOpen()) {
        closeArchive();
      } else {
        openArchive();
      }
    });
  }

  // Close archive / scheduler panel when switching to other sidebar panels
  var fileBrowserBtn = $g("file-browser-btn");
  var terminalSidebarBtn = $g("terminal-sidebar-btn");
  if (fileBrowserBtn) fileBrowserBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });
  if (terminalSidebarBtn) terminalSidebarBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });

  // --- Ralph Loop UI ---
  function updateLoopInputVisibility(loop) {
    var inputArea = $("input-area");
    if (!inputArea) return;
    if (loop && loop.active && loop.role !== "crafting") {
      inputArea.style.display = "none";
    } else {
      inputArea.style.display = "";
    }
  }

  function updateLoopButton() {
    var section = document.getElementById("ralph-loop-section");
    if (!section) return;

    var busy = getLoopActive() || ralphPhase === "executing";
    var phase = busy ? "executing" : ralphPhase;

    var statusHtml = "";
    var statusClass = "";
    var clickAction = "wizard"; // default

    if (phase === "crafting") {
      statusHtml = '<span class="ralph-section-status crafting">' + iconHtml("loader", "icon-spin") + ' Crafting\u2026</span>';
      clickAction = "none";
    } else if (phase === "approval") {
      statusHtml = '<span class="ralph-section-status ready">Ready</span>';
      statusClass = "ralph-section-ready";
      clickAction = "none";
    } else if (phase === "executing") {
      var _loopIter = _primaryRenderer ? _primaryRenderer.loopIteration : 0;
      var _loopMax = _primaryRenderer ? _primaryRenderer.loopMaxIterations : 0;
      var iterText = _loopIter > 0 ? "Running \u00b7 iteration " + _loopIter + "/" + _loopMax : "Starting\u2026";
      statusHtml = '<span class="ralph-section-status running">' + iconHtml("loader", "icon-spin") + ' ' + iterText + '</span>';
      statusClass = "ralph-section-running";
      clickAction = "popover";
    } else if (phase === "done") {
      statusHtml = '<span class="ralph-section-status done">\u2713 Done</span>';
      statusHtml += '<a href="#" class="ralph-section-tasks-link">View in Scheduled Tasks</a>';
      statusClass = "ralph-section-done";
      clickAction = "wizard";
    } else {
      // idle
      statusHtml = '<span class="ralph-section-hint">Start a new loop</span>';
    }

    section.className = "ralph-loop-section" + (statusClass ? " " + statusClass : "");
    section.innerHTML =
      '<div class="ralph-section-inner">' +
        '<div class="ralph-section-header">' +
          '<span class="ralph-section-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-section-label">Ralph Loop</span>' +
          '<span class="loop-experimental"><i data-lucide="flask-conical"></i> experimental</span>' +
        '</div>' +
        '<div class="ralph-section-body">' + statusHtml + '</div>' +
      '</div>';

    refreshIcons();

    // Click handler on header
    var header = section.querySelector(".ralph-section-header");
    if (header) {
      header.style.cursor = clickAction === "none" ? "default" : "pointer";
      header.addEventListener("click", function() {
        if (clickAction === "popover") {
          toggleLoopPopover();
        } else if (clickAction === "wizard") {
          openRalphWizard();
        }
      });
    }

    // "View in Scheduled Tasks" link
    var tasksLink = section.querySelector(".ralph-section-tasks-link");
    if (tasksLink) {
      tasksLink.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        openSchedulerToTab("library");
      });
    }
  }

  function toggleLoopPopover() {
    var existing = document.getElementById("loop-status-modal");
    if (existing) {
      existing.remove();
      return;
    }

    var taskPreview = wizardData.task || "—";
    if (taskPreview.length > 120) taskPreview = taskPreview.substring(0, 120) + "\u2026";
    var statusText = "Iteration #" + (_primaryRenderer ? _primaryRenderer.loopIteration : 0) + " / " + (_primaryRenderer ? _primaryRenderer.loopMaxIterations : 0);

    var modal = document.createElement("div");
    modal.id = "loop-status-modal";
    modal.className = "loop-status-modal";
    modal.innerHTML =
      '<div class="loop-status-backdrop"></div>' +
      '<div class="loop-status-dialog">' +
        '<div class="loop-status-dialog-header">' +
          '<span class="loop-status-dialog-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="loop-status-dialog-title">Ralph Loop</span>' +
          '<button class="loop-status-dialog-close" title="Close">' + iconHtml("x") + '</button>' +
        '</div>' +
        '<div class="loop-status-dialog-body">' +
          '<div class="loop-status-dialog-row">' +
            '<span class="loop-status-dialog-label">Progress</span>' +
            '<span class="loop-status-dialog-value">' + escapeHtml(statusText) + '</span>' +
          '</div>' +
          '<div class="loop-status-dialog-row">' +
            '<span class="loop-status-dialog-label">Task</span>' +
            '<span class="loop-status-dialog-value loop-status-dialog-task">' + escapeHtml(taskPreview) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="loop-status-dialog-footer">' +
          '<button class="loop-status-dialog-stop">' + iconHtml("square") + ' Stop loop</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    refreshIcons();

    function closeModal() { modal.remove(); }

    modal.querySelector(".loop-status-backdrop").addEventListener("click", closeModal);
    modal.querySelector(".loop-status-dialog-close").addEventListener("click", closeModal);

    modal.querySelector(".loop-status-dialog-stop").addEventListener("click", function(e) {
      e.stopPropagation();
      closeModal();
      showConfirm("Stop the running Ralph Loop?", function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "loop_stop" }));
        }
      });
    });
  }

  function showLoopBanner(show) {
    var stickyEl = $("ralph-sticky");
    if (!stickyEl) { updateLoopButton(); return; }
    if (!show) {
      stickyEl.classList.add("hidden");
      stickyEl.classList.remove("ralph-running");
      stickyEl.innerHTML = "";
      updateLoopButton();
      return;
    }

    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">Ralph Loop</span>' +
          '<span class="ralph-sticky-status" id="loop-status">Starting\u2026</span>' +
          '<button class="ralph-sticky-action ralph-sticky-stop" title="Stop loop">' + iconHtml("square") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden", "ralph-ready");
    stickyEl.classList.add("ralph-running");
    refreshIcons();

    stickyEl.querySelector(".ralph-sticky-stop").addEventListener("click", function(e) {
      e.stopPropagation();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "loop_stop" }));
      }
    });
    updateLoopButton();
  }

  function updateLoopBanner(iteration, maxIterations, phase) {
    var statusEl = document.getElementById("loop-status");
    if (!statusEl) return;
    var text = "#" + iteration + "/" + maxIterations;
    if (phase === "judging") text += " judging\u2026";
    else if (phase === "stopping") text = "Stopping\u2026";
    else text += " running";
    statusEl.textContent = text;
  }

  function updateRalphBars() {
    var onCraftingSession = ralphCraftingSessionId && getActiveSessionId() === ralphCraftingSessionId;
    // If approval phase but no craftingSessionId (recovered after server restart), show bar anyway
    var recoveredApproval = ralphPhase === "approval" && !ralphCraftingSessionId;
    if (ralphPhase === "crafting" && onCraftingSession) {
      showRalphCraftingBar(true);
    } else {
      showRalphCraftingBar(false);
    }
    if (ralphPhase === "approval" && (onCraftingSession || recoveredApproval)) {
      showRalphApprovalBar(true);
    } else {
      showRalphApprovalBar(false);
    }
  }

  // --- Skill install dialog (generic) ---
  var skillInstallModal = document.getElementById("skill-install-modal");
  var skillInstallTitle = document.getElementById("skill-install-title");
  var skillInstallReason = document.getElementById("skill-install-reason");
  var skillInstallList = document.getElementById("skill-install-list");
  var skillInstallOk = document.getElementById("skill-install-ok");
  var skillInstallCancel = document.getElementById("skill-install-cancel");
  var skillInstallStatus = document.getElementById("skill-install-status");

  var pendingSkillInstalls = []; // [{ name, url, scope, installed }]
  var skillInstallCallback = null;
  var skillInstalling = false;
  var knownInstalledSkills = {}; // client-side cache of installed skills

  function renderSkillInstallDialog(opts, missing) {
    skillInstallTitle.textContent = opts.title || "Skill Installation Required";
    skillInstallReason.textContent = opts.reason || "";
    skillInstallList.innerHTML = "";
    for (var i = 0; i < missing.length; i++) {
      var s = missing[i];
      var item = document.createElement("div");
      item.className = "skill-install-item";
      item.setAttribute("data-skill", s.name);
      item.innerHTML = '<span class="skill-icon">&#x1f9e9;</span>' +
        '<div class="skill-info">' +
          '<span class="skill-name">' + escapeHtml(s.name) + '</span>' +
          '<span class="skill-scope">' + escapeHtml(s.scope || "global") + '</span>' +
        '</div>' +
        '<span class="skill-status"></span>';
      skillInstallList.appendChild(item);
    }
    skillInstallStatus.classList.add("hidden");
    skillInstallStatus.innerHTML = "";
    skillInstallOk.disabled = false;
    skillInstallOk.textContent = "Install";
    skillInstallOk.className = "confirm-btn confirm-delete";
    skillInstallModal.classList.remove("hidden");
  }

  function hideSkillInstallModal() {
    skillInstallModal.classList.add("hidden");
    skillInstallCallback = null;
    pendingSkillInstalls = [];
    skillInstalling = false;
    skillInstallDone = false;
  }

  skillInstallCancel.addEventListener("click", hideSkillInstallModal);
  skillInstallModal.querySelector(".confirm-backdrop").addEventListener("click", hideSkillInstallModal);

  var skillInstallDone = false;

  skillInstallOk.addEventListener("click", function () {
    // "Proceed" state — all done, close and invoke callback
    if (skillInstallDone) {
      var proceedCb = skillInstallCallback;
      skillInstallCallback = null;
      hideSkillInstallModal();
      if (proceedCb) proceedCb();
      return;
    }
    if (skillInstalling) return;
    skillInstalling = true;
    skillInstallOk.disabled = true;
    skillInstallOk.textContent = "Installing...";

    var total = 0;
    for (var i = 0; i < pendingSkillInstalls.length; i++) {
      if (!pendingSkillInstalls[i].installed) total++;
    }
    skillInstallStatus.classList.remove("hidden");
    updateSkillInstallProgress(0, total);

    for (var j = 0; j < pendingSkillInstalls.length; j++) {
      var s = pendingSkillInstalls[j];
      if (s.installed) continue;
      fetch(basePath + "api/install-skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.url, skill: s.name, scope: s.scope || "global" }),
      }).catch(function () {});
    }
  });

  function updateSkillInstallProgress(done, total) {
    skillInstallStatus.innerHTML = '<div class="skills-spinner small"></div> Installing skills... (' + done + '/' + total + ')';
  }

  function updateSkillListItems() {
    var items = skillInstallList.querySelectorAll(".skill-install-item");
    for (var i = 0; i < items.length; i++) {
      var name = items[i].getAttribute("data-skill");
      for (var j = 0; j < pendingSkillInstalls.length; j++) {
        if (pendingSkillInstalls[j].name === name) {
          var statusEl = items[i].querySelector(".skill-status");
          if (pendingSkillInstalls[j].installed) {
            if (statusEl) {
              statusEl.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span>';
              refreshIcons();
            }
          }
          break;
        }
      }
    }
  }

  function handleSkillInstallWs(msg) {
    if (!skillInstalling || pendingSkillInstalls.length === 0) return;
    for (var i = 0; i < pendingSkillInstalls.length; i++) {
      if (pendingSkillInstalls[i].name === msg.skill) {
        if (msg.success) {
          pendingSkillInstalls[i].installed = true;
          knownInstalledSkills[msg.skill] = true;
        } else {
          skillInstalling = false;
          skillInstallOk.disabled = false;
          skillInstallOk.textContent = "Install";
          skillInstallStatus.innerHTML = "Failed to install " + escapeHtml(msg.skill) + ". Try again.";
          updateSkillListItems();
          return;
        }
      }
    }

    var doneCount = 0;
    var totalCount = pendingSkillInstalls.length;
    for (var k = 0; k < pendingSkillInstalls.length; k++) {
      if (pendingSkillInstalls[k].installed) doneCount++;
    }
    updateSkillListItems();
    updateSkillInstallProgress(doneCount, totalCount);

    if (doneCount === totalCount) {
      skillInstallDone = true;
      skillInstallStatus.innerHTML = '<span class="skill-status-ok">' + iconHtml("circle-check") + '</span> All skills installed successfully.';
      refreshIcons();
      skillInstallOk.disabled = false;
      skillInstallOk.textContent = "Proceed";
      skillInstallOk.className = "confirm-btn confirm-proceed";
    }
  }

  function requireSkills(opts, cb) {
    fetch(basePath + "api/installed-skills")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var installed = data.installed || {};
        var missing = [];
        for (var i = 0; i < opts.skills.length; i++) {
          var sName = opts.skills[i].name;
          if (!installed[sName] && !knownInstalledSkills[sName]) {
            missing.push({ name: sName, url: opts.skills[i].url, scope: opts.skills[i].scope || "global", installed: false });
          }
        }
        if (missing.length === 0) { cb(); return; }
        pendingSkillInstalls = missing;
        skillInstallCallback = cb;
        renderSkillInstallDialog(opts, missing);
      })
      .catch(function () { cb(); });
  }

  function requireClayRalph(cb) {
    requireSkills({
      title: "Skill Installation Required",
      reason: "This feature requires the following skill to be installed.",
      skills: [{ name: "clay-ralph", url: "https://github.com/chadbyte/clay-ralph", scope: "global" }]
    }, cb);
  }

  // --- Ralph Wizard ---

  function openRalphWizard() {
    requireClayRalph(function () {
      wizardData = { name: "", task: "", maxIterations: 3 };
      var el = document.getElementById("ralph-wizard");
      if (!el) return;

      var taskEl = document.getElementById("ralph-task");
      if (taskEl) taskEl.value = "";
      var iterEl = document.getElementById("ralph-max-iterations");
      if (iterEl) iterEl.value = "25";

      wizardStep = 1;
      el.classList.remove("hidden");
      var statusEl = document.getElementById("ralph-install-status");
      if (statusEl) { statusEl.classList.add("hidden"); statusEl.innerHTML = ""; }
      updateWizardStep();
    });
  }

  function closeRalphWizard() {
    var el = document.getElementById("ralph-wizard");
    if (el) el.classList.add("hidden");
  }

  function updateWizardStep() {
    var steps = document.querySelectorAll(".ralph-step");
    for (var i = 0; i < steps.length; i++) {
      var stepNum = parseInt(steps[i].getAttribute("data-step"), 10);
      if (stepNum === wizardStep) {
        steps[i].classList.add("active");
      } else {
        steps[i].classList.remove("active");
      }
    }
    var dots = document.querySelectorAll(".ralph-dot");
    for (var j = 0; j < dots.length; j++) {
      var dotStep = parseInt(dots[j].getAttribute("data-step"), 10);
      dots[j].classList.remove("active", "done");
      if (dotStep === wizardStep) dots[j].classList.add("active");
      else if (dotStep < wizardStep) dots[j].classList.add("done");
    }

    var backBtn = document.getElementById("ralph-wizard-back");
    var skipBtn = document.getElementById("ralph-wizard-skip");
    var nextBtn = document.getElementById("ralph-wizard-next");
    if (backBtn) backBtn.style.visibility = wizardStep === 1 ? "hidden" : "visible";
    if (skipBtn) skipBtn.style.display = "none";
    if (nextBtn) nextBtn.textContent = wizardStep === 2 ? "Launch" : "Get Started";
  }

  function collectWizardData() {
    var taskEl = document.getElementById("ralph-task");
    var iterEl = document.getElementById("ralph-max-iterations");
    wizardData.name = "";
    wizardData.task = taskEl ? taskEl.value.trim() : "";
    wizardData.maxIterations = iterEl ? parseInt(iterEl.value, 10) || 3 : 3;
    wizardData.cron = null;
  }

  function buildWizardCron() {
    var repeatEl = document.getElementById("ralph-repeat");
    if (!repeatEl) return null;
    var preset = repeatEl.value;
    if (preset === "none") return null;

    var timeEl = document.getElementById("ralph-time");
    var timeVal = timeEl ? timeEl.value : "09:00";
    var timeParts = timeVal.split(":");
    var hour = parseInt(timeParts[0], 10) || 9;
    var minute = parseInt(timeParts[1], 10) || 0;

    if (preset === "daily") return minute + " " + hour + " * * *";
    if (preset === "weekdays") return minute + " " + hour + " * * 1-5";
    if (preset === "weekly") return minute + " " + hour + " * * " + new Date().getDay();
    if (preset === "monthly") return minute + " " + hour + " " + new Date().getDate() + " * *";

    if (preset === "custom") {
      var unitEl = document.getElementById("ralph-repeat-unit");
      var unit = unitEl ? unitEl.value : "day";
      if (unit === "day") return minute + " " + hour + " * * *";
      if (unit === "month") return minute + " " + hour + " " + new Date().getDate() + " * *";
      // week: collect selected days
      var dowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn.active");
      var days = [];
      for (var i = 0; i < dowBtns.length; i++) {
        days.push(dowBtns[i].dataset.dow);
      }
      if (days.length === 0) days.push(String(new Date().getDay()));
      return minute + " " + hour + " * * " + days.join(",");
    }
    return null;
  }

  function cronToHumanText(cron) {
    if (!cron) return "";
    var parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    var m = parts[0], h = parts[1], dom = parts[2], dow = parts[4];
    var pad = function(n) { return (parseInt(n,10) < 10 ? "0" : "") + parseInt(n,10); };
    var t = pad(h) + ":" + pad(m);
    var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    if (dow === "*" && dom === "*") return "Every day at " + t;
    if (dow === "1-5" && dom === "*") return "Weekdays at " + t;
    if (dom !== "*" && dow === "*") return "Monthly on day " + dom + " at " + t;
    if (dow !== "*" && dom === "*") {
      var ds = dow.split(",").map(function(d) { return dayNames[parseInt(d,10)] || d; });
      return "Every " + ds.join(", ") + " at " + t;
    }
    return cron;
  }

  function wizardNext() {
    collectWizardData();

    if (wizardStep === 1) {
      wizardStep++;
      updateWizardStep();
      return;
    }

    if (wizardStep === 2) {
      var taskEl = document.getElementById("ralph-task");
      if (!wizardData.task) {
        if (taskEl) { taskEl.focus(); taskEl.style.borderColor = "#e74c3c"; setTimeout(function() { taskEl.style.borderColor = ""; }, 2000); }
        return;
      }
      wizardSubmit();
      return;
    }
    wizardStep++;
    updateWizardStep();
  }

  function wizardBack() {
    if (wizardStep > 1) {
      collectWizardData();
      wizardStep--;
      updateWizardStep();
    }
  }

  function wizardSkip() {
    if (wizardStep < 2) {
      wizardStep++;
      updateWizardStep();
    }
  }

  function wizardSubmit() {
    collectWizardData();
    closeRalphWizard();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ralph_wizard_complete", data: wizardData }));
    }
  }

  // Wizard button listeners
  var wizardCloseBtn = document.getElementById("ralph-wizard-close");
  var wizardBackdrop = document.querySelector(".ralph-wizard-backdrop");
  var wizardBackBtn = document.getElementById("ralph-wizard-back");
  var wizardSkipBtn = document.getElementById("ralph-wizard-skip");
  var wizardNextBtn = document.getElementById("ralph-wizard-next");

  if (wizardCloseBtn) wizardCloseBtn.addEventListener("click", closeRalphWizard);
  if (wizardBackdrop) wizardBackdrop.addEventListener("click", closeRalphWizard);
  if (wizardBackBtn) wizardBackBtn.addEventListener("click", wizardBack);
  if (wizardSkipBtn) wizardSkipBtn.addEventListener("click", wizardSkip);
  if (wizardNextBtn) wizardNextBtn.addEventListener("click", wizardNext);

  // --- Repeat picker handlers ---
  var repeatSelect = document.getElementById("ralph-repeat");
  var repeatTimeRow = document.getElementById("ralph-time-row");
  var repeatCustom = document.getElementById("ralph-custom-repeat");
  var repeatUnitSelect = document.getElementById("ralph-repeat-unit");
  var repeatDowRow = document.getElementById("ralph-custom-dow-row");
  var cronPreview = document.getElementById("ralph-cron-preview");

  function updateRepeatUI() {
    if (!repeatSelect) return;
    var val = repeatSelect.value;
    var isScheduled = val !== "none";
    if (repeatTimeRow) repeatTimeRow.style.display = isScheduled ? "" : "none";
    if (repeatCustom) repeatCustom.style.display = val === "custom" ? "" : "none";
    if (cronPreview) cronPreview.style.display = isScheduled ? "" : "none";
    if (isScheduled) {
      var cron = buildWizardCron();
      var humanEl = document.getElementById("ralph-cron-human");
      var cronEl = document.getElementById("ralph-cron-expr");
      if (humanEl) humanEl.textContent = cronToHumanText(cron);
      if (cronEl) cronEl.textContent = cron || "";
    }
  }

  if (repeatSelect) {
    repeatSelect.addEventListener("change", updateRepeatUI);
  }
  if (repeatUnitSelect) {
    repeatUnitSelect.addEventListener("change", function () {
      if (repeatDowRow) repeatDowRow.style.display = this.value === "week" ? "" : "none";
      updateRepeatUI();
    });
  }

  var timeInput = document.getElementById("ralph-time");
  if (timeInput) timeInput.addEventListener("change", updateRepeatUI);

  // DOW buttons in custom repeat
  var customDowBtns = document.querySelectorAll("#ralph-custom-repeat .sched-dow-btn");
  for (var di = 0; di < customDowBtns.length; di++) {
    customDowBtns[di].addEventListener("click", function () {
      this.classList.toggle("active");
      updateRepeatUI();
    });
  }

  // --- Ralph Sticky (title-bar island) ---
  function showRalphCraftingBar(show) {
    var stickyEl = $("ralph-sticky");
    if (!stickyEl) return;
    if (!show) {
      stickyEl.classList.add("hidden");
      stickyEl.innerHTML = "";
      return;
    }
    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">Ralph</span>' +
          '<span class="ralph-sticky-status">' + iconHtml("loader", "icon-spin") + ' Preparing\u2026</span>' +
          '<button class="ralph-sticky-cancel" title="Cancel">' + iconHtml("x") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden");
    refreshIcons();

    var cancelBtn = stickyEl.querySelector(".ralph-sticky-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ralph_cancel_crafting" }));
        }
        showRalphCraftingBar(false);
        showRalphApprovalBar(false);
      });
    }
  }

  // --- Ralph Approval Bar (also uses sticky island) ---
  function showRalphApprovalBar(show) {
    var stickyEl = $("ralph-sticky");
    if (!stickyEl) return;
    if (!show) {
      // Only clear if we're in approval mode (don't clobber crafting)
      if (ralphPhase !== "crafting") {
        stickyEl.classList.add("hidden");
        stickyEl.innerHTML = "";
      }
      return;
    }

    stickyEl.innerHTML =
      '<div class="ralph-sticky-inner">' +
        '<div class="ralph-sticky-header" id="ralph-sticky-header">' +
          '<span class="ralph-sticky-icon">' + iconHtml("repeat") + '</span>' +
          '<span class="ralph-sticky-label">Ralph</span>' +
          '<span class="ralph-sticky-status" id="ralph-sticky-status">Ready</span>' +
          '<button class="ralph-sticky-action ralph-sticky-preview" title="Preview files">' + iconHtml("eye") + '</button>' +
          '<button class="ralph-sticky-action ralph-sticky-start" title="' + (wizardData.cron ? 'Schedule' : 'Start loop') + '">' + iconHtml(wizardData.cron ? "calendar-clock" : "play") + '</button>' +
          '<button class="ralph-sticky-action ralph-sticky-dismiss" title="Cancel and discard">' + iconHtml("x") + '</button>' +
        '</div>' +
      '</div>';
    stickyEl.classList.remove("hidden");
    refreshIcons();

    stickyEl.querySelector(".ralph-sticky-preview").addEventListener("click", function(e) {
      e.stopPropagation();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ralph_preview_files" }));
      }
    });

    stickyEl.querySelector(".ralph-sticky-start").addEventListener("click", function(e) {
      e.stopPropagation();
      // Check for uncommitted changes before starting
      fetch(basePath + "api/git-dirty")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.dirty) {
            showConfirm("You have uncommitted changes. Ralph Loop uses git diff to track progress \u2014 uncommitted files may cause unexpected results.\n\nStart anyway?", function () {
              if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "loop_start" }));
              }
              stickyEl.classList.add("hidden");
              stickyEl.innerHTML = "";
            });
          } else {
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "loop_start" }));
            }
            stickyEl.classList.add("hidden");
            stickyEl.innerHTML = "";
          }
        })
        .catch(function () {
          // If check fails, just start
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "loop_start" }));
          }
          stickyEl.classList.add("hidden");
          stickyEl.innerHTML = "";
        });
    });

    stickyEl.querySelector(".ralph-sticky-dismiss").addEventListener("click", function(e) {
      e.stopPropagation();
      showConfirm("Discard this Ralph Loop setup?", function() {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ralph_wizard_cancel" }));
        }
        stickyEl.classList.add("hidden");
        stickyEl.classList.remove("ralph-ready");
        stickyEl.innerHTML = "";
      });
    });

    updateRalphApprovalStatus();
  }

  function updateRalphApprovalStatus() {
    var stickyEl = $("ralph-sticky");
    var statusEl = document.getElementById("ralph-sticky-status");
    var startBtn = document.querySelector(".ralph-sticky-start");
    if (!statusEl) return;

    if (ralphFilesReady.bothReady) {
      statusEl.textContent = "Ready";
      if (startBtn) startBtn.disabled = false;
      if (stickyEl) stickyEl.classList.add("ralph-ready");
    } else if (ralphFilesReady.promptReady || ralphFilesReady.judgeReady) {
      statusEl.textContent = "Partial\u2026";
      if (startBtn) startBtn.disabled = true;
      if (stickyEl) stickyEl.classList.remove("ralph-ready");
    } else {
      statusEl.textContent = "Waiting\u2026";
      if (startBtn) startBtn.disabled = true;
      if (stickyEl) stickyEl.classList.remove("ralph-ready");
    }
  }

  // --- Ralph Preview Modal ---
  function openRalphPreviewModal() {
    var modal = document.getElementById("ralph-preview-modal");
    if (!modal) return;
    modal.classList.remove("hidden");

    // Set name from wizard data
    var nameEl = document.getElementById("ralph-preview-name");
    if (nameEl) {
      var name = (wizardData && wizardData.name) || "Ralph Loop";
      nameEl.textContent = name;
    }

    // Update run button label based on cron
    var runBtn = document.getElementById("ralph-preview-run");
    if (runBtn) {
      var hasCron = wizardData && wizardData.cron;
      runBtn.innerHTML = iconHtml(hasCron ? "calendar-clock" : "play") + " " + (hasCron ? "Schedule" : "Run now");
      runBtn.disabled = !(ralphFilesReady && ralphFilesReady.bothReady);
    }

    showRalphPreviewTab("prompt");
    refreshIcons();
  }

  function closeRalphPreviewModal() {
    var modal = document.getElementById("ralph-preview-modal");
    if (modal) modal.classList.add("hidden");
  }

  function showRalphPreviewTab(tab) {
    var tabs = document.querySelectorAll("#ralph-preview-modal .ralph-tab");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-tab") === tab) {
        tabs[i].classList.add("active");
      } else {
        tabs[i].classList.remove("active");
      }
    }
    var body = document.getElementById("ralph-preview-body");
    if (!body) return;
    var content = tab === "prompt" ? ralphPreviewContent.prompt : ralphPreviewContent.judge;
    if (typeof marked !== "undefined" && marked.parse) {
      body.innerHTML = '<div class="md-content">' + DOMPurify.sanitize(marked.parse(content)) + '</div>';
    } else {
      body.textContent = content;
    }
  }

  // Preview modal listeners
  var previewBackdrop = document.querySelector("#ralph-preview-modal .confirm-backdrop");
  if (previewBackdrop) previewBackdrop.addEventListener("click", closeRalphPreviewModal);

  // Run now button in preview modal
  var previewRunBtn = document.getElementById("ralph-preview-run");
  if (previewRunBtn) {
    previewRunBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky start button
      var stickyStart = document.querySelector(".ralph-sticky-start");
      if (stickyStart) {
        stickyStart.click();
      }
    });
  }

  // Delete/cancel button in preview modal
  var previewDeleteBtn = document.getElementById("ralph-preview-delete");
  if (previewDeleteBtn) {
    previewDeleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeRalphPreviewModal();
      // Trigger the same flow as the sticky dismiss button
      var stickyDismiss = document.querySelector(".ralph-sticky-dismiss");
      if (stickyDismiss) {
        stickyDismiss.click();
      }
    });
  }

  var previewTabs = document.querySelectorAll(".ralph-tab");
  for (var ti = 0; ti < previewTabs.length; ti++) {
    previewTabs[ti].addEventListener("click", function() {
      showRalphPreviewTab(this.getAttribute("data-tab"));
    });
  }

  // --- Skills ---
  initSkills({
    get ws() { return ws; },
    get connected() { return connected; },
    basePath: basePath,
    openTerminal: function () { openTerminal(); },
    sendTerminalCommand: function (cmd) { sendTerminalCommand(cmd); },
  });

  // --- Scheduler ---
  initScheduler({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return getActiveSessionId(); },
    basePath: basePath,
    currentSlug: currentSlug,
    openRalphWizard: function () { openRalphWizard(); },
    requireClayRalph: function (cb) { requireClayRalph(cb); },
    getProjects: function () { return cachedProjects; },
  });

  // --- Remove project ---
  var pendingRemoveSlug = null;
  var pendingRemoveName = null;

  function confirmRemoveProject(slug, name) {
    // First check if the project has tasks/schedules
    pendingRemoveSlug = slug;
    pendingRemoveName = name;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "remove_project_check", slug: slug }));
    }
  }

  function handleRemoveProjectCheckResult(msg) {
    var slug = msg.slug || pendingRemoveSlug;
    var name = msg.name || pendingRemoveName || slug;
    if (!slug) return;

    if (msg.count > 0) {
      // Project has tasks — show dialog with options
      showRemoveProjectTaskDialog(slug, name, msg.count);
    } else {
      // No tasks — simple confirm
      showConfirm('Remove project "' + name + '"?', function () {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
        }
      });
    }
    pendingRemoveSlug = null;
    pendingRemoveName = null;
  }

  function showRemoveProjectTaskDialog(slug, name, taskCount) {
    // Build list of other projects to move tasks to
    var otherProjects = cachedProjects.filter(function (p) { return p.slug !== slug; });

    var modal = document.createElement("div");
    modal.className = "remove-project-task-modal";
    modal.innerHTML =
      '<div class="remove-project-task-backdrop"></div>' +
      '<div class="remove-project-task-dialog">' +
        '<div class="remove-project-task-title">Remove project "' + (name || slug) + '"</div>' +
        '<div class="remove-project-task-text">This project has <strong>' + taskCount + '</strong> task' + (taskCount > 1 ? 's' : '') + '/schedule' + (taskCount > 1 ? 's' : '') + '.</div>' +
        '<div class="remove-project-task-options">' +
          (otherProjects.length > 0
            ? '<div class="remove-project-task-label">Move tasks to:</div>' +
              '<select class="remove-project-task-select" id="rpt-move-target">' +
                otherProjects.map(function (p) {
                  return '<option value="' + p.slug + '">' + (p.title || p.project || p.slug) + '</option>';
                }).join("") +
              '</select>' +
              '<button class="remove-project-task-btn move" id="rpt-move-btn">Move &amp; Remove</button>'
            : '') +
          '<button class="remove-project-task-btn delete" id="rpt-delete-btn">Delete all &amp; Remove</button>' +
          '<button class="remove-project-task-btn cancel" id="rpt-cancel-btn">Cancel</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var backdrop = modal.querySelector(".remove-project-task-backdrop");
    var moveBtn = modal.querySelector("#rpt-move-btn");
    var deleteBtn = modal.querySelector("#rpt-delete-btn");
    var cancelBtn = modal.querySelector("#rpt-cancel-btn");
    var selectEl = modal.querySelector("#rpt-move-target");

    function close() { modal.remove(); }
    backdrop.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);

    if (moveBtn) {
      moveBtn.addEventListener("click", function () {
        var targetSlug = selectEl ? selectEl.value : null;
        if (ws && ws.readyState === 1 && targetSlug) {
          ws.send(JSON.stringify({ type: "remove_project", slug: slug, moveTasksTo: targetSlug }));
        }
        close();
      });
    }

    deleteBtn.addEventListener("click", function () {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
      }
      close();
    });
  }

  function handleRemoveProjectResult(msg) {
    if (msg.ok) {
      showToast("Project removed", "success");
      // If we removed the current project, navigate to first available
      if (msg.slug === currentSlug) {
        window.location.href = "/";
      }
    } else {
      showToast(msg.error || "Failed to remove project", "error");
    }
  }

  // --- Add project modal ---
  var addProjectModal = document.getElementById("add-project-modal");
  var addProjectInput = document.getElementById("add-project-input");
  var addProjectSuggestions = document.getElementById("add-project-suggestions");
  var addProjectError = document.getElementById("add-project-error");
  var addProjectOk = document.getElementById("add-project-ok");
  var addProjectCancel = document.getElementById("add-project-cancel");
  var addProjectDebounce = null;
  var addProjectActiveIdx = -1;

  function openAddProjectModal() {
    addProjectModal.classList.remove("hidden");
    addProjectInput.value = "/";
    addProjectError.classList.add("hidden");
    addProjectError.textContent = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    addProjectOk.disabled = false;
    setTimeout(function () {
      addProjectInput.focus();
      addProjectInput.setSelectionRange(1, 1);
    }, 50);
  }

  function closeAddProjectModal() {
    addProjectModal.classList.add("hidden");
    addProjectInput.value = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectError.classList.add("hidden");
    addProjectActiveIdx = -1;
    if (addProjectDebounce) { clearTimeout(addProjectDebounce); addProjectDebounce = null; }
  }

  function requestBrowseDir(val) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "browse_dir", path: val }));
  }

  function handleBrowseDirResult(msg) {
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    if (msg.error) {
      addProjectSuggestions.classList.add("hidden");
      return;
    }
    var entries = msg.entries || [];
    if (entries.length === 0) {
      addProjectSuggestions.classList.add("hidden");
      return;
    }
    for (var si = 0; si < entries.length; si++) {
      var entry = entries[si];
      var item = document.createElement("div");
      item.className = "add-project-suggestion-item";
      item.dataset.path = entry.path;
      item.innerHTML = '<i data-lucide="folder"></i><span class="add-project-suggestion-name">' +
        escapeHtml(entry.name) + '</span>';
      item.addEventListener("click", function (e) {
        var p = this.dataset.path + "/";
        addProjectInput.value = p;
        addProjectInput.focus();
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      });
      addProjectSuggestions.appendChild(item);
    }
    addProjectSuggestions.classList.remove("hidden");
    refreshIcons();
  }

  function handleAddProjectResult(msg) {
    if (msg.ok) {
      closeAddProjectModal();
      if (msg.existing) {
        showToast("Project already registered", "info");
      } else {
        showToast("Project added", "success");
        // Navigate to the new project
        if (msg.slug) {
          switchProject(msg.slug);
        }
      }
    } else {
      addProjectError.textContent = msg.error || "Failed to add project";
      addProjectError.classList.remove("hidden");
      addProjectOk.disabled = false;
    }
  }

  function setActiveIdx(idx) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");
    addProjectActiveIdx = idx;
    for (var ai = 0; ai < items.length; ai++) {
      if (ai === idx) {
        items[ai].classList.add("active");
        items[ai].scrollIntoView({ block: "nearest" });
      } else {
        items[ai].classList.remove("active");
      }
    }
  }

  addProjectInput.addEventListener("focus", function () {
    var val = addProjectInput.value;
    if (val && addProjectSuggestions.children.length === 0) {
      requestBrowseDir(val);
    } else if (addProjectSuggestions.children.length > 0) {
      addProjectSuggestions.classList.remove("hidden");
    }
  });

  addProjectModal.querySelector(".confirm-dialog").addEventListener("click", function (e) {
    if (e.target === addProjectInput || addProjectInput.contains(e.target)) return;
    if (e.target === addProjectSuggestions || addProjectSuggestions.contains(e.target)) return;
    addProjectSuggestions.classList.add("hidden");
    addProjectActiveIdx = -1;
  });

  addProjectInput.addEventListener("input", function () {
    var val = addProjectInput.value;
    addProjectError.classList.add("hidden");
    if (addProjectDebounce) clearTimeout(addProjectDebounce);
    addProjectDebounce = setTimeout(function () {
      requestBrowseDir(val);
    }, 200);
  });

  addProjectInput.addEventListener("keydown", function (e) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        var next = addProjectActiveIdx < items.length - 1 ? addProjectActiveIdx + 1 : 0;
        setActiveIdx(next);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        var prev = addProjectActiveIdx > 0 ? addProjectActiveIdx - 1 : items.length - 1;
        setActiveIdx(prev);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      var target = addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length
        ? items[addProjectActiveIdx]
        : items.length > 0 ? items[0] : null;
      if (target) {
        var p = target.dataset.path + "/";
        addProjectInput.value = p;
        addProjectError.classList.add("hidden");
        requestBrowseDir(p);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      // If a suggestion is highlighted, pick it first
      if (addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length) {
        var picked = items[addProjectActiveIdx].dataset.path + "/";
        addProjectInput.value = picked;
        addProjectError.classList.add("hidden");
        requestBrowseDir(picked);
        return;
      }
      // Otherwise submit
      submitAddProject();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeAddProjectModal();
      return;
    }
  });

  function submitAddProject() {
    var val = addProjectInput.value.replace(/\/+$/, "");
    if (!val) return;
    addProjectOk.disabled = true;
    addProjectError.classList.add("hidden");
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "add_project", path: val }));
    }
  }

  addProjectOk.addEventListener("click", function () { submitAddProject(); });
  addProjectCancel.addEventListener("click", function () { closeAddProjectModal(); });

  // Close on backdrop click
  addProjectModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    closeAddProjectModal();
  });

  // --- PWA install prompt ---
  (function () {
    var installPill = document.getElementById("pwa-install-pill");
    var modal = document.getElementById("pwa-install-modal");
    var confirmBtn = document.getElementById("pwa-modal-confirm");
    var cancelBtn = document.getElementById("pwa-modal-cancel");
    if (!installPill || !modal) return;

    // Already standalone — never show
    if (document.documentElement.classList.contains("pwa-standalone")) return;

    // Show pill on mobile browsers (the primary target for PWA install)
    var isMobile = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isMobile) {
      installPill.classList.remove("hidden");
    }

    // Also show on desktop if beforeinstallprompt fires
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPill.classList.remove("hidden");
    });

    function openModal() {
      modal.classList.remove("hidden");
      lucide.createIcons({ nodes: [modal] });
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    installPill.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.querySelector(".pwa-modal-backdrop").addEventListener("click", closeModal);

    confirmBtn.addEventListener("click", function () {
      // Redirect to HTTP setup page (port + 1)
      var port = parseInt(location.port, 10) || (location.protocol === "https:" ? 443 : 80);
      var setupUrl = "http://" + location.hostname + ":" + (port + 1) + "/setup";
      location.href = setupUrl;
    });

    // Hide after install
    window.addEventListener("appinstalled", function () {
      installPill.classList.add("hidden");
      closeModal();
    });
  })();

  // --- Init ---
  lucide.createIcons();
  connect();
  if (!currentSlug) {
    showHomeHub();
  } else {
    inputEl.focus();
  }
