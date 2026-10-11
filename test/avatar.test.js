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

test("Mate avatars keep custom images and letter marks separate from user pixels", async function () {
  var avatar = await loadModule("lib/public/modules/avatar.js");
  assert.equal(avatar.mateAvatarUrl({ profile: { avatarCustom: "/mate.png", displayName: "Ada" } }, 32), "/mate.png");
  var mate = avatar.mateAvatarUrl({ profile: { displayName: "Ada" } }, 32);
  var bot = avatar.mateAvatarUrl({ id: "mate-a", profile: { displayName: "Ada", avatarStyle: "bottts", avatarSeed: "saved" } }, 32);
  var pixel = avatar.mateAvatarUrl({ id: "mate-a", profile: { displayName: "Ada", avatarStyle: "pixel-art", avatarSeed: "saved" } }, 32);
  assert.notEqual(bot, mate);
  assert.notEqual(bot, pixel);
  assert.doesNotMatch(bot, /https?:|dicebear/i);
  assert.match(bot, /^\/api\/generated-avatar\?style=bottts&seed=saved&size=32$/);
  assert.match(decodeURIComponent(mate), />A<\/text>/);
  assert.doesNotMatch(decodeURIComponent(mate), /viewBox="0 0 5 5"/);
});

test("Mate avatar catalogue exactly restores the seven historical local styles", async function () {
  var avatar = await loadModule("lib/public/modules/avatar.js");
  assert.deepStrictEqual(avatar.MATE_AVATAR_STYLES.map(function (entry) { return entry.id; }), [
    "thumbs", "bottts", "pixel-art", "adventurer", "micah", "fun-emoji", "icons",
  ]);
  var url = avatar.avatarUrl("fun-emoji", "a seed/&?", 40);
  assert.match(url, /^\/api\/generated-avatar\?/);
  assert.match(url, /style=fun-emoji/);
  assert.match(url, /seed=a%20seed%2F%26%3F/);
  assert.doesNotMatch(url, /api\.dicebear\.com/i);
});
