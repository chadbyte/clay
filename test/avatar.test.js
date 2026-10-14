var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

function loadModule(relativePath) {
  var source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  if (relativePath.indexOf("avatar.js") !== -1) {
    var imprintSource = fs.readFileSync(path.join(__dirname, "..", "lib/public/modules/avatar-imprint.js"), "utf8");
    var imprintUrl = "data:text/javascript;base64," + Buffer.from(imprintSource).toString("base64");
    source = source.replace("'./avatar-imprint.js'", "'" + imprintUrl + "'");
  }
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("user avatars prefer custom images, then saved seeds, then stable account ids", async function () {
  var avatar = await loadModule("lib/public/modules/avatar.js");
  var custom = avatar.userAvatarUrl({ avatarCustom: "/avatar.png", avatarSeed: "saved", id: "user-1" }, 32);
  var saved = avatar.userAvatarUrl({ avatarSeed: "saved", username: "name", id: "user-1" }, 32);
  var username = avatar.userAvatarUrl({ username: "name", id: "user-1" }, 32);
  var id = avatar.userAvatarUrl({ id: "user-1" }, 32);
  assert.equal(custom, "/avatar.png");
  assert.equal(saved, avatar.userAvatarUrl({ avatarSeed: "saved", username: "other", id: "other" }, 32));
  assert.notEqual(saved, avatar.userAvatarUrl({ avatarSeed: "other", id: "user-1" }, 32));
  assert.equal(username, avatar.userAvatarUrl({ username: "name", id: "other" }, 32));
  assert.equal(id, avatar.userAvatarUrl({ id: "user-1" }, 32));
  assert.notEqual(username, id);
  assert.equal(avatar.userAvatarSeed({ id: "123456789012345678901234567890123456" }), "123456789012345678901234567890");
  assert.equal(
    avatar.userAvatarSeed({ userId: "123456789012345678901234567890123456" }),
    avatar.userAvatarSeed({ id: "123456789012345678901234567890123456" })
  );
  assert.equal(
    avatar.userAvatarUrl({ userId: "123456789012345678901234567890123456" }, 32),
    avatar.userAvatarUrl({ id: "123456789012345678901234567890123456" }, 32)
  );
  assert.equal(avatar.userAvatarSeed({ username: "stable-name", id: "different-id" }), "stable-name");
  assert.equal(avatar.userAvatarSeed({ avatarSeed: "saved-seed", id: "different-id" }), "saved-seed");
  assert.equal(avatar.userAvatarSeed({ avatarSeed: "saved-seed", userId: "different-id" }), "saved-seed");
});

test("Mate rendering maps legacy/default identities into the catalog without old style APIs", async function () {
  var avatar = await loadModule("lib/public/modules/avatar.js");
  var migration = require('../lib/mate-avatar-migration');
  assert.equal(avatar.MATE_AVATAR_STYLES, undefined);
  assert.equal(avatar.mateStyleAvatarUrl, undefined);
  ['thumbs','bottts','pixel-art','adventurer','micah','fun-emoji','icons','imprint','initial'].forEach(function(style){
    var mate={id:'mate-legacy',profile:{avatarStyle:style,avatarSeed:'saved-seed'}};
    assert.equal(avatar.mateAvatarUrl(mate,32),'/mate-avatars/'+migration.mappedId(mate)+'.png?v=4');
  });
  assert.match(avatar.mateAvatarUrl({id:'mate-default'},32),/^\/mate-avatars\/[BC]\d{2}\.png\?v=4$/);
  assert.equal(avatar.mateAvatarUrl({builtinKey:'clay'},32),'/mate-avatars/lead-clay.png?v=4');
  assert.equal(avatar.mateAvatarUrl({profile:{avatarCustom:'/custom.png'}},32),'/custom.png');
});

test("ordinary user pixel identities remain unchanged for all historical style names", async function () {
  var avatar=await loadModule("lib/public/modules/avatar.js");
  var imprint=await loadModule("lib/public/modules/avatar-imprint.js");
  ['thumbs','bottts','pixel-art','adventurer','micah','fun-emoji','icons'].forEach(function(style){
    var expected=imprint.imprintDataUrl({style:style,seed:'existing-user',size:32});
    assert.equal(avatar.userAvatarUrl({avatarStyle:style,avatarSeed:'existing-user'},32),expected);
    assert.equal(avatar.userAvatarUrl({avatarStyle:style,avatarSeed:'existing-user',avatarCustom:'/custom.png'},32),'/custom.png');
  });
});

test('every stable catalog ID renders locally, custom uploads win and invalid paths cannot enter catalog URLs', async function () {
  var avatar = await loadModule('lib/public/modules/avatar.js');
  var catalog = require('../lib/public/mate-avatars/catalog.json');
  catalog.forEach(function (entry) {
    assert.equal(avatar.mateAvatarUrl({profile:{avatarCatalogId:entry.id}},24),'/mate-avatars/'+entry.id+'.png?v=4');
  });
  assert.equal(avatar.mateAvatarUrl({profile:{avatarCatalogId:'B01',avatarCustom:'/custom.png'}},24),'/custom.png');
  ['B49','C00','../secret','B01.png'].forEach(function(id){assert.equal(avatar.mateCatalogAvatarUrl(id),'');});
});
