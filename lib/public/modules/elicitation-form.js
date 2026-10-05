// Elicitation request card: renders a restricted-schema form, keeps omitted
// optional values distinct from explicit false/0/"", validates before sending,
// and stays editable until the server confirms the response.
import { escapeHtml } from './utils.js';
import { iconHtml } from './icons.js';
import { getWs } from './ws-ref.js';
import { fieldInfo, patternIsBounded, validateForm } from './elicitation-schema.js';

var UNSET = "__clay_unset__";
var FORMAT_INPUT_TYPES = { email: "email", uri: "url", date: "date" };

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function hasDefault(prop) {
  return Object.prototype.hasOwnProperty.call(prop, "default");
}

function choiceSelect(name, choices, prop, required, labels) {
  var select = el("select", "elicitation-input");
  var defaultIndex = -1;
  for (var i = 0; i < choices.length; i++) {
    if (hasDefault(prop) && choices[i].value === prop.default) defaultIndex = i;
  }
  if (!required || defaultIndex === -1) {
    var unset = el("option", null, required ? labels.required : labels.optional);
    unset.value = UNSET;
    select.appendChild(unset);
  }
  choices.forEach(function (choice, index) {
    var option = el("option", null, choice.label);
    option.value = String(index);
    if (choice.description) option.title = choice.description;
    select.appendChild(option);
  });
  select.value = defaultIndex === -1 ? UNSET : String(defaultIndex);
  select.name = name;
  return select;
}

// Each builder returns { node, read } where read() yields { present, value }
// or { present: true, raw } for unparsable text.
function buildControl(name, prop, info, required) {
  if (info.kind === "boolean") {
    if (required) {
      var box = el("input", "elicitation-checkbox");
      box.type = "checkbox";
      box.name = name;
      box.checked = prop.default === true;
      return { node: box, read: function () { return { present: true, value: box.checked }; } };
    }
    var boolSelect = choiceSelect(name, [{ value: true, label: "Yes" }, { value: false, label: "No" }], prop, false, { optional: "Not set" });
    return { node: boolSelect, read: function () {
      return boolSelect.value === UNSET ? { present: false } : { present: true, value: boolSelect.value === "0" };
    } };
  }
  if (info.kind === "array") {
    var group = el("div", "elicitation-choice-group");
    group.setAttribute("role", "group");
    var defaults = Array.isArray(prop.default) ? prop.default : [];
    var boxes = info.choices.map(function (choice, index) {
      var label = el("label", "elicitation-choice");
      var input = el("input");
      input.type = "checkbox";
      input.name = name;
      input.value = String(index);
      input.checked = defaults.indexOf(choice.value) !== -1;
      label.appendChild(input);
      label.appendChild(el("span", null, choice.label));
      if (choice.description) label.title = choice.description;
      group.appendChild(label);
      return input;
    });
    return { node: group, read: function () {
      var values = [];
      boxes.forEach(function (input, index) { if (input.checked) values.push(info.choices[index].value); });
      return values.length || required ? { present: true, value: values } : { present: false };
    } };
  }
  if (info.choices) {
    var select = choiceSelect(name, info.choices, prop, required, { optional: "Not set", required: "Select…" });
    return { node: select, read: function () {
      return select.value === UNSET ? { present: false } : { present: true, value: info.choices[Number(select.value)].value };
    } };
  }
  if (info.kind === "unsupported") {
    return { node: el("div", "elicitation-unsupported", "This field type is not supported here."), read: function () { return { present: false }; } };
  }
  var input = el("input", "elicitation-input");
  input.name = name;
  if (info.kind === "number" || info.kind === "integer") {
    input.type = "number";
    input.step = info.kind === "integer" ? "1" : "any";
    if (typeof prop.minimum === "number") input.min = String(prop.minimum);
    if (typeof prop.maximum === "number") input.max = String(prop.maximum);
    if (typeof prop.default === "number") input.value = String(prop.default);
    return { node: input, read: function () {
      if (input.value === "") return input.validity && input.validity.badInput ? { present: true, raw: true } : { present: false };
      return { present: true, value: Number(input.value) };
    } };
  }
  input.type = FORMAT_INPUT_TYPES[prop.format] || "text";
  if (typeof prop.default === "string") input.value = prop.default;
  if (prop.description) input.placeholder = prop.description;
  return { node: input, read: function () {
    if (input.value === "" && !required) return { present: false };
    return { present: true, value: input.value };
  } };
}

function buildField(name, prop, required) {
  var info = fieldInfo(prop);
  var wrapper = el("div", "elicitation-field");
  wrapper.dataset.propName = name;
  var label = el("label", "elicitation-label", (prop.title || name) + (required ? " *" : ""));
  wrapper.appendChild(label);
  var control = buildControl(name, prop, info, required);
  wrapper.appendChild(control.node);
  if (prop.description && prop.title) wrapper.appendChild(el("div", "elicitation-help", prop.description));
  if (typeof prop.pattern === "string" && !patternIsBounded(prop.pattern)) {
    wrapper.appendChild(el("div", "elicitation-help", "Expected pattern (checked by the agent): " + prop.pattern));
  }
  var error = el("div", "elicitation-field-error");
  error.setAttribute("role", "alert");
  wrapper.appendChild(error);
  return { name: name, wrapper: wrapper, control: control, error: error };
}

function collect(fields, schema) {
  var content = {};
  var errors = {};
  fields.forEach(function (field) {
    var read = field.control.read();
    if (read.raw) errors[field.name] = "Enter a number.";
    else if (read.present) content[field.name] = read.value;
  });
  var validation = validateForm(content, schema);
  Object.keys(validation.errors).forEach(function (name) { if (!errors[name]) errors[name] = validation.errors[name]; });
  return { content: content, errors: errors };
}

function setBusy(container, busy) {
  container.classList.toggle("submitting", busy);
  container.querySelectorAll(".permission-actions button").forEach(function (button) { button.disabled = busy; });
}

function showFormError(container, message) {
  var summary = container.querySelector(".elicitation-form-error");
  if (summary) summary.textContent = message || "";
}

function send(container, action, content, onSent) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    showFormError(container, "Not connected. Try again when the connection is restored.");
    return false;
  }
  var msg = { type: "elicitation_response", requestId: container.dataset.requestId, action: action };
  if (action === "accept") msg.content = content;
  ws.send(JSON.stringify(msg));
  setBusy(container, true);
  showFormError(container, "");
  if (onSent) onSent();
  return true;
}

function actionButton(label, className, handler) {
  var button = el("button", "permission-btn " + className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

export function buildElicitationCard(msg, onSent) {
  var container = el("div", "permission-container elicitation-container");
  container.dataset.requestId = msg.requestId;
  var header = el("div", "permission-header");
  header.innerHTML = '<span class="permission-icon">' + iconHtml("key") + '</span>' +
    '<span class="permission-title">' + escapeHtml(msg.serverName || "MCP Server") + ' requests input</span>';
  var body = el("div", "permission-body");
  if (msg.message) body.appendChild(el("div", "permission-reason", msg.message));
  var isUrl = msg.mode === "url" && msg.url;
  var schema = msg.requestedSchema || null;
  var fields = [];
  if (isUrl) {
    body.appendChild(el("div", "elicitation-url-info", "Opens: " + msg.url));
  } else if (schema && schema.properties) {
    var form = el("div", "elicitation-form");
    var required = Array.isArray(schema.required) ? schema.required : [];
    Object.keys(schema.properties).forEach(function (name) {
      var field = buildField(name, schema.properties[name] || {}, required.indexOf(name) !== -1);
      fields.push(field);
      form.appendChild(field.wrapper);
    });
    body.appendChild(form);
  }
  var summary = el("div", "elicitation-form-error");
  summary.setAttribute("role", "alert");
  body.appendChild(summary);

  var actions = el("div", "permission-actions");
  actions.appendChild(actionButton(isUrl ? "Open & Approve" : "Submit", "permission-allow elicitation-submit", function () {
    if (isUrl) {
      if (send(container, "accept", {}, onSent)) window.open(msg.url, "_blank");
      return;
    }
    var result = collect(fields, schema);
    var invalid = false;
    fields.forEach(function (field) {
      var message = result.errors[field.name] || "";
      field.error.textContent = message;
      field.wrapper.classList.toggle("invalid", !!message);
      if (message) invalid = true;
    });
    if (invalid) {
      showFormError(container, "Fix the highlighted fields before submitting.");
      return;
    }
    send(container, "accept", result.content, onSent);
  }));
  actions.appendChild(actionButton("Decline", "permission-deny elicitation-decline", function () { send(container, "decline", null, onSent); }));
  actions.appendChild(actionButton("Cancel", "permission-allow-session elicitation-cancel", function () { send(container, "cancel", null, onSent); }));
  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  return container;
}

var RESOLVED = {
  accept: { label: "Submitted", className: "resolved-allowed" },
  decline: { label: "Declined", className: "resolved-denied" },
  reject: { label: "Declined", className: "resolved-denied" },
  cancel: { label: "Cancelled", className: "resolved-cancelled" },
  expired: { label: "No longer active", className: "resolved-cancelled" },
};

export function markElicitationCard(container, action) {
  if (!container || container.classList.contains("resolved")) return;
  var state = RESOLVED[action] || RESOLVED.cancel;
  container.classList.remove("submitting");
  container.classList.add("resolved", state.className);
  container.querySelectorAll("input, select, button").forEach(function (control) { control.disabled = true; });
  var actions = container.querySelector(".permission-actions");
  if (actions) actions.innerHTML = '<span class="permission-decision-label">' + state.label + '</span>';
}

// Server-side rejection keeps the form editable; an expired request resolves.
export function showElicitationError(container, message, expired) {
  if (!container || container.classList.contains("resolved")) return;
  if (expired) {
    markElicitationCard(container, "expired");
    return;
  }
  setBusy(container, false);
  showFormError(container, message || "The response was not accepted.");
}
