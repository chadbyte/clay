var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("global settings omit vendor-specific model defaults", function() {
  var html = read("lib/public/index.html");
  var settingsSource = read("lib/public/modules/server-settings.js");
  var messageSource = read("lib/public/modules/app-messages.js");

  assert.doesNotMatch(html, /data-section="models"/);
  assert.doesNotMatch(html, /id="ss-(?:model|mode|effort|thinking|beta)/);
  assert.match(html, /id="ps-model-list"/);
  assert.doesNotMatch(settingsSource, /set_server_default_model|renderModelList\("ss"/);
  assert.doesNotMatch(messageSource, /updateSettingsModels/);
});

test("Mate preference controls only project DM entry points", function() {
  var html = read("lib/public/index.html");
  var settings = read("lib/public/modules/user-settings.js");
  var profile = read("lib/public/modules/profile.js");
  var app = read("lib/public/app.js");
  var css = read("lib/public/css/mates.css");
  var mention = read("lib/public/modules/mention.js");
  var dm = read("lib/public/modules/app-dm.js");
  var switcher = read("lib/public/modules/project-switcher.js");
  var wizard = read("lib/public/modules/mate-wizard.js");

  assert.match(html, /Mate DMs in projects/);
  assert.match(html, /Debates, mentions, and Mate memory stay available/);
  assert.doesNotMatch(html, /Use Mates|hides every Mates surface/);
  assert.match(app, /projectMateDmsEnabled: false/);
  assert.match(settings, /store\.set\(\{ projectMateDmsEnabled: want \}\)/);
  assert.match(profile, /classList\.toggle\('project-mate-dms-disabled', !matesOn\)/);
  assert.match(css, /body\.project-mate-dms-disabled #icon-strip-hint-mate/);
  assert.doesNotMatch(css, /project-mate-dms-disabled #ask-mate-btn|project-mate-dms-disabled[^\n]*home/);
  assert.doesNotMatch(mention, /matesEnabled|projectMateDmsEnabled/);
  assert.match(dm, /isMateTarget\)[\s\S]*projectMateDmsEnabled[\s\S]*showHomeHub\(\)/);
  assert.match(switcher, /if \(_mode === 'mate'\)[\s\S]*openMateWorkspace\(entry\.key\)/);
  assert.doesNotMatch(switcher, /isHomeHubVisible/);
  assert.doesNotMatch(wizard, /mates-disabled|project-mate-dms-disabled/);
});
