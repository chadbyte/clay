// Shared debate participation controls for Home and project workspaces.

function findHeader(messages) {
  for (var i = (messages || []).length - 1; i >= 0; i--) if (messages[i] && messages[i].role === "debate_header") return messages[i];
  return null;
}

function findActiveTurn(messages) {
  for (var i = (messages || []).length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "debate_turn" && messages[i].status === "active") return messages[i];
  }
  return null;
}

export function homeDebateControlState(messages) {
  var header = findHeader(messages);
  if (!header || ["live", "ended", "interrupted"].indexOf(header.phase) === -1) return null;
  var mode = header.phase === "live" ? (header.interaction || "default") : "terminal";
  return { mode: mode, header: header, turn: findActiveTurn(messages), phase: header.phase };
}

export function createDebateControls(options) {
  var slotEl = null;
  var normalComposerEl = null;
  var modelEl = null;
  var controlEl = null;
  var controlMode = null;
  var controlStateKey = null;
  var currentState = null;
  var currentRequestId = null;
  var startNewDebate = null;
  var inputEl = null;
  var primaryEl = null;
  var secondaryEl = null;
  var activityEl = null;
  var handEl = null;
  var stopEl = null;
  var composing = false;
  var sizeAnimation = null;

  function textElement(tag, className, text) {
    var element = document.createElement(tag);
    element.className = className;
    element.textContent = text || "";
    return element;
  }

  function ensureElements() {
    var nextSlot = document.getElementById(options.slotId);
    if (slotEl === nextSlot) return !!slotEl;
    slotEl = nextSlot;
    normalComposerEl = document.getElementById(options.composerId);
    modelEl = options.modelId ? document.getElementById(options.modelId) : null;
    controlEl = null;
    controlMode = null;
    controlStateKey = null;
    return !!slotEl;
  }

  function clearControls() {
    if (sizeAnimation) { sizeAnimation.cancel(); sizeAnimation = null; }
    if (slotEl) slotEl.innerHTML = "";
    controlEl = null;
    controlMode = null;
    controlStateKey = null;
    currentState = null;
    inputEl = null;
    primaryEl = null;
    secondaryEl = null;
    activityEl = null;
    handEl = null;
    stopEl = null;
    composing = false;
  }

  function setSpecialMode(active) {
    if (normalComposerEl) normalComposerEl.hidden = active;
    if (modelEl) modelEl.hidden = active;
    if (slotEl) slotEl.hidden = !active;
  }

  function sendControl(action, data) {
    if (!currentState) return false;
    return options.send(action, data || {}, currentRequestId);
  }

  function button(label, className) {
    var element = textElement("button", className, label);
    element.type = "button";
    return element;
  }

  function dots() {
    var group = document.createElement("span");
    group.className = "home-debate-control-dots";
    group.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 3; i++) group.appendChild(document.createElement("i"));
    return group;
  }

  function activityLabel(state) {
    if (state.header.stopping) return state.turn ? "Stopping after " + (state.turn.mateName || "the current speaker") + " finishes" : "Stopping debate";
    if (!state.turn) return state.header.handRaised ? "Your hand is raised" : "Debate is live";
    var name = state.turn.mateName || "Mate";
    var activity = state.turn.activity || (state.turn.text ? "speaking" : "preparing");
    return name + " is " + activity.toLowerCase();
  }

  function lockSubmission(label) {
    if (inputEl) inputEl.disabled = true;
    if (primaryEl) { primaryEl.disabled = true; primaryEl.textContent = label; }
    if (secondaryEl) secondaryEl.disabled = true;
  }

  function submitInput(action, response) {
    var text = inputEl ? inputEl.value.trim() : "";
    if (action === "user_floor" && !text) return false;
    if (!sendControl(action, { text: text, response: response })) return false;
    lockSubmission(action === "user_floor" ? "Sending…" : "Continuing…");
    return true;
  }

  function bindInput(submit) {
    inputEl.addEventListener("compositionstart", function () { composing = true; });
    inputEl.addEventListener("compositionend", function () { composing = false; });
    inputEl.addEventListener("input", function () {
      if (controlMode === "user_floor" && primaryEl) primaryEl.disabled = !inputEl.value.trim();
    });
    inputEl.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
      event.preventDefault();
      submit();
    });
  }

  function focusInputOnce() {
    var target = inputEl;
    if (!target) return;
    var focus = function () {
      if (target === inputEl && !target.disabled && target.isConnected !== false) target.focus({ preventScroll: true });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else focus();
  }

  function buildDefault(state) {
    var context = document.createElement("div");
    context.className = "home-debate-control-context";
    context.appendChild(dots());
    activityEl = textElement("span", "home-debate-control-activity", activityLabel(state));
    activityEl.setAttribute("role", "status");
    activityEl.setAttribute("aria-live", "polite");
    context.appendChild(activityEl);
    controlEl.appendChild(context);
    var actions = document.createElement("div");
    actions.className = "home-debate-control-actions";
    handEl = button(state.header.handRaised ? "Hand raised" : "Raise hand", "home-debate-control-secondary");
    handEl.setAttribute("aria-pressed", state.header.handRaised ? "true" : "false");
    handEl.disabled = state.header.handRaised === true;
    handEl.addEventListener("click", function () {
      if (!sendControl("hand_raise")) return;
      handEl.disabled = true;
      handEl.textContent = "Raising hand…";
    });
    stopEl = button(state.header.stopping ? "Cancel stop" : "Stop debate", state.header.stopping ? "home-debate-control-secondary" : "home-debate-control-stop");
    stopEl.addEventListener("click", function () {
      var cancelling = currentState && currentState.header && currentState.header.stopping === true;
      if (!sendControl(cancelling ? "cancel_stop" : "stop")) return;
      stopEl.disabled = true;
      stopEl.textContent = cancelling ? "Cancelling…" : "Stopping…";
    });
    actions.appendChild(handEl);
    actions.appendChild(stopEl);
    controlEl.appendChild(actions);
  }

  function buildInputMode(state) {
    var isFloor = state.mode === "user_floor";
    var heading = textElement("div", "home-debate-control-heading", isFloor ? "You have the floor" : "The moderator is ready to conclude");
    heading.id = options.slotId + "-heading";
    controlEl.appendChild(heading);
    inputEl = document.createElement("textarea");
    inputEl.rows = 2;
    inputEl.placeholder = isFloor ? "Share your thoughts with the panel" : "Add an optional direction to continue";
    inputEl.setAttribute("aria-labelledby", heading.id);
    controlEl.appendChild(inputEl);
    var actions = document.createElement("div");
    actions.className = "home-debate-control-actions";
    if (isFloor) {
      primaryEl = button("Send", "home-debate-control-primary");
      primaryEl.disabled = true;
      primaryEl.addEventListener("click", function () { submitInput("user_floor"); });
      secondaryEl = button("Pass", "home-debate-control-secondary");
      secondaryEl.addEventListener("click", function () {
        if (!sendControl("user_floor", { text: "(The user passed without speaking)" })) return;
        lockSubmission("Sending…");
      });
    } else {
      primaryEl = button("Continue", "home-debate-control-primary");
      primaryEl.addEventListener("click", function () { submitInput("conclude", "continue"); });
      secondaryEl = button("End debate", "home-debate-control-stop");
      secondaryEl.addEventListener("click", function () {
        if (!sendControl("conclude", { response: "end" })) return;
        lockSubmission("Ending…");
      });
    }
    actions.appendChild(primaryEl);
    actions.appendChild(secondaryEl);
    controlEl.appendChild(actions);
    bindInput(function () { submitInput(isFloor ? "user_floor" : "conclude", isFloor ? null : "continue"); });
    focusInputOnce();
  }

  function terminalLabel(state) {
    if (state.phase === "interrupted") return "Debate interrupted when Clay restarted";
    if (state.header.reason === "error") return "The debate stopped after an error";
    if (state.header.reason === "stopped" || state.header.reason === "user_stopped") return "Debate stopped";
    return "Debate ended";
  }

  function buildTerminal(state) {
    var status = textElement("div", "home-debate-control-terminal-status", terminalLabel(state));
    status.setAttribute("role", "status");
    controlEl.appendChild(status);
    var actions = document.createElement("div");
    actions.className = "home-debate-control-actions";
    primaryEl = button("Resume debate", "home-debate-control-primary");
    primaryEl.addEventListener("click", function () {
      if (!sendControl("resume")) return;
      lockSubmission("Resuming…");
    });
    actions.appendChild(primaryEl);
    if (typeof startNewDebate === "function") {
      secondaryEl = button("New debate", "home-debate-control-secondary");
      secondaryEl.addEventListener("click", function () { startNewDebate(); });
      actions.appendChild(secondaryEl);
    }
    controlEl.appendChild(actions);
  }

  function buildControls(state) {
    var previousHeight = slotEl.getBoundingClientRect ? slotEl.getBoundingClientRect().height : 0;
    if (sizeAnimation) { sizeAnimation.cancel(); sizeAnimation = null; }
    slotEl.innerHTML = "";
    controlEl = document.createElement("section");
    controlEl.className = "home-debate-control-surface home-debate-control-" + state.mode;
    controlEl.setAttribute("role", state.mode === "default" ? "toolbar" : "region");
    controlEl.setAttribute("aria-label", state.mode === "terminal" ? "Debate status" : "Live debate controls");
    slotEl.appendChild(controlEl);
    if (state.mode === "default") buildDefault(state);
    else if (state.mode === "user_floor" || state.mode === "conclude") buildInputMode(state);
    else buildTerminal(state);
    if (previousHeight && slotEl.animate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      var nextHeight = slotEl.getBoundingClientRect().height;
      if (Math.abs(previousHeight - nextHeight) > 1) sizeAnimation = slotEl.animate([
        { height: previousHeight + 'px' }, { height: nextHeight + 'px' }
      ], { duration: 170, easing: 'ease-out' });
    }
    controlMode = state.mode;
    controlStateKey = state.mode + ":" + state.phase + ":" + (state.header.reason || "");
  }

  function updateControls(state) {
    if (state.mode !== "default") return;
    var label = activityLabel(state);
    if (activityEl && activityEl.textContent !== label) activityEl.textContent = label;
    if (state.header.handRaised && handEl) {
      handEl.textContent = "Hand raised";
      handEl.disabled = true;
      handEl.setAttribute("aria-pressed", "true");
    }
    if (stopEl) {
      stopEl.disabled = false;
      stopEl.textContent = state.header.stopping ? "Cancel stop" : "Stop debate";
      stopEl.className = state.header.stopping ? "home-debate-control-secondary" : "home-debate-control-stop";
    }
  }

  function renderControls(messages, requestId, onStartNewDebate) {
    if (!ensureElements()) return false;
    var state = homeDebateControlState(messages);
    if (currentRequestId !== (requestId || null)) clearControls();
    currentRequestId = requestId || null;
    startNewDebate = onStartNewDebate || null;
    if (!state) {
      setSpecialMode(false);
      clearControls();
      return false;
    }
    currentState = state;
    setSpecialMode(true);
    var nextStateKey = state.mode + ":" + state.phase + ":" + (state.header.reason || "");
    if (!controlEl || controlMode !== state.mode || controlStateKey !== nextStateKey) buildControls(state);
    else updateControls(state);
    return true;
  }

  return { render: renderControls };
}
