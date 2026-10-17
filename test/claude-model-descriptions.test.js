var test = require("node:test");
var assert = require("node:assert/strict");
var descriptions = require("../lib/yoke/providers/claude-model-descriptions");

test("runtime descriptions win and missing ones use official family wording", function () {
  var rows = descriptions.list([
    { value: "claude-opus-5-5", displayName: "Opus 5.5", description: "Runtime text" },
    { value: "claude-fable-5-1", displayName: "Fable 5.1" },
    { value: "opus", displayName: "Opus" },
    "custom-model",
  ]);
  assert.equal(rows[0].description, "Runtime text");
  assert.match(rows[1].description, /demanding reasoning and long-horizon agentic work/);
  assert.match(rows[2].description, /long-running agentic coding/);
  assert.equal(rows[3].description, undefined, "custom models are not given an invented description");
  assert.equal(rows[3].value, "custom-model");
});

test("the 1M context beta toggle is withheld only from models documented as 1M by default", function () {
  function beta(entry) { return descriptions.describe(entry).supportsBetaContext; }
  assert.equal(beta({ value: "claude-sonnet-5-5" }), false);
  assert.equal(beta({ value: "claude-sonnet-5" }), false);
  assert.equal(beta({ value: "claude-sonnet-4-6" }), true, "Claude Code keeps Sonnet 4.6 1M as an opt-in");
  assert.equal(beta({ value: "sonnet", resolvedModel: "claude-sonnet-5-5" }), false, "an alias row is judged by its resolved model");
  assert.equal(beta({ value: "sonnet" }), true, "an unresolved alias keeps the existing behaviour");
  assert.equal(beta({ value: "claude-sonnet-4-5-20250929" }), true);
  assert.equal(beta({ value: "claude-opus-5-5" }), false);
  assert.equal(beta({ value: "claude-sonnet-5-7" }), true, "undocumented future versions are not assumed to be 1M by default");
  assert.equal(beta({ value: "claude-sonnet-5-5[1m]" }), false);
  assert.equal(beta({ value: "claude-sonnet-5-5", supportsBetaContext: true }), true, "an explicit runtime value is preserved");
});
