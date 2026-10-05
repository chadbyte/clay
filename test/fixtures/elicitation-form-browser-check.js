// Browser smoke check for the elicitation form. Drives real clicks, typing,
// selects and checkboxes through agent-browser against the static fixture.
// Usage (Node 22): node test/fixtures/elicitation-form-browser-check.js [screenshotDir]
var assert = require("node:assert/strict");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var sessionName = "clay-elicitation-check-" + process.pid;
var outputDir = process.argv[2] || path.join(os.tmpdir(), "clay-elicitation-form-browser");
var server = null;

function browser(args, capture) {
  var output = childProcess.execFileSync("npx", ["--no-install", "agent-browser", "--session", sessionName].concat(args), {
    cwd: path.join(__dirname, "../.."),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "ignore", "inherit"],
  });
  return typeof output === "string" ? output.trim() : "";
}

function evaluate(expression) {
  var value = JSON.parse(browser(["eval", expression], true));
  if (typeof value === "string" && (/^[\[{]/).test(value)) return JSON.parse(value);
  return value;
}

function field(name, control) {
  return "#card-form-a [data-prop-name=\"" + name + "\"] " + (control || "input");
}

function cardState(id) {
  return evaluate("JSON.stringify((function(){var c=document.getElementById('card-" + id + "');return {resolved:c.classList.contains('resolved'),submitting:c.classList.contains('submitting'),label:(c.querySelector('.permission-decision-label')||{}).textContent||null,summary:c.querySelector('.elicitation-form-error').textContent,submitDisabled:!!(c.querySelector('.elicitation-submit')||{}).disabled,errors:Array.from(c.querySelectorAll('.elicitation-field-error')).filter(function(e){return e.textContent;}).map(function(e){return e.parentNode.dataset.propName+': '+e.textContent;})};})())");
}

function sent() {
  return evaluate("JSON.stringify(window.sentMessages)");
}

function waitForServer(child) {
  return new Promise(function (resolve, reject) {
    var buffer = "";
    child.stdout.on("data", function onData(chunk) {
      buffer += chunk.toString();
      var match = buffer.match(/ELICITATION_FORM_URL=(\S+)/);
      if (!match) return;
      child.stdout.off("data", onData);
      resolve(match[1]);
    });
    child.once("error", reject);
    child.once("exit", function (code) { if (code) reject(new Error("Fixture server exited with " + code)); });
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  server = childProcess.spawn(process.execPath, [path.join(__dirname, "elicitation-form-browser-server.js")], { stdio: ["ignore", "pipe", "inherit"] });
  var url = await waitForServer(server);
  browser(["set", "viewport", "900", "1400"], false);
  browser(["open", url], false);
  browser(["wait", "#card-form-d"], false);
  assert.equal(evaluate("window.fixture && window.fixture.ready === true"), true);
  assert.equal(evaluate("document.querySelectorAll('#card-form-a .elicitation-field').length"), 12, "forms with more than three properties render every field");
  assert.match(evaluate("document.querySelector('#card-form-a [data-prop-name=\"code\"]').textContent"), /Expected pattern \(checked by the agent\)/);

  // Empty submit: required presence and constraints block sending; the form stays editable.
  browser(["click", "#card-form-a .elicitation-submit"], false);
  var empty = cardState("form-a");
  assert.equal(empty.resolved, false);
  assert.equal(empty.submitting, false);
  assert.equal(empty.label, null, "an invalid form never claims Submitted");
  assert.match(empty.summary, /Fix the highlighted fields/);
  assert.deepEqual(empty.errors.sort(), ["colors: Choose at least 1.", "mode: A value is required.", "name: Must be at least 1 characters."]);
  assert.deepEqual(sent(), []);

  browser(["fill", field("name"), "Bad-Name"], false);
  browser(["click", "#card-form-a .elicitation-submit"], false);
  assert.ok(cardState("form-a").errors.indexOf("name: Does not match the required format.") !== -1);
  browser(["fill", field("count"), "11"], false);
  browser(["click", "#card-form-a .elicitation-submit"], false);
  assert.ok(cardState("form-a").errors.indexOf("count: Must be at most 10.") !== -1);

  // Valid submit: explicit false/0 are sent; untouched optional text, number,
  // multi-select and hint-only fields (note, limit, tags, code) are absent.
  browser(["fill", field("name"), "ok_name"], false);
  browser(["fill", field("count"), "0"], false);
  browser(["select", field("enabled", "select"), "1"], false);
  browser(["select", field("mode", "select"), "1"], false);
  browser(["check", field("colors", "input[value=\"0\"]")], false);
  browser(["click", "#card-form-a .elicitation-submit"], false);
  var submitted = sent();
  assert.deepEqual(submitted, [{ type: "elicitation_response", requestId: "form-a", action: "accept", content: {
    name: "ok_name", enabled: false, confirm: false, count: 0, ratio: 0.5, mode: "fast", strategy: "safe", colors: ["#f00"],
  } }]);
  var pending = cardState("form-a");
  assert.equal(pending.submitting, true);
  assert.equal(pending.submitDisabled, true);
  assert.equal(pending.label, null, "the card waits for server confirmation");

  // Server rejection reopens the form with a visible error.
  evaluate("window.fixture.error('form-a', 'Invalid elicitation answer for count: Must be at most 10.'); true");
  var reopened = cardState("form-a");
  assert.equal(reopened.submitting, false);
  assert.equal(reopened.submitDisabled, false);
  assert.match(reopened.summary, /Must be at most 10/);
  browser(["click", "#card-form-a .elicitation-submit"], false);
  assert.equal(sent().length, 2);
  evaluate("window.fixture.resolve('form-a', 'accept'); true");
  assert.equal(cardState("form-a").label, "Submitted");
  assert.equal(evaluate("document.querySelector('#card-form-a input[name=\"name\"]').disabled"), true);

  browser(["click", "#card-form-b .elicitation-decline"], false);
  browser(["click", "#card-form-c .elicitation-cancel"], false);
  var actions = sent().slice(2).map(function (message) { return message.requestId + ":" + message.action; });
  assert.deepEqual(actions, ["form-b:decline", "form-c:cancel"]);
  evaluate("window.fixture.resolve('form-b', 'decline'); window.fixture.resolve('form-c', 'cancel'); window.fixture.error('form-d', 'This request is no longer active.', true); true");
  assert.equal(cardState("form-b").label, "Declined");
  assert.equal(cardState("form-c").label, "Cancelled");
  assert.equal(cardState("form-d").label, "No longer active");
  assert.deepEqual(evaluate("JSON.stringify(window.fixtureErrors)"), []);

  var screenshot = path.join(outputDir, "elicitation-form.png");
  browser(["screenshot", screenshot], false);
  assert.ok(fs.statSync(screenshot).size > 0);
  process.stdout.write("ELICITATION_FORM_BROWSER_CHECK=pass screenshot=" + screenshot + "\n");
}

main().catch(function (error) {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
}).finally(function () {
  try { browser(["close"], false); } catch (e) {}
  if (server) server.kill();
});
