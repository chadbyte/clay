// Restricted elicitation schema handling for the browser form.
// Mirrors lib/yoke/elicitation-schema.js; keep both in sync
// (test/elicitation-schema-parity.test.js runs one fixture table on both).

var PATTERN_MAX_LENGTH = 200;
var PATTERN_MAX_VARIABLE_QUANTIFIERS = 2;
var PATTERN_MAX_INPUT_LENGTH = 256;

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function constChoices(list) {
  if (!Array.isArray(list)) return null;
  var values = [];
  for (var i = 0; i < list.length; i++) {
    if (!hasOwn(list[i], "const")) return null;
    values.push({ value: list[i].const, label: String(list[i].title || list[i].const), description: list[i].description || "" });
  }
  return values.length ? values : null;
}

function enumChoices(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.map(function (value) { return { value: value, label: String(value), description: "" }; });
}

export function fieldInfo(property) {
  property = property || {};
  var type = property.type || (Array.isArray(property.enum) || Array.isArray(property.oneOf) ? "string" : null);
  if (type === "array") {
    var items = property.items || {};
    var itemType = items.type || "string";
    var itemChoices = itemType === "string" ? (enumChoices(items.enum) || constChoices(items.anyOf)) : null;
    return itemChoices ? { kind: "array", multi: true, choices: itemChoices } : { kind: "unsupported", multi: false, choices: null };
  }
  if (type === "string") return { kind: "string", multi: false, choices: enumChoices(property.enum) || constChoices(property.oneOf) };
  if (type === "number" || type === "integer" || type === "boolean") return { kind: type, multi: false, choices: null };
  return { kind: "unsupported", multi: false, choices: null };
}

// Agent-supplied patterns are evaluated only inside a subset whose backtracking
// cost is bounded; anything else stays a visible, unenforced hint.
export function patternIsBounded(pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.length > PATTERN_MAX_LENGTH) return false;
  var variable = 0;
  var inClass = false;
  for (var i = 0; i < pattern.length; i++) {
    var ch = pattern[i];
    if (ch === "\\") {
      var next = pattern[i + 1];
      if (next === undefined || /[1-9k]/.test(next)) return false;
      i++;
      continue;
    }
    if (inClass) { if (ch === "]") inClass = false; continue; }
    if (ch === "[") { inClass = true; continue; }
    if (ch === "(" && pattern[i + 1] === "?") {
      if (pattern[i + 2] !== ":") return false;
      i += 2;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "?" || ch === "{") {
      if (pattern[i - 1] === ")") return false;
      if (ch === "{") {
        var close = pattern.indexOf("}", i);
        if (close === -1) return false;
        var body = pattern.slice(i + 1, close);
        if (!/^\d+(,\d*)?$/.test(body)) return false;
        if (body.indexOf(",") !== -1) variable++;
        i = close;
      } else {
        variable++;
      }
      if (pattern[i + 1] === "?") i++;
    }
  }
  if (inClass || variable > PATTERN_MAX_VARIABLE_QUANTIFIERS) return false;
  try { new RegExp(pattern, "u"); } catch (e) { return false; }
  return true;
}

export function patternMatches(pattern, value) {
  if (!patternIsBounded(pattern) || value.length > PATTERN_MAX_INPUT_LENGTH) return null;
  return new RegExp(pattern, "u").test(value);
}

function inChoices(choices, value) {
  return choices.some(function (choice) { return choice.value === value; });
}

// Returns an error message or null. `value` must already be typed.
export function valueError(value, property) {
  property = property || {};
  var info = fieldInfo(property);
  if (info.kind === "unsupported") return null;
  if (info.kind === "boolean") return typeof value === "boolean" ? null : "Choose yes or no.";
  if (info.kind === "number" || info.kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
    if (info.kind === "integer" && !Number.isInteger(value)) return "Enter a whole number.";
    if (typeof property.minimum === "number" && value < property.minimum) return "Must be at least " + property.minimum + ".";
    if (typeof property.maximum === "number" && value > property.maximum) return "Must be at most " + property.maximum + ".";
    return null;
  }
  if (info.kind === "array") {
    if (!Array.isArray(value)) return "Choose from the listed options.";
    for (var i = 0; i < value.length; i++) {
      if (!inChoices(info.choices, value[i])) return "Choose only listed options.";
      if (value.indexOf(value[i]) !== i) return "Choose each option once.";
    }
    if (typeof property.minItems === "number" && value.length < property.minItems) return "Choose at least " + property.minItems + ".";
    if (typeof property.maxItems === "number" && value.length > property.maxItems) return "Choose at most " + property.maxItems + ".";
    return null;
  }
  if (typeof value !== "string") return "Enter text.";
  if (info.choices) return inChoices(info.choices, value) ? null : "Choose one of the listed options.";
  var length = Array.from(value).length;
  if (typeof property.minLength === "number" && length < property.minLength) return "Must be at least " + property.minLength + " characters.";
  if (typeof property.maxLength === "number" && length > property.maxLength) return "Must be at most " + property.maxLength + " characters.";
  if (patternMatches(property.pattern, value) === false) return "Does not match the required format.";
  return null;
}

// Required means presence only. Returns { content, errors } where errors maps
// property name to message; content holds only present properties.
export function validateForm(content, schema) {
  var properties = schema && schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  var required = schema && Array.isArray(schema.required) ? schema.required : [];
  var errors = {};
  Object.keys(properties).forEach(function (id) {
    if (!hasOwn(content, id)) {
      if (required.indexOf(id) !== -1) errors[id] = fieldInfo(properties[id]).kind === "unsupported" ? "This field type is not supported here." : "A value is required.";
      return;
    }
    var error = valueError(content[id], properties[id]);
    if (error) errors[id] = error;
  });
  return { content: content, errors: errors };
}
