import { showToast, copyToClipboard, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml, randomThinkingVerb } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal, parseEmojis } from './modules/markdown.js';
import { initSidebar, renderSessionList, handleSearchResults, handleSearchContentResults, updateSessionPresence, updatePageTitle, getActiveSearchQuery, buildSearchTimeline, removeSearchTimeline, onHistoryPrepended, populateCliSessionList, renderIconStrip, renderSidebarPresence, initIconStrip, getEmojiCategories, renderUserStrip, setCurrentDmUser, updateDmBadge, updateSessionBadge, updateProjectBadge, closeDmUserPicker, spawnDustParticles } from './modules/sidebar.js';
import { initRewind, setRewindMode, showRewindModal, clearPendingRewindUuid, addRewindButton } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync, autoResize, builtinCommands, sendMessage } from './modules/input.js';
import { initQrCode } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, refreshTree, handleFsList, handleFsRead, handleDirChanged, refreshIfOpen, handleFileChanged, handleFileHistory, handleGitDiff, handleFileAt, getPendingNavigate, closeFileViewer, resetFileBrowser } from './modules/filebrowser.js';
import { initTerminal, openTerminal, closeTerminal, resetTerminals, handleTermList, handleTermCreated, handleTermOutput, handleTermExited, handleTermClosed, sendTerminalCommand } from './modules/terminal.js';
import { initStickyNotes, handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted, openArchive, closeArchive, isArchiveOpen, hideNotes, showNotes, isNotesVisible } from './modules/sticky-notes.js';
import { initTheme, getThemeColor, getComputedVar, onThemeChange, getCurrentTheme } from './modules/theme.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderElicitationRequest, markElicitationResolved, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, updateSubagentProgress, initSubagentStop, closeToolGroup, removeToolFromGroup } from './modules/tools.js';
import { initServerSettings, updateSettingsStats, updateSettingsModels, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './modules/server-settings.js';
import { initProjectSettings, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, isProjectSettingsOpen, handleProjectSharedEnv, handleProjectSharedEnvSaved, handleProjectOwnerChanged } from './modules/project-settings.js';
import { initSkills, handleSkillInstalled, handleSkillUninstalled } from './modules/skills.js';
import { initScheduler, resetScheduler, handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, openSchedulerToTab, isSchedulerOpen, closeScheduler, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles, getUpcomingSchedules } from './modules/scheduler.js';
import { initAsciiLogo, startLogoAnimation, stopLogoAnimation } from './modules/ascii-logo.js';
import { initPlaybook, openPlaybook, getPlaybooks, getPlaybookForTip, isCompleted as isPlaybookCompleted } from './modules/playbook.js';
import { initSTT } from './modules/stt.js';
import { initProfile } from './modules/profile.js';
import { initAdmin, checkAdminAccess } from './modules/admin.js';

// --- Base path for multi-project routing ---
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var basePath = slugMatch ? "/p/" + slugMatch[1] + "/" : "/";
  var wsPath = slugMatch ? "/p/" + slugMatch[1] + "/ws" : "/ws";

// --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
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
  var sidebar = $("sidebar");
  var sidebarOverlay = $("sidebar-overlay");
  var sessionListEl = $("session-list");
  var newSessionBtn = $("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var sidebarToggleBtn = $("sidebar-toggle-btn");
  var sidebarExpandBtn = $("sidebar-expand-btn");
  var resumeSessionBtn = $("resume-session-btn");
  var imagePreviewBar = $("image-preview-bar");
  var connectOverlay = $("connect-overlay");

  // --- DM Mode ---
  var dmMode = false;
  var dmKey = null;
  var dmTargetUser = null;
  var dmUnread = {}; // { otherUserId: count }
  var cachedAllUsers = [];
  var cachedOnlineIds = [];
  var cachedDmFavorites = [];
  var cachedDmConversations = [];
  var dmRemovedUsers = {};       // { userId: true } - users explicitly removed from favorites

  // --- Home Hub ---
  var homeHub = $("home-hub");
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
    var greetEl = $("hub-greeting-text");
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
    var dateEl = $("hub-greeting-date");
    if (dateEl) dateEl.textContent = getFormattedDate();

    // --- Upcoming tasks ---
    var upcomingList = $("hub-upcoming-list");
    var upcomingCount = $("hub-upcoming-count");
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
    var projectsList = $("hub-projects-list");
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
    var weekStrip = $("hub-week-strip");
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
    var pbGrid = $("hub-playbooks-grid");
    var pbSection = $("hub-playbooks");
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
    var tipEl = $("hub-tip-text");
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
    var prevBtn = $("hub-tip-prev");
    if (prevBtn && !prevBtn._hubWired) {
      prevBtn._hubWired = true;
      prevBtn.addEventListener("click", function () {
        hubTipIndex = (hubTipIndex - 1 + hubTips.length) % hubTips.length;
        renderHomeHub(cachedProjects);
        startTipRotation();
      });
    }
    var nextBtn = $("hub-tip-next");
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

    // Hide sticky notes if visible
    hideNotes();

    // Hide project UI + sidebar, show DM UI
    var mainCol = document.getElementById("main-column");
    if (mainCol) mainCol.classList.add("dm-mode");
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
      var dmHeaderBar = document.getElementById("dm-header-bar");
      var dmAvatar = document.getElementById("dm-header-avatar");
      var dmName = document.getElementById("dm-header-name");
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

    var mainCol = document.getElementById("main-column");
    if (mainCol) mainCol.classList.remove("dm-mode");
    var sidebarCol = document.getElementById("sidebar-column");
    if (sidebarCol) sidebarCol.classList.remove("dm-mode");
    var resizeHandle = document.getElementById("sidebar-resize-handle");
    if (resizeHandle) resizeHandle.classList.remove("dm-mode");

    // Reset DM header
    var dmHeaderBar = document.getElementById("dm-header-bar");
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
  var projectListSection = $("project-list-section");
  var projectListEl = $("project-list");
  var projectListAddBtn = $("project-list-add");
  var projectHint = $("project-hint");
  var projectHintDismiss = $("project-hint-dismiss");
  var cachedProjects = [];
  var cachedProjectCount = 0;
  var cachedRemovedProjects = [];
  var currentProjectOwnerId = null;
  var currentSlug = slugMatch ? slugMatch[1] : null;

  function updateProjectList(msg) {
    if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;
    if (msg.projects) cachedProjects = msg.projects;
    if (msg.removedProjects) cachedRemovedProjects = msg.removedProjects;
    else if (msg.removedProjects === undefined) { /* keep cached */ }
    else cachedRemovedProjects = [];
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
      cachedOnlineIds = msg.serverUsers.map(function (u) { return u.id; });
      renderTopbarPresence(msg.serverUsers);
      // Re-render user strip online dots even without allUsers update
      if (!msg.allUsers && cachedAllUsers.length > 0) {
        renderUserStrip(cachedAllUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers);
      }
    }
    // Update user strip (DM targets) in icon strip
    if (msg.allUsers) {
      cachedAllUsers = msg.allUsers;
      if (msg.dmFavorites) cachedDmFavorites = msg.dmFavorites;
      if (msg.dmConversations) cachedDmConversations = msg.dmConversations;
      renderUserStrip(msg.allUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers);
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
      return { slug: p.slug, name: p.title || p.project, icon: p.icon || null, isProcessing: p.isProcessing, onlineUsers: p.onlineUsers || [], unread: p.unread || 0 };
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
      if (connected && processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
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
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("clay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $("paste-modal").querySelector(".confirm-backdrop").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("paste-modal").querySelector(".paste-modal-close").addEventListener("click", function() {
    $("paste-modal").classList.add("hidden");
  });
  $("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);
  $("image-modal").querySelector(".confirm-backdrop").addEventListener("click", closeImageModal);
  $("image-modal").querySelector(".image-modal-close").addEventListener("click", closeImageModal);

  function showImageModal(src) {
    var modal = $("image-modal");
    var img = $("image-modal-img");
    if (!modal || !img) return;
    img.src = src;
    modal.classList.remove("hidden");
    refreshIcons(modal);
  }

  function closeImageModal() {
    var modal = $("image-modal");
    if (modal) modal.classList.add("hidden");
  }

  // --- State ---
  var ws = null;
  var connected = false;
  var wasConnected = false;
  var processing = false;
  // isComposing -> modules/input.js
  var reconnectTimer = null;
  var reconnectDelay = 1000;
  var disconnectNotifTimer = null;
  var disconnectNotifShown = false;
  var activityEl = null;
  var currentMsgEl = null;
  var currentFullText = "";
  // tools, currentThinking -> modules/tools.js
  var highlightTimer = null;
  var activeSessionId = null;
  var sessionDrafts = {};
  var loopActive = false;
  var loopAvailable = false;
  var loopIteration = 0;
  var loopMaxIterations = 0;
  var ralphPhase = "idle"; // idle | wizard | crafting | approval | executing | done
  var ralphCraftingSessionId = null;
  var wizardStep = 1;
  var wizardData = { name: "", task: "", maxIterations: 3, cron: null };
  var ralphFilesReady = { promptReady: false, judgeReady: false, bothReady: false };
  var ralphPreviewContent = { prompt: "", judge: "" };
  var slashCommands = [];
  // slashActiveIdx, slashFiltered, pendingImages, pendingPastes -> modules/input.js
  // pendingPermissions -> modules/tools.js
  var cliSessionId = null;
  var projectName = "";
  var turnCounter = 0;

  // Restore cached project name and icon for instant display (before WS connects)
  try {
    var _cachedProjectName = localStorage.getItem("clay-project-name-" + (currentSlug || "default"));
    if (_cachedProjectName) {
      projectName = _cachedProjectName;
      if (headerTitleEl) headerTitleEl.textContent = _cachedProjectName;
      var _tbp = $("title-bar-project-name");
      if (_tbp) _tbp.textContent = _cachedProjectName;
    }
    var _cachedProjectIcon = localStorage.getItem("clay-project-icon-" + (currentSlug || "default"));
    if (_cachedProjectIcon) {
      var _tbi = $("title-bar-project-icon");
      if (_tbi) {
        _tbi.textContent = _cachedProjectIcon;
        parseEmojis(_tbi);
        _tbi.classList.add("has-icon");
      }
    }
  } catch (e) {}
  var messageUuidMap = [];
  // pendingRewindUuid is now in modules/rewind.js
  // rewindMode is now in modules/rewind.js

  // --- Progressive history loading ---
  var historyFrom = 0;
  var historyTotal = 0;
  var prependAnchor = null;
  var loadingMore = false;
  var historySentinelObserver = null;
  var replayingHistory = false;

  // --- Scroll lock ---
  var isUserScrolledUp = false;
  var scrollThreshold = 150;

  // builtinCommands -> modules/input.js

  // --- Header session rename ---
  if (headerRenameBtn) {
    headerRenameBtn.addEventListener("click", function () {
      if (!activeSessionId) return;
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
          ws.send(JSON.stringify({ type: "rename_session", id: activeSessionId, title: newTitle }));
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

      if (cliSessionId) addRow("Session ID", cliSessionId);
      if (activeSessionId) addRow("Local ID", activeSessionId);
      if (cliSessionId) addRow("Resume", "claude --resume " + cliSessionId);

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
  var confirmModal = $("confirm-modal");
  var confirmText = $("confirm-text");
  var confirmOk = $("confirm-ok");
  var confirmCancel = $("confirm-cancel");
  // --- Paste content viewer modal ---
  function showPasteModal(text) {
    var modal = $("paste-modal");
    var body = $("paste-modal-body");
    if (!modal || !body) return;
    body.textContent = text;
    modal.classList.remove("hidden");
  }

  function closePasteModal() {
    var modal = $("paste-modal");
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
    get processing() { return processing; },
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
    get projectOwnerId() { return currentProjectOwnerId; },
    openDm: function (userId) { openDm(userId); },
    openAddProjectModal: function () { openAddProjectModal(); },
    sendWs: function (msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    onDmRemoveUser: function (userId) { dmRemovedUsers[userId] = true; },
    getHistoryFrom: function () { return historyFrom; },
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

  function setStatus(status) {
    var dot = getStatusDot();
    if (dot) dot.className = "icon-strip-status";
    if (status === "connected") {
      if (dot) dot.classList.add("connected");
      connected = true;
      processing = false;
      sendBtn.disabled = false;
      setSendBtnMode("send");
      connectOverlay.classList.add("hidden");
      stopVerbCycle();
    } else if (status === "processing") {
      if (dot) { dot.classList.add("connected"); dot.classList.add("processing"); }
      processing = true;
      setSendBtnMode(inputEl.value.trim() ? "send" : "stop");
    } else {
      connected = false;
      sendBtn.disabled = true;
      connectOverlay.classList.remove("hidden");
      startVerbCycle();
    }
  }

  function setActivity(text) {
    if (text) {
      if (!activityEl) {
        activityEl = document.createElement("div");
        activityEl.className = "activity-inline";
        activityEl.innerHTML =
          '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
          '<span class="activity-text"></span>';
        addToMessages(activityEl);
        refreshIcons();
      }
      activityEl.querySelector(".activity-text").textContent = text;
      scrollToBottom();
    } else {
      if (activityEl) {
        activityEl.remove();
        activityEl = null;
      }
    }
  }

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
  var isOsUsers = false;

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

  // --- Usage panel ---
  var usagePanel = $("usage-panel");
  var usagePanelClose = $("usage-panel-close");
  var usageCostEl = $("usage-cost");
  var usageInputEl = $("usage-input");
  var usageOutputEl = $("usage-output");
  var usageCacheReadEl = $("usage-cache-read");
  var usageCacheWriteEl = $("usage-cache-write");
  var usageTurnsEl = $("usage-turns");
  var sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };

  function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function updateUsagePanel() {
    if (!usageCostEl) return;
    usageCostEl.textContent = "$" + sessionUsage.cost.toFixed(4);
    usageInputEl.textContent = formatTokens(sessionUsage.input);
    usageOutputEl.textContent = formatTokens(sessionUsage.output);
    usageCacheReadEl.textContent = formatTokens(sessionUsage.cacheRead);
    usageCacheWriteEl.textContent = formatTokens(sessionUsage.cacheWrite);
    usageTurnsEl.textContent = String(sessionUsage.turns);
  }

  function accumulateUsage(cost, usage) {
    if (cost != null) sessionUsage.cost += cost;
    if (usage) {
      sessionUsage.input += usage.input_tokens || usage.inputTokens || 0;
      sessionUsage.output += usage.output_tokens || usage.outputTokens || 0;
      sessionUsage.cacheRead += usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      sessionUsage.cacheWrite += usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    sessionUsage.turns++;
    if (!replayingHistory) updateUsagePanel();
  }

  function resetUsage() {
    sessionUsage = { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    updateUsagePanel();
    if (usagePanel) usagePanel.classList.add("hidden");
  }

  function toggleUsagePanel() {
    if (!usagePanel) return;
    usagePanel.classList.toggle("hidden");
    refreshIcons();
  }

  if (usagePanelClose) {
    usagePanelClose.addEventListener("click", function () {
      usagePanel.classList.add("hidden");
    });
  }

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

  // --- Context panel ---
  var contextPanel = $("context-panel");
  var contextPanelClose = $("context-panel-close");
  var contextPanelMinimize = $("context-panel-minimize");
  var contextBarFill = $("context-bar-fill");
  var contextBarPct = $("context-bar-pct");
  var contextUsedEl = $("context-used");
  var contextWindowEl = $("context-window");
  var contextMaxOutputEl = $("context-max-output");
  var contextInputEl = $("context-input");
  var contextOutputEl = $("context-output");
  var contextCacheReadEl = $("context-cache-read");
  var contextCacheWriteEl = $("context-cache-write");
  var contextModelEl = $("context-model");
  var contextCostEl = $("context-cost");
  var contextTurnsEl = $("context-turns");
  var contextMini = $("context-mini");
  var contextMiniFill = $("context-mini-fill");
  var contextMiniLabel = $("context-mini-label");
  var contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  var headerContextEl = null;

  // Known context window sizes per model (fallback when SDK omits feature flag)
  var KNOWN_CONTEXT_WINDOWS = {
    "opus-4-6": 1000000,
    "claude-sonnet-4": 1000000
  };

  function resolveContextWindow(model, sdkValue) {
    if (sdkValue) return sdkValue;
    var lc = (model || "").toLowerCase();
    for (var key in KNOWN_CONTEXT_WINDOWS) {
      if (lc.includes(key)) return KNOWN_CONTEXT_WINDOWS[key];
    }
    return 200000;
  }

  function contextPctClass(pct) {
    return pct >= 85 ? " danger" : pct >= 60 ? " warn" : "";
  }

  function updateContextPanel() {
    if (!contextUsedEl) return;
    // Context window usage = input tokens only (includes cache read/write)
    var used = contextData.input;
    var win = contextData.contextWindow;
    var pct = win > 0 ? Math.min(100, (used / win) * 100) : 0;
    var cls = contextPctClass(pct);
    // Panel bar
    contextBarFill.style.width = pct.toFixed(1) + "%";
    contextBarFill.className = "context-bar-fill" + cls;
    contextBarPct.textContent = pct.toFixed(0) + "%";
    // Mini bar
    if (contextMiniFill) {
      contextMiniFill.style.width = pct.toFixed(1) + "%";
      contextMiniFill.className = "context-mini-fill" + cls;
    }
    if (contextMiniLabel) {
      contextMiniLabel.textContent = (win > 0 ? formatTokens(used) + "/" + formatTokens(win) : "0%");
    }
    // Header bar
    if (pct > 0) {
      var statusArea = document.querySelector(".title-bar-content .status");
      if (statusArea && !headerContextEl) {
        headerContextEl = document.createElement("div");
        headerContextEl.className = "header-context";
        headerContextEl.innerHTML = '<div class="header-context-bar"><div class="header-context-fill"></div></div><span class="header-context-label"></span>';
        statusArea.insertBefore(headerContextEl, statusArea.firstChild);
      }
      if (headerContextEl) {
        var hFill = headerContextEl.querySelector(".header-context-fill");
        var hLabel = headerContextEl.querySelector(".header-context-label");
        hFill.style.width = pct.toFixed(1) + "%";
        hFill.className = "header-context-fill" + cls;
        hLabel.textContent = pct.toFixed(0) + "%";
        headerContextEl.dataset.tip = "Context window " + pct.toFixed(0) + "% used (" + formatTokens(used) + " / " + formatTokens(win) + " tokens)";
      }
    }
    contextUsedEl.textContent = formatTokens(used);
    contextWindowEl.textContent = win > 0 ? formatTokens(win) : "-";
    contextMaxOutputEl.textContent = contextData.maxOutputTokens > 0 ? formatTokens(contextData.maxOutputTokens) : "-";
    contextInputEl.textContent = formatTokens(contextData.input);
    contextOutputEl.textContent = formatTokens(contextData.output);
    contextCacheReadEl.textContent = formatTokens(contextData.cacheRead);
    contextCacheWriteEl.textContent = formatTokens(contextData.cacheWrite);
    contextModelEl.textContent = contextData.model;
    contextCostEl.textContent = "$" + contextData.cost.toFixed(4);
    contextTurnsEl.textContent = String(contextData.turns);
  }

  function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) {
    if (cost != null) contextData.cost += cost;
    // Use latest turn values (not cumulative) since each turn's input_tokens
    // already includes the full conversation context up to that point
    if (usage) {
      // Prefer per-call input_tokens from the last stream message_start event
      // when available — result.usage.input_tokens sums all API calls in a turn,
      // inflating context usage when tools are involved.
      // Falls back to the summed value for setups that don't emit message_start.
      if (lastStreamInputTokens) {
        contextData.input = lastStreamInputTokens;
      } else {
        contextData.input = (usage.input_tokens || usage.inputTokens || 0)
            + (usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0);
      }
      contextData.output = usage.output_tokens || usage.outputTokens || 0;
      contextData.cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
      contextData.cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
    }
    contextData.turns++;
    if (modelUsage) {
      var models = Object.keys(modelUsage);
      if (models.length > 0) {
        var m = models[0];
        var mu = modelUsage[m];
        contextData.model = m;
        contextData.contextWindow = resolveContextWindow(m, mu.contextWindow);
        if (mu.maxOutputTokens) contextData.maxOutputTokens = mu.maxOutputTokens;
      }
    }
    if (!replayingHistory) updateContextPanel();
  }

  // contextView: "off" | "mini" | "panel"
  function getContextView() {
    try { return localStorage.getItem("clay-context-view") || "off"; } catch (e) { return "off"; }
  }
  function setContextView(v) {
    try { localStorage.setItem("clay-context-view", v); } catch (e) {}
  }

  function applyContextView(view) {
    if (contextPanel) contextPanel.classList.toggle("hidden", view !== "panel");
    if (contextMini) contextMini.classList.toggle("hidden", view !== "mini");
    if (view === "panel") refreshIcons();
  }

  function resetContextData() {
    contextData = { contextWindow: 0, maxOutputTokens: 0, model: "-", cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    updateContextPanel();
  }

  function resetContext() {
    resetContextData();
    // Keep view state, just reset data
    applyContextView(getContextView());
  }

  function minimizeContext() {
    setContextView("mini");
    applyContextView("mini");
  }

  function expandContext() {
    setContextView("panel");
    applyContextView("panel");
  }

  function toggleContextPanel() {
    if (!contextPanel) return;
    var view = getContextView();
    if (view === "panel") {
      setContextView("mini");
      applyContextView("mini");
    } else {
      setContextView("panel");
      applyContextView("panel");
    }
  }

  if (contextPanelClose) {
    contextPanelClose.addEventListener("click", function () {
      setContextView("off");
      applyContextView("off");
    });
  }

  if (contextPanelMinimize) {
    contextPanelMinimize.addEventListener("click", minimizeContext);
  }

  // Restore context view on load
  applyContextView(getContextView());

  if (contextMini) {
    contextMini.addEventListener("click", expandContext);
  }

  function addToMessages(el) {
    if (prependAnchor) messagesEl.insertBefore(el, prependAnchor);
    else messagesEl.appendChild(el);
  }

  var newMsgBtn = $("new-msg-btn");
  var newMsgBtnDefault = "\u2193 Latest";
  var newMsgBtnActivity = "\u2193 New activity";

  messagesEl.addEventListener("scroll", function () {
    var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isUserScrolledUp = distFromBottom > scrollThreshold;
    if (isUserScrolledUp) {
      if (newMsgBtn.classList.contains("hidden")) {
        newMsgBtn.textContent = newMsgBtnDefault;
      }
      newMsgBtn.classList.remove("hidden");
    } else {
      newMsgBtn.classList.add("hidden");
      newMsgBtn.textContent = newMsgBtnDefault;
    }
  });

  newMsgBtn.addEventListener("click", function () {
    forceScrollToBottom();
  });

  // Fork session from a user message
  messagesEl.addEventListener("click", function(e) {
    var btn = e.target.closest(".msg-action-fork");
    if (!btn) return;
    var msgEl = btn.closest("[data-uuid]");
    if (!msgEl || !msgEl.dataset.uuid) return;
    var forkUuid = msgEl.dataset.uuid;
    showConfirm("Fork session from this message?", function() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "fork_session", uuid: forkUuid }));
      }
    }, "Fork", false);
  });

  function scrollToBottom() {
    if (prependAnchor) return;
    if (isUserScrolledUp) {
      newMsgBtn.textContent = newMsgBtnActivity;
      newMsgBtn.classList.remove("hidden");
      return;
    }
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function forceScrollToBottom() {
    if (prependAnchor) return;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    newMsgBtn.textContent = newMsgBtnDefault;
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return ws; },
    get connected() { return connected; },
    get turnCounter() { return turnCounter; },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showImageModal: showImageModal,
    getContextPercent: function() {
      var used = contextData.input;
      var win = contextData.contextWindow;
      return win > 0 ? Math.round((used / win) * 100) : 0;
    },
  });

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- DOM: Messages ---
  function addUserMessage(text, images, pastes) {
    if (!text && (!images || images.length === 0) && (!pastes || pastes.length === 0)) return;
    var div = document.createElement("div");
    div.className = "msg-user";
    div.dataset.turn = ++turnCounter;
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.dir = "auto";

    if (images && images.length > 0) {
      var imgRow = document.createElement("div");
      imgRow.className = "bubble-images";
      for (var i = 0; i < images.length; i++) {
        var img = document.createElement("img");
        img.src = "data:" + images[i].mediaType + ";base64," + images[i].data;
        img.className = "bubble-img";
        img.addEventListener("click", function () { showImageModal(this.src); });
        imgRow.appendChild(img);
      }
      bubble.appendChild(imgRow);
    }

    if (pastes && pastes.length > 0) {
      var pasteRow = document.createElement("div");
      pasteRow.className = "bubble-pastes";
      for (var p = 0; p < pastes.length; p++) {
        (function (pasteText) {
          var chip = document.createElement("div");
          chip.className = "bubble-paste";
          var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
          if (pasteText.length > 60) preview += "...";
          chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
          chip.addEventListener("click", function (e) {
            e.stopPropagation();
            showPasteModal(pasteText);
          });
          pasteRow.appendChild(chip);
        })(pastes[p]);
      }
      bubble.appendChild(pasteRow);
    }

    if (text) {
      var textEl = document.createElement("span");
      textEl.textContent = text;
      bubble.appendChild(textEl);
    }


    div.appendChild(bubble);

    // Action bar below bubble (icons visible on hover)
    var actions = document.createElement("div");
    actions.className = "msg-actions";
    var now = new Date();
    var timeStr = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    actions.innerHTML =
      '<span class="msg-action-time">' + timeStr + '</span>' +
      '<button class="msg-action-btn msg-action-copy" type="button" title="Copy">' + iconHtml("copy") + '</button>' +
      '<button class="msg-action-btn msg-action-fork" type="button" title="Fork">' + iconHtml("git-branch") + '</button>' +
      '<button class="msg-action-btn msg-action-rewind msg-user-rewind-btn" type="button" title="Rewind">' + iconHtml("rotate-ccw") + '</button>' +
      '<button class="msg-action-btn msg-action-hidden msg-action-edit" type="button" title="Edit">' + iconHtml("pencil") + '</button>';
    div.appendChild(actions);

    // Copy handler
    actions.querySelector(".msg-action-copy").addEventListener("click", function () {
      var self = this;
      copyToClipboard(text || "");
      self.innerHTML = iconHtml("check");
      refreshIcons();
      setTimeout(function () { self.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
    });

    addToMessages(div);
    refreshIcons();
    forceScrollToBottom();
  }

  function ensureAssistantBlock() {
    if (!currentMsgEl) {
      currentMsgEl = document.createElement("div");
      currentMsgEl.className = "msg-assistant";
      currentMsgEl.dataset.turn = turnCounter;
      currentMsgEl.innerHTML = '<div class="md-content" dir="auto"></div>';
      addToMessages(currentMsgEl);
      currentFullText = "";
    }
    return currentMsgEl;
  }

  function addCopyHandler(msgEl, rawText) {
    var primed = false;
    var resetTimer = null;

    var isTouchDevice = "ontouchstart" in window;

    var hint = document.createElement("div");
    hint.className = "msg-copy-hint";
    hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    msgEl.appendChild(hint);

    function reset() {
      primed = false;
      msgEl.classList.remove("copy-primed", "copy-done");
      hint.textContent = (isTouchDevice ? "Tap" : "Click") + " to grab this";
    }

    msgEl.addEventListener("click", function (e) {
      // Don't intercept clicks on links or code blocks
      if (e.target.closest("a, pre, code")) return;
      // Don't intercept text selection
      var sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;

      if (!primed) {
        primed = true;
        msgEl.classList.add("copy-primed");
        hint.textContent = isTouchDevice ? "Tap again to grab" : "Click again to grab";
        clearTimeout(resetTimer);
        resetTimer = setTimeout(reset, 3000);
      } else {
        clearTimeout(resetTimer);
        copyToClipboard(rawText).then(function () {
          msgEl.classList.remove("copy-primed");
          msgEl.classList.add("copy-done");
          hint.textContent = "Grabbed!";
          resetTimer = setTimeout(reset, 1500);
        });
      }
    });

    document.addEventListener("click", function (e) {
      if (primed && !msgEl.contains(e.target)) reset();
    });
  }

  // --- Stream smoothing: buffer deltas and drain at a steady frame rate ---
  var streamBuffer = "";
  var streamDrainTimer = null;

  function appendDelta(text) {
    ensureAssistantBlock();
    streamBuffer += text;
    if (!streamDrainTimer) {
      streamDrainTimer = requestAnimationFrame(drainStreamTick);
    }
  }

  function drainStreamTick() {
    streamDrainTimer = null;
    if (!currentMsgEl || streamBuffer.length === 0) return;

    // Adaptive chunk size: drain just enough per frame to keep up
    // without letting the buffer grow unbounded.
    // At 60fps, typical streaming (~300 chars/sec) needs ~5 chars/frame.
    var n;
    var len = streamBuffer.length;
    if (len > 200) { n = Math.ceil(len / 4); }
    else if (len > 80) { n = 8; }
    else if (len > 30) { n = 5; }
    else if (len > 10) { n = 2; }
    else { n = 1; }

    var chunk = streamBuffer.slice(0, n);
    streamBuffer = streamBuffer.slice(n);
    currentFullText += chunk;

    // Full markdown render every frame — keeps structure (tables, lists)
    // intact and avoids cursor-span jumping artifacts.
    var contentEl = currentMsgEl.querySelector(".md-content");
    contentEl.innerHTML = renderMarkdown(currentFullText);

    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      highlightCodeBlocks(contentEl);
    }, 150);

    scrollToBottom();

    if (streamBuffer.length > 0) {
      streamDrainTimer = requestAnimationFrame(drainStreamTick);
    }
  }

  function flushStreamBuffer() {
    if (streamDrainTimer) { cancelAnimationFrame(streamDrainTimer); streamDrainTimer = null; }
    if (streamBuffer.length > 0) {
      currentFullText += streamBuffer;
      streamBuffer = "";
    }
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        contentEl.innerHTML = renderMarkdown(currentFullText);
        highlightCodeBlocks(contentEl);
      }
    }
  }

  function finalizeAssistantBlock() {
    flushStreamBuffer();
    if (currentMsgEl) {
      var contentEl = currentMsgEl.querySelector(".md-content");
      if (contentEl) {
        highlightCodeBlocks(contentEl);
        renderMermaidBlocks(contentEl);
      }
      if (currentFullText) {
        addCopyHandler(currentMsgEl, currentFullText);
      }
      // Assistant text appeared, so break the current tool group
      closeToolGroup();
    }
    currentMsgEl = null;
    currentFullText = "";
  }

  function addSystemMessage(text, isError) {
    var div = document.createElement("div");
    div.className = "sys-msg" + (isError ? " error" : "");
    div.innerHTML = '<span class="sys-text"></span>';
    div.querySelector(".sys-text").textContent = text;
    addToMessages(div);
    scrollToBottom();
  }

  function addConflictMessage(msg) {
    var div = document.createElement("div");
    div.className = "conflict-msg";
    var header = document.createElement("div");
    header.className = "conflict-header";
    header.textContent = msg.text || "Another Claude Code process is already running.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "conflict-hint";
    hint.textContent = "Kill the conflicting process to continue, or use the existing Claude Code session.";
    div.appendChild(hint);

    for (var i = 0; i < msg.processes.length; i++) {
      var p = msg.processes[i];
      var row = document.createElement("div");
      row.className = "conflict-process";

      var info = document.createElement("span");
      info.className = "conflict-pid";
      info.textContent = "PID " + p.pid;
      row.appendChild(info);

      var cmd = document.createElement("code");
      cmd.className = "conflict-cmd";
      cmd.textContent = p.command.length > 80 ? p.command.substring(0, 80) + "..." : p.command;
      cmd.title = p.command;
      row.appendChild(cmd);

      var killBtn = document.createElement("button");
      killBtn.className = "conflict-kill-btn";
      killBtn.textContent = "Kill Process";
      killBtn.setAttribute("data-pid", p.pid);
      killBtn.addEventListener("click", function() {
        var pid = parseInt(this.getAttribute("data-pid"), 10);
        ws.send(JSON.stringify({ type: "kill_process", pid: pid }));
        this.disabled = true;
        this.textContent = "Killing...";
      });
      row.appendChild(killBtn);
      div.appendChild(row);
    }

    addToMessages(div);
    scrollToBottom();
  }

  function addContextOverflowMessage(msg) {
    var div = document.createElement("div");
    div.className = "context-overflow-msg";

    var header = document.createElement("div");
    header.className = "context-overflow-header";
    header.textContent = msg.text || "Conversation too long to continue.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "context-overflow-hint";
    hint.textContent = "The conversation has exceeded the model's context limit. Please start a new conversation to continue.";
    div.appendChild(hint);

    var btn = document.createElement("button");
    btn.className = "context-overflow-btn";
    btn.textContent = "New Conversation";
    btn.addEventListener("click", function() {
      ws.send(JSON.stringify({ type: "new_session" }));
    });
    div.appendChild(btn);

    addToMessages(div);
    scrollToBottom();
  }

  // Pending command to run in the next created terminal
  var pendingTermCommand = null;

  function addAuthRequiredMessage(msg) {
    var div = document.createElement("div");
    div.className = "auth-required-msg";

    var header = document.createElement("div");
    header.className = "auth-required-header";
    header.textContent = msg.text || "Claude Code is not logged in.";
    div.appendChild(header);

    var hint = document.createElement("div");
    hint.className = "auth-required-hint";

    if (msg.canAutoLogin) {
      // Auto-open terminal and run claude
      if (msg.linuxUser) {
        hint.textContent = "Opening a terminal as " + msg.linuxUser + " to log in...";
      } else {
        hint.textContent = "Opening a terminal to log in...";
      }
      div.appendChild(hint);

      var guide = document.createElement("div");
      guide.className = "auth-required-guide";
      guide.textContent = "When a login URL appears in the terminal, click it to open in your browser. Do not press 'c' as it will try to open the browser on the server.";
      div.appendChild(guide);

      var sessionHint = document.createElement("div");
      sessionHint.className = "auth-required-guide";
      sessionHint.textContent = "After logging in, start a new session to continue.";
      div.appendChild(sessionHint);

      addToMessages(div);
      scrollToBottom();

      // Hide input area on this session since it cannot be used
      var inputArea = document.getElementById("input-area");
      if (inputArea) inputArea.classList.add("hidden");

      // Only auto-open terminal on live events, not history replay
      if (!replayingHistory) {
        pendingTermCommand = "claude\n";
        ws.send(JSON.stringify({ type: "term_create", cols: 80, rows: 24 }));
        openTerminal();
      }
    } else {
      // Multi-user regular user: show message only, no auto-login
      hint.textContent = "Please ask an administrator to log in to Claude Code.";
      div.appendChild(hint);
      addToMessages(div);
      scrollToBottom();

      inputEl.disabled = true;
      inputEl.placeholder = "Login required. Start a new session after logging in.";
      sendBtn.disabled = true;
    }
  }

  // --- Rate Limit ---

  var rateLimitCountdownTimer = null;
  var rateLimitIndicatorEl = null;

  function rateLimitTypeLabel(type) {
    if (!type) return "Usage";
    var labels = {
      "five_hour": "5-hour",
      "seven_day": "7-day",
      "seven_day_opus": "7-day Opus",
      "seven_day_sonnet": "7-day Sonnet",
      "overage": "Overage",
    };
    return labels[type] || type;
  }

  function startRateLimitCountdown(el, resetsAt, cardEl) {
    if (rateLimitCountdownTimer) clearInterval(rateLimitCountdownTimer);

    function tick() {
      var remaining = resetsAt - Date.now();
      if (remaining <= 0) {
        clearInterval(rateLimitCountdownTimer);
        rateLimitCountdownTimer = null;
        clearRateLimitIndicator();
        return;
      }
      // Update pill text with countdown
      if (rateLimitIndicatorEl) {
        var pillText = rateLimitIndicatorEl.querySelector(".header-pill-text");
        if (pillText) {
          var mins = Math.floor(remaining / 60000);
          var secs = Math.floor((remaining % 60000) / 1000);
          if (mins >= 60) {
            var hrs = Math.floor(mins / 60);
            mins = mins % 60;
            pillText.textContent = hrs + "h " + mins + "m";
          } else {
            pillText.textContent = mins + "m " + secs + "s";
          }
        }
      }
    }

    tick();
    rateLimitCountdownTimer = setInterval(tick, 1000);
  }

  function updateRateLimitIndicator(msg) {
    var statusArea = document.querySelector(".title-bar-content .status");
    if (!statusArea) return;

    if (!rateLimitIndicatorEl) {
      rateLimitIndicatorEl = document.createElement("span");
      rateLimitIndicatorEl.className = "header-rate-limit-wrap";
      statusArea.insertBefore(rateLimitIndicatorEl, statusArea.firstChild);
    }

    var isRejected = msg.status === "rejected";
    var pillClass = "header-rate-limit" + (isRejected ? " rejected" : " warning");
    var label = isRejected ? "Rate limited" : "Rate warning";
    rateLimitIndicatorEl.innerHTML =
      '<span class="' + pillClass + '">' +
        iconHtml("alert-triangle") +
        '<span class="header-pill-text">' + label + "</span>" +
        '<a href="https://claude.ai/settings/usage" target="_blank" rel="noopener" class="rate-limit-link">' +
          iconHtml("external-link") +
        "</a>" +
      "</span>";
    refreshIcons();
  }

  function showRateLimitPopover(text, isRejected) {
    if (!rateLimitIndicatorEl) return;
    // Remove existing popover
    var old = rateLimitIndicatorEl.querySelector(".rate-limit-popover");
    if (old) old.remove();

    var pop = document.createElement("div");
    pop.className = "rate-limit-popover" + (isRejected ? " rejected" : "");
    pop.textContent = text;
    rateLimitIndicatorEl.appendChild(pop);

    // Auto-dismiss after 5s
    setTimeout(function () {
      pop.classList.add("fade-out");
      setTimeout(function () { if (pop.parentNode) pop.remove(); }, 300);
    }, 5000);
  }

  function clearRateLimitIndicator() {
    if (rateLimitIndicatorEl) {
      rateLimitIndicatorEl.remove();
      rateLimitIndicatorEl = null;
    }
  }

  function handleRateLimitEvent(msg) {
    var isRejected = msg.status === "rejected";
    var typeLabel = rateLimitTypeLabel(msg.rateLimitType);
    var popoverText = "";

    if (isRejected && msg.resetsAt) {
      // Check if already expired (history replay) — skip popover
      if (msg.resetsAt < Date.now()) {
        updateRateLimitIndicator(msg);
        return;
      }
      popoverText = typeLabel + " limit exceeded";
      updateRateLimitIndicator(msg);
      startRateLimitCountdown(null, msg.resetsAt, null);
    } else {
      var pct = msg.utilization ? Math.round(msg.utilization * 100) : null;
      popoverText = typeLabel + " warning" + (pct ? " (" + pct + "% used)" : "");
      updateRateLimitIndicator(msg);
    }

    showRateLimitPopover(popoverText, isRejected);
  }

  // --- Fast Mode State ---

  var fastModeIndicatorEl = null;

  function handleFastModeState(state) {
    var statusArea = document.querySelector(".title-bar-content .status");
    if (!statusArea) return;

    if (state === "off") {
      if (fastModeIndicatorEl) {
        fastModeIndicatorEl.remove();
        fastModeIndicatorEl = null;
      }
      return;
    }

    if (!fastModeIndicatorEl) {
      fastModeIndicatorEl = document.createElement("span");
      statusArea.insertBefore(fastModeIndicatorEl, statusArea.firstChild);
    }

    if (state === "cooldown") {
      fastModeIndicatorEl.className = "header-fast-mode cooldown";
      fastModeIndicatorEl.innerHTML = iconHtml("timer") + '<span class="header-pill-text">Cooldown</span>';
    } else if (state === "on") {
      fastModeIndicatorEl.className = "header-fast-mode active";
      fastModeIndicatorEl.innerHTML = iconHtml("zap") + '<span class="header-pill-text">Fast mode</span>';
    }
    refreshIcons();
  }

  // --- Prompt suggestion chips ---
  function showSuggestionChips(suggestion) {
    if (!suggestion || processing) return;
    suggestionChipsEl.innerHTML = "";
    var chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.innerHTML =
      '<span class="suggestion-chip-send">' + iconHtml("sparkles") +
      '<span class="suggestion-chip-text">' + escapeHtml(suggestion) + '</span></span>' +
      '<span class="suggestion-chip-edit">' + iconHtml("pencil") + '</span>';
    chip.addEventListener("click", function () {
      inputEl.value = suggestion;
      hideSuggestionChips();
      sendMessage();
    });
    chip.querySelector(".suggestion-chip-edit").addEventListener("click", function (e) {
      e.stopPropagation();
      inputEl.value = suggestion;
      inputEl.focus();
      inputEl.select();
      autoResize();
      hideSuggestionChips();
    });
    suggestionChipsEl.appendChild(chip);
    suggestionChipsEl.classList.remove("hidden");
    refreshIcons();
  }

  function hideSuggestionChips() {
    suggestionChipsEl.innerHTML = "";
    suggestionChipsEl.classList.add("hidden");
  }

  function resetClientState() {
    messagesEl.innerHTML = "";
    currentMsgEl = null;
    currentFullText = "";
    resetToolState();
    clearPendingImages();
    activityEl = null;
    processing = false;
    turnCounter = 0;
    messageUuidMap = [];
    historyFrom = 0;
    historyTotal = 0;
    prependAnchor = null;
    loadingMore = false;
    isUserScrolledUp = false;
    newMsgBtn.classList.add("hidden");
    setRewindMode(false);
    removeSearchTimeline();
    setActivity(null);
    setStatus("connected");
    if (!loopActive) enableMainInput();
    resetUsage();
    resetContext();
    // Clear header indicators
    clearRateLimitIndicator();
    if (rateLimitCountdownTimer) { clearInterval(rateLimitCountdownTimer); rateLimitCountdownTimer = null; }
    if (fastModeIndicatorEl) { fastModeIndicatorEl.remove(); fastModeIndicatorEl = null; }
    if (headerContextEl) { headerContextEl.remove(); headerContextEl = null; }
    hideSuggestionChips();
    closeSessionInfoPopover();
    stopUrgentBlink();
  }

  // --- Project switching (no full reload) ---
  function switchProject(slug) {
    if (!slug) return;
    var wasDm = dmMode;
    if (dmMode) exitDmMode();
    if (homeHubVisible) {
      hideHomeHub();
      if (slug === currentSlug) return;
    }
    if (slug === currentSlug) {
      // Returning from DM mode to the same project: re-switch to restore session
      if (wasDm && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "switch_session", id: activeSessionId }));
      }
      return;
    }
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
      processing = false;
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

  function processMessage(msg) {
      switch (msg.type) {
        case "history_meta":
          historyFrom = msg.from;
          historyTotal = msg.total;
          replayingHistory = true;
          updateHistorySentinel();
          break;

        case "history_prepend":
          prependOlderHistory(msg.items, msg.meta);
          break;

        case "history_done":
          replayingHistory = false;
          // Restore accurate context data from the last result in full history
          if (msg.lastUsage || msg.lastModelUsage) {
            accumulateContext(msg.lastCost, msg.lastUsage, msg.lastModelUsage, msg.lastStreamInputTokens);
          }
          updateContextPanel();
          updateUsagePanel();
          // Render + finalize any incomplete turn from the replayed history
          if (currentMsgEl && currentFullText) {
            var replayContentEl = currentMsgEl.querySelector(".md-content");
            if (replayContentEl) {
              replayContentEl.innerHTML = renderMarkdown(currentFullText);
            }
          }
          markAllToolsDone();
          finalizeAssistantBlock();
          stopUrgentBlink();
          scrollToBottom();
          var pendingQuery = getActiveSearchQuery();
          if (pendingQuery) {
            requestAnimationFrame(function() { buildSearchTimeline(pendingQuery); });
          }
          // Scroll to tool element if navigating from file edit history
          var nav = getPendingNavigate();
          if (nav && (nav.toolId || nav.assistantUuid)) {
            requestAnimationFrame(function() {
              // Prefer scrolling to the exact tool element
              var target = nav.toolId ? messagesEl.querySelector('[data-tool-id="' + nav.toolId + '"]') : null;
              if (!target && nav.assistantUuid) {
                target = messagesEl.querySelector('[data-uuid="' + nav.assistantUuid + '"]');
              }
              if (target) {
                // Auto-expand parent tool group if collapsed
                var parentGroup = target.closest(".tool-group");
                if (parentGroup) parentGroup.classList.remove("collapsed");
                target.scrollIntoView({ behavior: "smooth", block: "center" });
                target.classList.add("message-blink");
                setTimeout(function() { target.classList.remove("message-blink"); }, 2000);
              }
            });
          }
          break;

        case "info":
          if (msg.text && !msg.project && !msg.cwd) {
            addSystemMessage(msg.text, false);
            break;
          }
          projectName = msg.project || msg.cwd;
          if (msg.slug) currentSlug = msg.slug;
          try { localStorage.setItem("clay-project-name-" + (currentSlug || "default"), projectName); } catch (e) {}
          headerTitleEl.textContent = projectName;
          var tbProjectName = $("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || projectName;
          updatePageTitle();
          if (msg.version) {
            var vEl = $("footer-version");
            if (vEl) vEl.textContent = "v" + msg.version;
          }
          if (msg.projectOwnerId !== undefined) currentProjectOwnerId = msg.projectOwnerId;
          if (msg.osUsers !== undefined) isOsUsers = !!msg.osUsers;
          if (msg.lanHost) window.__lanHost = msg.lanHost;
          if (msg.dangerouslySkipPermissions) {
            skipPermsEnabled = true;
            var spBanner = $("skip-perms-pill");
            if (spBanner) spBanner.classList.remove("hidden");
          }
          updateProjectList(msg);
          break;

        case "update_available":
          var updatePillWrap = $("update-pill-wrap");
          var updateVersion = $("update-version");
          if (updatePillWrap && updateVersion && msg.version) {
            updateVersion.textContent = "v" + msg.version;
            updatePillWrap.classList.remove("hidden");
            // Reset button state (may be stuck on "Updating..." after restart)
            var updResetBtn = $("update-now");
            if (updResetBtn) {
              updResetBtn.innerHTML = '<i data-lucide="download"></i> Update now';
              updResetBtn.disabled = false;
            }
            // Update manual command based on version (beta vs stable)
            var updManualCmd = $("update-manual-cmd");
            if (updManualCmd) {
              var updTag = msg.version.indexOf("-beta") !== -1 ? "beta" : "latest";
              updManualCmd.textContent = "npx clay-server@" + updTag;
            }
            refreshIcons();
          }
          // Update the settings check-for-updates button
          var settingsUpdBtn = $("settings-update-check");
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
          var updNowBtn = $("update-now");
          if (updNowBtn) {
            updNowBtn.innerHTML = '<i data-lucide="loader"></i> Updating...';
            updNowBtn.disabled = true;
            refreshIcons();
            var spinIcon = updNowBtn.querySelector(".lucide");
            if (spinIcon) spinIcon.classList.add("icon-spin-inline");
          }
          // Block the entire screen with the connect overlay
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
          // Validate effort against current model's supported levels
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
          // Sidebar presence: current project's online users
          if (msg.users) {
            renderSidebarPresence(msg.users);
          }
          // Non-multi-user mode: simple count in topbar
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

        case "input_sync":
          if (!dmMode) handleInputSync(msg.text);
          break;

        case "session_list":
          renderSessionList(msg.sessions || []);
          break;

        case "session_presence":
          updateSessionPresence(msg.presence || {});
          break;

        case "session_io":
          blinkSessionDot(msg.id);
          break;

        case "session_unread":
          updateSessionBadge(msg.id, msg.count);
          break;

        case "search_results":
          handleSearchResults(msg);
          break;

        case "search_content_results":
          handleSearchContentResults(msg);
          break;

        case "cli_session_list":
          populateCliSessionList(msg.sessions || []);
          break;

        case "session_switched":
          hideHomeHub();
          // Save draft from outgoing session
          if (activeSessionId && inputEl.value) {
            sessionDrafts[activeSessionId] = inputEl.value;
          } else if (activeSessionId) {
            delete sessionDrafts[activeSessionId];
          }
          activeSessionId = msg.id;
          cliSessionId = msg.cliSessionId || null;
          resetClientState();
          updateRalphBars();
          updateLoopInputVisibility(msg.loop);
          // Restore draft for incoming session
          var draft = sessionDrafts[activeSessionId] || "";
          inputEl.value = draft;
          autoResize();
          if (!("ontouchstart" in window)) {
            inputEl.focus();
          }
          break;

        case "session_id":
          cliSessionId = msg.cliSessionId;
          break;

        case "message_uuid":
          var uuidTarget;
          if (msg.messageType === "user") {
            var allUsers = messagesEl.querySelectorAll(".msg-user:not([data-uuid])");
            if (allUsers.length > 0) uuidTarget = allUsers[allUsers.length - 1];
          } else {
            var allAssistants = messagesEl.querySelectorAll(".msg-assistant:not([data-uuid])");
            if (allAssistants.length > 0) uuidTarget = allAssistants[allAssistants.length - 1];
          }
          if (uuidTarget) {
            uuidTarget.dataset.uuid = msg.uuid;
            if (msg.messageType === "user") addRewindButton(uuidTarget);
          }
          messageUuidMap.push({ uuid: msg.uuid, type: msg.messageType });
          break;

        case "user_message":
          resetThinkingGroup();
          if (msg.planContent) {
            setPlanContent(msg.planContent);
            renderPlanCard(msg.planContent);
            addUserMessage("Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.", msg.images || null, msg.pastes || null);
          } else {
            addUserMessage(msg.text, msg.images || null, msg.pastes || null);
          }
          break;

        case "status":
          if (msg.status === "processing") {
            setStatus("processing");
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "compacting":
          if (msg.active) {
            setActivity("Compacting conversation...");
          } else {
            setActivity(randomThinkingVerb() + "...");
          }
          break;

        case "thinking_start":
          startThinking();
          break;

        case "thinking_delta":
          if (typeof msg.text === "string") appendThinking(msg.text);
          break;

        case "thinking_stop":
          stopThinking(msg.duration);
          setActivity(randomThinkingVerb() + "...");
          break;

        case "delta":
          if (typeof msg.text !== "string") break;
          stopThinking();
          resetThinkingGroup();
          setActivity(null);
          appendDelta(msg.text);
          break;

        case "tool_start":
          stopThinking();
          markAllToolsDone();
          if (msg.name === "EnterPlanMode") {
            renderPlanBanner("enter");
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (msg.name === "ExitPlanMode") {
            if (getPlanContent()) {
              renderPlanCard(getPlanContent());
            }
            renderPlanBanner("exit");
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else if (getTodoTools()[msg.name]) {
            getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
          } else {
            createToolItem(msg.id, msg.name);
          }
          break;

        case "tool_executing":
          if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
            var askTool = getTools()[msg.id];
            if (askTool) {
              if (askTool.el) askTool.el.style.display = "none";
              askTool.done = true;
              removeToolFromGroup(msg.id);
            }
            renderAskUserQuestion(msg.id, msg.input);
            startUrgentBlink();
          } else if (msg.name === "Write" && msg.input && isPlanFilePath(msg.input.file_path)) {
            setPlanContent(msg.input.content || "");
            updateToolExecuting(msg.id, msg.name, msg.input);
          } else if (msg.name === "Edit" && msg.input && isPlanFilePath(msg.input.file_path)) {
            var pc = getPlanContent() || "";
            if (msg.input.old_string && pc.indexOf(msg.input.old_string) !== -1) {
              if (msg.input.replace_all) {
                setPlanContent(pc.split(msg.input.old_string).join(msg.input.new_string || ""));
              } else {
                setPlanContent(pc.replace(msg.input.old_string, msg.input.new_string || ""));
              }
            }
            updateToolExecuting(msg.id, msg.name, msg.input);
          } else if (msg.name === "TodoWrite") {
            handleTodoWrite(msg.input);
          } else if (msg.name === "TaskCreate") {
            handleTaskCreate(msg.input);
          } else if (msg.name === "TaskUpdate") {
            handleTaskUpdate(msg.input);
          } else if (getTodoTools()[msg.name]) {
            // TaskList, TaskGet - silently skip
          } else {
            var t = getTools()[msg.id];
            if (t && t.hidden) break;
            updateToolExecuting(msg.id, msg.name, msg.input);
          }
          break;

        case "tool_result": {
            var tr = getTools()[msg.id];
            if (tr && tr.hidden) break; // skip hidden plan tools
            // Always call updateToolResult for Edit (to show diff from input), or when content exists
            if (msg.content != null || msg.images || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
              updateToolResult(msg.id, msg.content || "", msg.is_error || false, msg.images);
            }
            // Refresh file browser if an Edit/Write tool modified the open file
            if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && tr.input && tr.input.file_path) {
              refreshIfOpen(tr.input.file_path);
            }
          }
          break;

        case "ask_user_answered":
          markAskUserAnswered(msg.toolId);
          stopUrgentBlink();
          break;

        case "permission_request":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          startUrgentBlink();
          break;

        case "permission_cancel":
          markPermissionCancelled(msg.requestId);
          stopUrgentBlink();
          break;

        case "permission_resolved":
          markPermissionResolved(msg.requestId, msg.decision);
          stopUrgentBlink();
          break;

        case "permission_request_pending":
          renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason);
          startUrgentBlink();
          break;

        case "elicitation_request":
          renderElicitationRequest(msg);
          startUrgentBlink();
          break;

        case "elicitation_resolved":
          markElicitationResolved(msg.requestId, msg.action);
          stopUrgentBlink();
          break;

        case "slash_command_result":
          finalizeAssistantBlock();
          var cmdBlock = document.createElement("div");
          cmdBlock.className = "assistant-block";
          cmdBlock.style.maxWidth = "var(--content-width)";
          cmdBlock.style.margin = "12px auto";
          cmdBlock.style.padding = "0 20px";
          var pre = document.createElement("pre");
          pre.style.cssText = "background:var(--code-bg);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;margin:0";
          pre.textContent = msg.text;
          cmdBlock.appendChild(pre);
          addToMessages(cmdBlock);
          scrollToBottom();
          break;

        case "subagent_activity":
          updateSubagentActivity(msg.parentToolId, msg.text);
          break;

        case "subagent_tool":
          addSubagentToolEntry(msg.parentToolId, msg.toolName, msg.toolId, msg.text);
          break;

        case "subagent_done":
          markSubagentDone(msg.parentToolId, msg.status, msg.summary, msg.usage);
          break;

        case "task_started":
          initSubagentStop(msg.parentToolId, msg.taskId);
          break;

        case "task_progress":
          updateSubagentProgress(msg.parentToolId, msg.usage, msg.lastToolName, msg.summary);
          break;

        case "result":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          closeToolGroup();
          finalizeAssistantBlock();
          addTurnMeta(msg.cost, msg.duration);
          accumulateUsage(msg.cost, msg.usage);
          accumulateContext(msg.cost, msg.usage, msg.modelUsage, msg.lastStreamInputTokens);
          break;

        case "done":
          setActivity(null);
          stopThinking();
          markAllToolsDone();
          closeToolGroup();
          finalizeAssistantBlock();
          processing = false;
          setStatus("connected");
          if (!loopActive) enableMainInput();
          resetToolState();
          stopUrgentBlink();
          if (document.hidden) {
            if (isNotifAlertEnabled() && !window._pushSubscription) showDoneNotification();
            if (isNotifSoundEnabled()) playDoneSound();
          }
          break;

        case "stderr":
          addSystemMessage(msg.text, false);
          break;

        case "error":
          setActivity(null);
          addSystemMessage(msg.text, true);
          break;

        case "process_conflict":
          setActivity(null);
          addConflictMessage(msg);
          break;

        case "context_overflow":
          setActivity(null);
          addContextOverflowMessage(msg);
          break;

        case "auth_required":
          setActivity(null);
          addAuthRequiredMessage(msg);
          break;

        case "rate_limit":
          handleRateLimitEvent(msg);
          break;

        case "prompt_suggestion":
          showSuggestionChips(msg.suggestion);
          break;

        case "fast_mode_state":
          handleFastModeState(msg.state);
          break;

        case "process_killed":
          addSystemMessage("Process " + msg.pid + " has been terminated. You can retry your message now.", false);
          break;

        case "rewind_preview_result":
          showRewindModal(msg);
          break;

        case "rewind_complete":
          setRewindMode(false);
          var rewindText = "Rewound to earlier point. Files have been restored.";
          if (msg.mode === "chat") rewindText = "Conversation rewound to earlier point.";
          else if (msg.mode === "files") rewindText = "Files restored to earlier point.";
          addSystemMessage(rewindText, false);
          break;

        case "rewind_error":
          clearPendingRewindUuid();
          addSystemMessage(msg.text || "Rewind failed.", true);
          break;

        case "fork_complete":
          addSystemMessage("Session forked successfully.");
          break;

        case "fs_list_result":
          handleFsList(msg);
          break;

        case "fs_read_result":
          if (msg.path === "CLAUDE.md" && isProjectSettingsOpen()) {
            handleInstructionsRead(msg);
          } else {
            handleFsRead(msg);
          }
          break;

        case "fs_write_result":
          handleInstructionsWrite(msg);
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

        case "fs_file_changed":
          handleFileChanged(msg);
          break;

        case "fs_dir_changed":
          handleDirChanged(msg);
          break;

        case "fs_file_history_result":
          handleFileHistory(msg);
          break;

        case "fs_git_diff_result":
          handleGitDiff(msg);
          break;

        case "fs_file_at_result":
          handleFileAt(msg);
          break;

        case "term_list":
          handleTermList(msg);
          break;

        case "term_created":
          handleTermCreated(msg);
          if (pendingTermCommand) {
            var cmd = pendingTermCommand;
            pendingTermCommand = null;
            // Small delay to let terminal initialize
            setTimeout(function() {
              sendTerminalCommand(cmd);
            }, 300);
          }
          break;

        case "term_output":
          handleTermOutput(msg);
          break;

        case "term_exited":
          handleTermExited(msg);
          break;

        case "term_closed":
          handleTermClosed(msg);
          break;

        case "notes_list":
          handleNotesList(msg);
          break;

        case "note_created":
          handleNoteCreated(msg);
          break;

        case "note_updated":
          handleNoteUpdated(msg);
          break;

        case "note_deleted":
          handleNoteDeleted(msg);
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

        case "clone_project_progress":
          handleCloneProgress(msg);
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

        case "project_owner_changed":
          currentProjectOwnerId = msg.ownerId;
          handleProjectOwnerChanged(msg);
          break;

        // --- DM ---
        case "dm_history":
          enterDmMode(msg.dmKey, msg.targetUser, msg.messages);
          break;

        case "dm_message":
          if (dmMode && msg.dmKey === dmKey) {
            showDmTypingIndicator(false); // hide typing when message arrives
            appendDmMessage(msg.message);
            scrollToBottom();
          } else if (msg.message) {
            // DM notification when not in that DM
            var fromId = msg.message.from;
            if (fromId && fromId !== myUserId) {
              dmUnread[fromId] = (dmUnread[fromId] || 0) + 1;
              // Re-render strip so non-favorited sender appears
              renderUserStrip(cachedAllUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers);
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
          // Could be used for DM list view later
          break;

        case "dm_favorites_updated":
          // Track users explicitly removed from favorites
          if (cachedDmFavorites && msg.dmFavorites) {
            for (var ri = 0; ri < cachedDmFavorites.length; ri++) {
              if (msg.dmFavorites.indexOf(cachedDmFavorites[ri]) === -1) {
                dmRemovedUsers[cachedDmFavorites[ri]] = true;
              }
            }
          }
          // Clear removed flag for users being added back
          if (msg.dmFavorites) {
            for (var ai = 0; ai < msg.dmFavorites.length; ai++) {
              delete dmRemovedUsers[msg.dmFavorites[ai]];
            }
          }
          cachedDmFavorites = msg.dmFavorites || [];
          renderUserStrip(cachedAllUsers, cachedOnlineIds, myUserId, cachedDmFavorites, cachedDmConversations, dmUnread, dmRemovedUsers);
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

        // --- Ralph Loop ---
        case "loop_available":
          loopAvailable = msg.available;
          loopActive = msg.active;
          loopIteration = msg.iteration || 0;
          loopMaxIterations = msg.maxIterations || 20;
          updateLoopButton();
          if (loopActive) {
            showLoopBanner(true);
            if (loopIteration > 0) {
              updateLoopBanner(loopIteration, loopMaxIterations, "running");
            }
            inputEl.disabled = true;
            inputEl.placeholder = "Ralph Loop is running...";
          }
          break;

        case "loop_started":
          loopActive = true;
          ralphPhase = "executing";
          loopIteration = 0;
          loopMaxIterations = msg.maxIterations;
          showLoopBanner(true);
          updateLoopButton();
          addSystemMessage("Ralph Loop started (max " + msg.maxIterations + " iterations)", false);
          inputEl.disabled = true;
          inputEl.placeholder = "Ralph Loop is running...";
          break;

        case "loop_iteration":
          loopIteration = msg.iteration;
          loopMaxIterations = msg.maxIterations;
          updateLoopBanner(msg.iteration, msg.maxIterations, "running");
          updateLoopButton();
          addSystemMessage("Ralph Loop iteration #" + msg.iteration + " started", false);
          inputEl.disabled = true;
          inputEl.placeholder = "Ralph Loop is running...";
          break;

        case "loop_judging":
          updateLoopBanner(loopIteration, loopMaxIterations, "judging");
          addSystemMessage("Judging iteration #" + msg.iteration + "...", false);
          inputEl.disabled = true;
          inputEl.placeholder = "Ralph Loop is judging...";
          break;

        case "loop_verdict":
          addSystemMessage("Judge: " + msg.verdict.toUpperCase() + " - " + (msg.summary || ""), false);
          break;

        case "loop_stopping":
          updateLoopBanner(loopIteration, loopMaxIterations, "stopping");
          break;

        case "loop_finished":
          loopActive = false;
          ralphPhase = "done";
          showLoopBanner(false);
          updateLoopButton();
          enableMainInput();
          var finishMsg = msg.reason === "pass"
            ? "Ralph Loop completed successfully after " + msg.iterations + " iteration(s)."
            : msg.reason === "max_iterations"
              ? "Ralph Loop reached maximum iterations (" + msg.iterations + ")."
              : msg.reason === "stopped"
                ? "Ralph Loop stopped."
                : "Ralph Loop ended with error.";
          addSystemMessage(finishMsg, false);
          break;

        case "loop_error":
          addSystemMessage("Ralph Loop error: " + msg.text, true);
          break;

        // --- Ralph Wizard / Crafting ---
        case "ralph_phase":
          ralphPhase = msg.phase || "idle";
          if (msg.craftingSessionId) ralphCraftingSessionId = msg.craftingSessionId;
          updateLoopButton();
          updateRalphBars();
          break;

        case "ralph_crafting_started":
          ralphPhase = "crafting";
          ralphCraftingSessionId = msg.sessionId || activeSessionId;
          updateLoopButton();
          updateRalphBars();
          if (msg.source !== "ralph") {
            // Task sessions open in the scheduler calendar window
            enterCraftingMode(msg.sessionId, msg.taskId);
          }
          // Ralph crafting sessions show in session list as part of the loop group
          break;

        case "ralph_files_status":
          ralphFilesReady = {
            promptReady: msg.promptReady,
            judgeReady: msg.judgeReady,
            bothReady: msg.bothReady,
          };
          if (msg.bothReady && (ralphPhase === "crafting" || ralphPhase === "approval")) {
            ralphPhase = "approval";
            if (isSchedulerOpen()) {
              // Task crafting in scheduler: switch from crafting chat to detail view showing files
              exitCraftingMode(msg.taskId);
            } else {
              showRalphApprovalBar(true);
            }
          }
          updateRalphApprovalStatus();
          break;

        case "loop_registry_files_content":
          handleLoopRegistryFiles(msg);
          break;

        case "ralph_files_content":
          ralphPreviewContent = { prompt: msg.prompt || "", judge: msg.judge || "" };
          openRalphPreviewModal();
          break;

        case "loop_registry_error":
          addSystemMessage("Error: " + msg.text, true);
          break;
      }
  }

  // --- Progressive history loading ---
  function updateHistorySentinel() {
    var existing = messagesEl.querySelector(".history-sentinel");
    if (historyFrom > 0) {
      if (!existing) {
        var sentinel = document.createElement("div");
        sentinel.className = "history-sentinel";
        sentinel.innerHTML = '<button class="load-more-btn">Load earlier messages</button>';
        sentinel.querySelector(".load-more-btn").addEventListener("click", function () {
          requestMoreHistory();
        });
        messagesEl.insertBefore(sentinel, messagesEl.firstChild);

        // Auto-load when sentinel scrolls into view
        if (historySentinelObserver) historySentinelObserver.disconnect();
        historySentinelObserver = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting && !loadingMore && historyFrom > 0) {
            requestMoreHistory();
          }
        }, { root: messagesEl, rootMargin: "200px 0px 0px 0px" });
        historySentinelObserver.observe(sentinel);
      }
    } else {
      if (existing) existing.remove();
      if (historySentinelObserver) { historySentinelObserver.disconnect(); historySentinelObserver = null; }
    }
  }

  function requestMoreHistory() {
    if (loadingMore || historyFrom <= 0 || !ws || !connected) return;
    loadingMore = true;
    var btn = messagesEl.querySelector(".load-more-btn");
    if (btn) btn.classList.add("loading");
    ws.send(JSON.stringify({ type: "load_more_history", before: historyFrom }));
  }

  function prependOlderHistory(items, meta) {
    // Save current rendering state
    var savedMsgEl = currentMsgEl;
    var savedActivity = activityEl;
    var savedFullText = currentFullText;
    var savedTurnCounter = turnCounter;
    var savedToolsState = saveToolState();
    // Save context & usage so old result messages don't overwrite current values
    var savedContext = JSON.parse(JSON.stringify(contextData));
    var savedUsage = JSON.parse(JSON.stringify(sessionUsage));

    // Reset to initial values for clean rendering
    currentMsgEl = null;
    activityEl = null;
    currentFullText = "";
    turnCounter = 0;
    resetToolState();

    // Set prepend anchor to insert before existing content
    // Skip the sentinel itself when setting anchor
    var firstReal = messagesEl.querySelector(".history-sentinel");
    prependAnchor = firstReal ? firstReal.nextSibling : messagesEl.firstChild;

    // Remember the first existing content element and its position
    var anchorEl = prependAnchor;
    var anchorOffset = anchorEl ? anchorEl.getBoundingClientRect().top : 0;

    // Process each item through the rendering pipeline
    for (var i = 0; i < items.length; i++) {
      processMessage(items[i]);
    }

    // Finalize any open assistant block from the batch
    finalizeAssistantBlock();

    // Clear prepend mode
    prependAnchor = null;

    // Restore saved state
    currentMsgEl = savedMsgEl;
    activityEl = savedActivity;
    currentFullText = savedFullText;
    turnCounter = savedTurnCounter;
    restoreToolState(savedToolsState);
    // Restore context & usage (old result messages must not overwrite current values)
    contextData = savedContext;
    sessionUsage = savedUsage;
    updateContextPanel();
    updateUsagePanel();

    // Fix scroll: restore anchor element to same visual position
    if (anchorEl) {
      var newTop = anchorEl.getBoundingClientRect().top;
      messagesEl.scrollTop += (newTop - anchorOffset);
    }

    // Update state
    historyFrom = meta.from;
    loadingMore = false;

    // Renumber data-turn attributes in DOM order
    var turnEls = messagesEl.querySelectorAll("[data-turn]");
    for (var t = 0; t < turnEls.length; t++) {
      turnEls[t].dataset.turn = t + 1;
    }
    turnCounter = turnEls.length;

    // Update sentinel
    if (meta.hasMore) {
      var btn = messagesEl.querySelector(".load-more-btn");
      if (btn) btn.classList.remove("loading");
    } else {
      updateHistorySentinel();
    }

    // Notify sidebar search that history was prepended (for pending scroll targets)
    onHistoryPrepended();
  }

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
    get processing() { return processing; },
    get basePath() { return basePath; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return slashCommands; },
    messageUuidMap: function() { return messageUuidMap; },
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

  // --- Force PIN change overlay (for admin-created accounts with temp PIN) ---
  function showForceChangePinOverlay() {
    var ov = document.createElement("div");
    ov.id = "force-change-pin-overlay";
    ov.style.cssText = "position:fixed;inset:0;background:var(--bg,#0e0e10);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column";
    ov.innerHTML = '<div style="width:100%;max-width:380px;padding:24px;text-align:center">' +
      '<h2 style="margin:0 0 8px;color:var(--text,#fff);font-size:22px">Set your new PIN</h2>' +
      '<p style="margin:0 0 24px;color:var(--text-secondary,#aaa);font-size:14px">Your temporary PIN has expired. Please set a new 6-digit PIN to continue.</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px" id="fcp-boxes">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '<input class="fcp-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off" style="width:44px;height:52px;text-align:center;font-size:22px;font-weight:600;border:2px solid var(--border,#333);border-radius:10px;background:var(--bg-secondary,#1a1a1e);color:var(--text,#fff);outline:none">' +
      '</div>' +
      '<button id="fcp-save" disabled style="width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent,#7c3aed);color:#fff;font-size:15px;font-weight:600;cursor:pointer;opacity:0.5">Save PIN</button>' +
      '<div id="fcp-err" style="margin-top:12px;color:#ef4444;font-size:13px"></div>' +
      '</div>';
    document.body.appendChild(ov);

    var digits = ov.querySelectorAll(".fcp-digit");
    var saveBtn = ov.querySelector("#fcp-save");
    var errEl = ov.querySelector("#fcp-err");

    function getPin() {
      var pin = "";
      for (var i = 0; i < digits.length; i++) pin += digits[i].value;
      return pin;
    }

    function updateBtn() {
      var ready = getPin().length === 6;
      saveBtn.disabled = !ready;
      saveBtn.style.opacity = ready ? "1" : "0.5";
    }

    for (var i = 0; i < digits.length; i++) {
      (function (idx) {
        digits[idx].addEventListener("input", function () {
          var val = this.value.replace(/\D/g, "");
          this.value = val.substring(0, 1);
          if (val && idx < digits.length - 1) digits[idx + 1].focus();
          updateBtn();
        });
        digits[idx].addEventListener("keydown", function (e) {
          if (e.key === "Backspace" && !this.value && idx > 0) {
            digits[idx - 1].focus();
            digits[idx - 1].value = "";
            updateBtn();
          }
          if (e.key === "Enter" && !saveBtn.disabled) doSave();
          e.stopPropagation();
        });
        digits[idx].addEventListener("keyup", function (e) { e.stopPropagation(); });
        digits[idx].addEventListener("keypress", function (e) { e.stopPropagation(); });
        digits[idx].addEventListener("paste", function (e) {
          e.preventDefault();
          var text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").substring(0, 6);
          for (var j = 0; j < text.length && (idx + j) < digits.length; j++) {
            digits[idx + j].value = text[j];
          }
          if (text.length > 0) {
            var focusIdx = Math.min(idx + text.length, digits.length - 1);
            digits[focusIdx].focus();
          }
          updateBtn();
        });
      })(i);
    }
    digits[0].focus();

    function doSave() {
      var pin = getPin();
      if (pin.length !== 6) return;
      saveBtn.disabled = true;
      saveBtn.style.opacity = "0.5";
      errEl.textContent = "";
      fetch("/api/user/pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin: pin }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          ov.remove();
          return;
        }
        errEl.textContent = d.error || "Failed to save PIN";
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
      }).catch(function () {
        errEl.textContent = "Connection error";
        saveBtn.disabled = false;
        saveBtn.style.opacity = "1";
      });
    }
    saveBtn.addEventListener("click", doSave);
  }

  // --- Admin (multi-user mode) ---
  var isMultiUserMode = false;
  var myUserId = null;
  initAdmin({
    get projectList() { return cachedProjects; },
  });
  fetch("/api/me").then(function (r) { return r.json(); }).then(function (d) {
    if (d.multiUser) isMultiUserMode = true;
    if (d.user && d.user.id) myUserId = d.user.id;
    if (d.mustChangePin) showForceChangePinOverlay();
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
    get currentThinking() { return currentThinking; },
    get currentThinkingBudget() { return currentThinkingBudget; },
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
    get currentThinking() { return currentThinking; },
    get currentThinkingBudget() { return currentThinkingBudget; },
  }, getEmojiCategories());

  // --- QR code ---
  initQrCode();

  // --- File browser ---
  initFileBrowser({
    get ws() { return ws; },
    get connected() { return connected; },
    get activeSessionId() { return activeSessionId; },
    messagesEl: messagesEl,
    fileTreeEl: $("file-tree"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Terminal ---
  initTerminal({
    get ws() { return ws; },
    get connected() { return connected; },
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Playbook Engine ---
  initPlaybook();

  // --- Sticky Notes ---
  initStickyNotes({
    get ws() { return ws; },
    get connected() { return connected; },
  });

  // --- Sticky Notes sidebar button (archive view) ---
  var stickyNotesSidebarBtn = $("sticky-notes-sidebar-btn");
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
  var fileBrowserBtn = $("file-browser-btn");
  var terminalSidebarBtn = $("terminal-sidebar-btn");
  if (fileBrowserBtn) fileBrowserBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });
  if (terminalSidebarBtn) terminalSidebarBtn.addEventListener("click", function () { if (isArchiveOpen()) closeArchive(); if (isSchedulerOpen()) closeScheduler(); });

  // --- Ralph Loop UI ---
  function updateLoopInputVisibility(loop) {
    var inputArea = document.getElementById("input-area");
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

    var busy = loopActive || ralphPhase === "executing";
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
      var iterText = loopIteration > 0 ? "Running \u00b7 iteration " + loopIteration + "/" + loopMaxIterations : "Starting\u2026";
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
    var statusText = "Iteration #" + loopIteration + " / " + loopMaxIterations;

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
    var stickyEl = document.getElementById("ralph-sticky");
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
    var onCraftingSession = ralphCraftingSessionId && activeSessionId === ralphCraftingSessionId;
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
    var stickyEl = document.getElementById("ralph-sticky");
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
    var stickyEl = document.getElementById("ralph-sticky");
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
    var stickyEl = document.getElementById("ralph-sticky");
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
    get activeSessionId() { return activeSessionId; },
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
      // No tasks — confirm then particle burst + remove
      showConfirm('Remove "' + name + '"? You can re-add it later.', function () {
        // Find the icon strip item to anchor the particle burst
        var iconEl = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
        if (iconEl) {
          var rect = iconEl.getBoundingClientRect();
          spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
        setTimeout(function () {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
          }
        }, 1000);
      }, "Remove", true);
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
      // If we removed the current project, go to home hub without full reload
      if (msg.slug === currentSlug) {
        // Suppress disconnect overlay and reconnect by detaching the WS
        if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); ws = null; }
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        connected = false;
        connectOverlay.classList.add("hidden");
        // Add to cached removed projects for re-add UI
        var removedProj = null;
        for (var ri = 0; ri < cachedProjects.length; ri++) {
          if (cachedProjects[ri].slug === msg.slug) { removedProj = cachedProjects[ri]; break; }
        }
        if (removedProj) {
          cachedRemovedProjects.push({
            path: removedProj.path || "",
            title: removedProj.title || null,
            icon: removedProj.icon || null,
            removedAt: Date.now(),
          });
        }
        // Remove from cached projects and re-render icon strip
        cachedProjects = cachedProjects.filter(function (p) { return p.slug !== msg.slug; });
        cachedProjectCount = cachedProjects.length;
        currentSlug = null;
        renderProjectList();
        resetClientState();
        showHomeHub();
      }
    } else {
      showToast(msg.error || "Failed to remove project", "error");
    }
  }

  // --- Add project modal ---
  var addProjectModal = document.getElementById("add-project-modal");
  var addProjectInput = document.getElementById("add-project-input");
  var addProjectCreateInput = document.getElementById("add-project-create-input");
  var addProjectCloneInput = document.getElementById("add-project-clone-input");
  var addProjectCloneProgress = document.getElementById("add-project-clone-progress");
  var addProjectSuggestions = document.getElementById("add-project-suggestions");
  var addProjectError = document.getElementById("add-project-error");
  var addProjectOk = document.getElementById("add-project-ok");
  var addProjectCancel = document.getElementById("add-project-cancel");
  var addProjectModeBtns = addProjectModal.querySelectorAll(".add-project-mode-btn");
  var addProjectPanels = addProjectModal.querySelectorAll(".add-project-panel");
  var addProjectRemoved = document.getElementById("add-project-removed");
  var addProjectDebounce = null;
  var addProjectActiveIdx = -1;
  var addProjectMode = "existing";

  function switchAddProjectMode(mode) {
    addProjectMode = mode;
    for (var mi = 0; mi < addProjectModeBtns.length; mi++) {
      var btn = addProjectModeBtns[mi];
      if (btn.dataset.mode === mode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
    for (var pi = 0; pi < addProjectPanels.length; pi++) {
      var panel = addProjectPanels[pi];
      if (panel.dataset.panel === mode) {
        panel.classList.add("active");
      } else {
        panel.classList.remove("active");
      }
    }
    addProjectError.classList.add("hidden");
    addProjectCloneProgress.classList.add("hidden");
    // Update OK button text
    if (mode === "existing") {
      addProjectOk.textContent = "Add";
    } else if (mode === "create") {
      addProjectOk.textContent = "Create";
    } else if (mode === "clone") {
      addProjectOk.textContent = "Clone";
    }
    // Focus the right input
    setTimeout(function () {
      if (mode === "existing") {
        addProjectInput.focus();
      } else if (mode === "create") {
        addProjectCreateInput.focus();
      } else if (mode === "clone") {
        addProjectCloneInput.focus();
      }
    }, 50);
  }

  for (var mbi = 0; mbi < addProjectModeBtns.length; mbi++) {
    addProjectModeBtns[mbi].addEventListener("click", function () {
      if (this.disabled) return;
      switchAddProjectMode(this.dataset.mode);
    });
  }

  function openAddProjectModal() {
    addProjectModal.classList.remove("hidden");
    addProjectInput.value = "/";
    addProjectCreateInput.value = "";
    addProjectCloneInput.value = "";
    addProjectError.classList.add("hidden");
    addProjectError.textContent = "";
    addProjectCloneProgress.classList.add("hidden");
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectActiveIdx = -1;
    addProjectOk.disabled = false;
    // In osUsers mode, disable "existing" and default to "create"
    var existingBtn = addProjectModal.querySelector('.add-project-mode-btn[data-mode="existing"]');
    if (isOsUsers) {
      existingBtn.disabled = true;
      switchAddProjectMode("create");
    } else {
      existingBtn.disabled = false;
      switchAddProjectMode("existing");
    }
    // Render removed projects for re-add
    renderRemovedProjectsList();
  }

  function renderRemovedProjectsList() {
    if (!addProjectRemoved) return;
    addProjectRemoved.innerHTML = "";
    if (!cachedRemovedProjects || cachedRemovedProjects.length === 0) {
      addProjectRemoved.classList.add("hidden");
      return;
    }
    addProjectRemoved.classList.remove("hidden");
    for (var ri = 0; ri < cachedRemovedProjects.length; ri++) {
      var rp = cachedRemovedProjects[ri];
      var item = document.createElement("div");
      item.className = "add-project-removed-item";
      item.dataset.path = rp.path;
      item.addEventListener("click", function () {
        var p = this.dataset.path;
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "add_project", path: p }));
        }
        closeAddProjectModal();
      });
      var iconEl = document.createElement("span");
      iconEl.className = "add-project-removed-icon";
      iconEl.textContent = rp.icon || "📁";
      item.appendChild(iconEl);
      var info = document.createElement("div");
      info.className = "add-project-removed-info";
      var nameEl = document.createElement("div");
      nameEl.className = "add-project-removed-name";
      nameEl.textContent = rp.title || rp.path.split("/").pop() || rp.path;
      info.appendChild(nameEl);
      var pathEl = document.createElement("div");
      pathEl.className = "add-project-removed-path";
      pathEl.textContent = rp.path;
      info.appendChild(pathEl);
      item.appendChild(info);
      addProjectRemoved.appendChild(item);
    }
    try { parseEmojis(addProjectRemoved); } catch (e) {}
  }

  function closeAddProjectModal() {
    addProjectModal.classList.add("hidden");
    addProjectInput.value = "";
    addProjectCreateInput.value = "";
    addProjectCloneInput.value = "";
    addProjectSuggestions.classList.add("hidden");
    addProjectSuggestions.innerHTML = "";
    addProjectError.classList.add("hidden");
    addProjectCloneProgress.classList.add("hidden");
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
    addProjectCloneProgress.classList.add("hidden");
    if (msg.ok) {
      closeAddProjectModal();
      if (msg.existing) {
        showToast("Project already registered", "info");
      } else {
        var toastMsg = addProjectMode === "create" ? "Project created" : addProjectMode === "clone" ? "Project cloned" : "Project added";
        showToast(toastMsg, "success");
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

  function handleCloneProgress(msg) {
    if (msg.status === "cloning") {
      addProjectCloneProgress.classList.remove("hidden");
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

  // Enter key on create/clone inputs
  addProjectCreateInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  addProjectCloneInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  function submitAddProject() {
    addProjectError.classList.add("hidden");
    addProjectOk.disabled = true;

    if (addProjectMode === "existing") {
      var val = addProjectInput.value.replace(/\/+$/, "");
      if (!val) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "add_project", path: val }));
      }
    } else if (addProjectMode === "create") {
      var name = addProjectCreateInput.value.trim();
      if (!name) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "create_project", name: name }));
      }
    } else if (addProjectMode === "clone") {
      var url = addProjectCloneInput.value.trim();
      if (!url) { addProjectOk.disabled = false; return; }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "clone_project", url: url }));
      }
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
