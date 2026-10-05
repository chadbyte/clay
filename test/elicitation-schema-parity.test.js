var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var server = require("../lib/yoke/elicitation-schema");
var userInput = require("../lib/yoke/user-input");

function loadClient() {
  return import(pathToFileURL(path.join(__dirname, "../lib/public/modules/elicitation-schema.js")).href);
}

var COLORS = { type: "array", items: { anyOf: [{ const: "#f00", title: "Red" }, { const: "#0f0", title: "Green" }] }, minItems: 1, maxItems: 2 };
var TAGS = { type: "array", items: { type: "string", enum: ["a", "b", "c"] } };
var STRATEGY = { type: "string", oneOf: [{ const: "fast", title: "Fast" }, { const: "safe", title: "Safe" }] };
var NAME = { type: "string", minLength: 1, maxLength: 8, pattern: "^[a-z_][a-z0-9_]*$" };
var COUNT = { type: "integer", minimum: 0, maximum: 10 };
var RATIO = { type: "number", minimum: 0.5 };

// [description, property, typed value, expected valid]
var CASES = [
  ["anyOf multi-select accepts listed values", COLORS, ["#f00", "#0f0"], true],
  ["anyOf multi-select rejects unlisted values", COLORS, ["not-a-choice"], false],
  ["anyOf multi-select enforces minItems", COLORS, [], false],
  ["anyOf multi-select rejects duplicates", COLORS, ["#f00", "#f00"], false],
  ["enum multi-select accepts empty without minItems", TAGS, [], true],
  ["enum multi-select enforces maxItems when present", Object.assign({ maxItems: 1 }, TAGS), ["a", "b"], false],
  ["oneOf single-select accepts a const", STRATEGY, "safe", true],
  ["oneOf single-select rejects a title", STRATEGY, "Safe", false],
  ["plain enum rejects unlisted value", { type: "string", enum: ["x", "y"] }, "z", false],
  ["string without minLength accepts empty text", { type: "string" }, "", true],
  ["minLength rejects empty text", NAME, "", false],
  ["maxLength counts code points", { type: "string", maxLength: 2 }, "😀😀", true],
  ["bounded pattern is enforced", NAME, "Bad-Name", false],
  ["bounded pattern accepts a match", NAME, "ok_name", true],
  ["unbounded pattern stays an unenforced hint", { type: "string", pattern: "^(a+)+$" }, "aaaa!", true],
  ["integer rejects fractions", COUNT, 1.5, false],
  ["integer enforces maximum", COUNT, 11, false],
  ["integer accepts zero", COUNT, 0, true],
  ["number enforces minimum", RATIO, 0.25, false],
  ["boolean accepts explicit false", { type: "boolean" }, false, true],
  ["boolean rejects strings in typed content", { type: "boolean" }, "false", false],
  ["unknown types are not validated as a known control", { type: "_custom" }, { any: true }, true],
];

test("server and browser validators agree on the supported elicitation schema subset", async function () {
  var client = await loadClient();
  CASES.forEach(function (row) {
    var serverError = server.valueError(row[2], row[1]);
    var clientError = client.valueError(row[2], row[1]);
    assert.equal(serverError, clientError, row[0] + ": server and browser messages differ");
    assert.equal(serverError === null, row[3], row[0]);
  });
});

test("required means presence on both sides, and omitted optional fields stay omitted", async function () {
  var client = await loadClient();
  var schema = { type: "object", required: ["note", "enabled"], properties: { note: { type: "string" }, enabled: { type: "boolean" }, count: COUNT } };
  assert.deepEqual(client.validateForm({ note: "", enabled: false }, schema).errors, {});
  assert.deepEqual(server.validateContent({ note: "", enabled: false }, schema), { note: "", enabled: false });
  assert.deepEqual(Object.keys(client.validateForm({ enabled: true }, schema).errors), ["note"]);
  assert.throws(function () { server.validateContent({ enabled: true }, schema); }, /required for note/);
  assert.equal(Object.prototype.hasOwnProperty.call(server.validateContent({ note: "x", enabled: true }, schema), "count"), false);
});

test("bounded pattern classifier is identical on both sides and rejects costly constructs", async function () {
  var client = await loadClient();
  var patterns = [
    ["^[a-zA-Z_][a-zA-Z0-9_]*$", true],
    ["^[^@]+@[^@]+$", true],
    ["^\\d{3}-\\d{4}$", true],
    ["^(?:ab|cd)x*$", true],
    ["^(a+)+$", false],
    ["^(ab)*$", false],
    ["(a)\\1", false],
    ["^(?=a)a$", false],
    ["^a*b*c*$", false],
    ["^a{1,}b{2,5}c+$", false],
    ["[unclosed", false],
    ["x".repeat(201), false],
  ];
  patterns.forEach(function (row) {
    assert.equal(server.patternIsBounded(row[0]), row[1], row[0]);
    assert.equal(client.patternIsBounded(row[0]), row[1], row[0]);
  });
  var long = "a".repeat(server.PATTERN_MAX_INPUT_LENGTH + 1);
  assert.equal(server.patternMatches("^b*$", long), null);
  assert.equal(client.patternMatches("^b*$", long), null);
});

test("form elicitations are not subject to structured question limits", function () {
  var properties = {};
  var longName = "property_" + "x".repeat(150);
  properties[longName] = { type: "string", description: "d".repeat(2500) };
  ["b", "c", "d", "e"].forEach(function (key) { properties[key] = { type: "string" }; });
  var schema = { type: "object", properties: properties, required: [longName] };
  var questions = server.questionsFromSchema({ serverName: "Agent", requestedSchema: schema });
  assert.equal(questions.length, 5);
  assert.equal(questions[0].id, longName);
  assert.ok(questions[0].question.length <= 2000);
  assert.throws(function () { userInput.normalizeQuestions({ questions: questions }); }, /1-3 questions/, "genuine question tools keep their limit");
  var content = { b: "1", c: "2", d: "3", e: "4" };
  content[longName] = "value";
  return userInput.dispatchElicitation(function (request, respond) {
    assert.equal(request.presentation, "elicitation");
    assert.equal(request.questions.length, 5);
    respond.submitContent(content);
  }, { serverName: "Agent", requestedSchema: schema }, {}).then(function (result) {
    assert.deepEqual(userInput.elicitationResponse(result, schema), { action: "accept", content: content });
  });
});

test("decline and cancel stay distinct in provider responses", function () {
  return userInput.dispatchElicitation(function (request, respond) {
    assert.equal(respond.decline("No"), true);
    assert.equal(respond.cancel("Late"), false);
  }, { requestedSchema: { type: "object", properties: {} } }, {}).then(function (declined) {
    assert.deepEqual(userInput.elicitationResponse(declined), { action: "decline" });
    assert.deepEqual(userInput.elicitationResponse({ status: "cancelled" }), { action: "cancel" });
  });
});
