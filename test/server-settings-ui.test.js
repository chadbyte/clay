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
  assert.doesNotMatch(html, /id="ps-model-list"/);
  assert.doesNotMatch(settingsSource, /set_server_default_model|renderModelList\("ss"/);
  assert.doesNotMatch(messageSource, /updateSettingsModels/);
});

test("Mate DM entry points remain available without a personal opt-out", function() {
  var layout = read("lib/public/modules/user-settings-layout.js");
  var account = read("lib/public/modules/user-settings-account.js");
  var profile = read("lib/public/modules/profile.js");
  var app = read("lib/public/app.js");
  var css = read("lib/public/css/mates.css");
  var mention = read("lib/public/modules/mention.js");
  var dm = read("lib/public/modules/app-dm.js");
  var switcher = read("lib/public/modules/project-switcher.js");
  var wizard = read("lib/public/modules/mate-wizard.js");

  assert.match(layout, /section\('us-mates'\)\.remove\(\)/);
  assert.match(app, /projectMateDmsEnabled: true/);
  assert.match(profile, /var matesOn = true/);
  assert.match(account, /var matesOn = true/);
  assert.match(profile, /classList\.toggle\('project-mate-dms-disabled', !matesOn\)/);
  assert.match(css, /body\.project-mate-dms-disabled #icon-strip-hint-mate/);
  assert.doesNotMatch(css, /project-mate-dms-disabled #ask-mate-btn|project-mate-dms-disabled[^\n]*home/);
  assert.doesNotMatch(mention, /matesEnabled|projectMateDmsEnabled/);
  assert.doesNotMatch(dm, /projectMateDmsEnabled/);
  assert.match(switcher, /if \(_mode === 'mate'\)[\s\S]*openMateWorkspace\(entry\.key\)/);
  assert.doesNotMatch(switcher, /isHomeHubVisible/);
  assert.doesNotMatch(wizard, /mates-disabled|project-mate-dms-disabled/);
});
