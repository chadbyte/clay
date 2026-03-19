var fs = require("fs");
var path = require("path");
var config = require("./config");

var DM_DIR = path.join(config.CONFIG_DIR, "dm");

// Ensure dm directory exists
function ensureDmDir() {
  fs.mkdirSync(DM_DIR, { recursive: true });
  config.chmodSafe(DM_DIR, 0o700);
}

// Generate deterministic DM key from two user IDs (sorted, order-independent)
function dmKey(userId1, userId2) {
  return [userId1, userId2].sort().join(":");
}

// File path for a DM conversation
function dmFilePath(key) {
  // Replace : with _ for safe filename
  return path.join(DM_DIR, key.replace(/:/g, "_") + ".jsonl");
}

// Load DM history from JSONL file
function loadHistory(key) {
  var filePath = dmFilePath(key);
  if (!fs.existsSync(filePath)) return [];
  try {
    var content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return [];
    var lines = content.split("\n");
    var messages = [];
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        messages.push(JSON.parse(lines[i]));
      } catch (e) {
        // skip malformed lines
      }
    }
    return messages;
  } catch (e) {
    return [];
  }
}

// Append a message to DM JSONL file
function appendMessage(key, message) {
  ensureDmDir();
  var filePath = dmFilePath(key);
  var line = JSON.stringify(message) + "\n";
  fs.appendFileSync(filePath, line);
}

// Open a DM conversation (find or create)
function openDm(userId1, userId2) {
  var key = dmKey(userId1, userId2);
  var history = loadHistory(key);
  return { dmKey: key, messages: history };
}

// Send a DM message
function sendMessage(key, fromUserId, text) {
  var message = {
    type: "dm_message",
    ts: Date.now(),
    from: fromUserId,
    text: text,
  };
  appendMessage(key, message);
  return message;
}

// Get list of all DM conversations for a user
// Returns: [{ dmKey, otherUserId, lastMessage, lastTs }]
function getDmList(userId) {
  ensureDmDir();
  var files;
  try {
    files = fs.readdirSync(DM_DIR).filter(function (f) {
      return f.endsWith(".jsonl");
    });
  } catch (e) {
    return [];
  }

  var dms = [];
  for (var i = 0; i < files.length; i++) {
    // Reconstruct dmKey from filename (replace _ back to :)
    var key = files[i].replace(".jsonl", "").replace(/_/g, ":");
    var parts = key.split(":");
    if (parts.length !== 2) continue;

    // Check if this user is a participant
    var idx = parts.indexOf(userId);
    if (idx === -1) continue;

    var otherUserId = parts[idx === 0 ? 1 : 0];

    // Get last message
    var messages = loadHistory(key);
    var lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    dms.push({
      dmKey: key,
      otherUserId: otherUserId,
      lastMessage: lastMessage ? lastMessage.text : null,
      lastTs: lastMessage ? lastMessage.ts : 0,
      messageCount: messages.length,
    });
  }

  // Sort by most recent activity
  dms.sort(function (a, b) {
    return b.lastTs - a.lastTs;
  });

  return dms;
}

// Check if a user is a mate (AI persona)
function isMate(userId) {
  var mates = require("./mates");
  return mates.isMate(userId);
}

module.exports = {
  dmKey: dmKey,
  openDm: openDm,
  sendMessage: sendMessage,
  getDmList: getDmList,
  loadHistory: loadHistory,
  isMate: isMate,
  DM_DIR: DM_DIR,
};
