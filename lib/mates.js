var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");

var MATES_FILE = path.join(config.CONFIG_DIR, "mates.json");
var MATES_DIR = path.join(process.cwd(), ".claude", "mates");

// --- Default data ---

function defaultData() {
  return { mates: [] };
}

// --- Load / Save ---

function loadMates() {
  try {
    var raw = fs.readFileSync(MATES_FILE, "utf8");
    var data = JSON.parse(raw);
    if (!data.mates) data.mates = [];
    return data;
  } catch (e) {
    return defaultData();
  }
}

function saveMates(data) {
  fs.mkdirSync(path.dirname(MATES_FILE), { recursive: true });
  var tmpPath = MATES_FILE + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, MATES_FILE);
}

// --- CRUD ---

function generateMateId() {
  return "mate_" + crypto.randomUUID();
}

function createMate(seedData, userId) {
  var data = loadMates();
  var id = generateMateId();

  // Pick a random avatar color from a pleasant palette
  var colors = ["#6c5ce7", "#00b894", "#e17055", "#0984e3", "#fdcb6e", "#e84393", "#00cec9", "#ff7675"];
  var colorIdx = crypto.randomBytes(1)[0] % colors.length;

  var mate = {
    id: id,
    name: null,
    createdBy: userId,
    createdAt: Date.now(),
    seedData: seedData || {},
    profile: {
      displayName: null,
      avatarColor: colors[colorIdx],
      avatarStyle: "bottts",
      avatarSeed: crypto.randomBytes(4).toString("hex"),
    },
    status: "interviewing",
    interviewProjectPath: null,
  };

  data.mates.push(mate);
  saveMates(data);

  // Create the mate's identity directory
  var mateDir = path.join(MATES_DIR, id);
  fs.mkdirSync(mateDir, { recursive: true });

  // Write initial mate.yaml
  var yaml = "# Mate metadata\n";
  yaml += "id: " + id + "\n";
  yaml += "name: null\n";
  yaml += "status: interviewing\n";
  yaml += "createdBy: " + userId + "\n";
  yaml += "createdAt: " + mate.createdAt + "\n";
  yaml += "relationship: " + (seedData.relationship || "assistant") + "\n";
  yaml += "activities: " + JSON.stringify(seedData.activity || []) + "\n";
  yaml += "autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);

  // Write initial CLAUDE.md (will be replaced by interview)
  var claudeMd = "# Mate Identity\n\n";
  claudeMd += "This mate is currently being interviewed. Identity will be generated after the interview.\n\n";
  claudeMd += "## Seed Data\n\n";
  claudeMd += "- Relationship: " + (seedData.relationship || "assistant") + "\n";
  if (seedData.activity && seedData.activity.length > 0) {
    claudeMd += "- Activities: " + seedData.activity.join(", ") + "\n";
  }
  if (seedData.communicationStyle) {
    claudeMd += "- Directness: " + (seedData.communicationStyle.directness || 0.5) + "\n";
    claudeMd += "- Detail level: " + (seedData.communicationStyle.detail || 0.5) + "\n";
  }
  claudeMd += "- Autonomy: " + (seedData.autonomy || "always_ask") + "\n";
  fs.writeFileSync(path.join(mateDir, "CLAUDE.md"), claudeMd);

  return mate;
}

function getMate(id) {
  var data = loadMates();
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) return data.mates[i];
  }
  return null;
}

function updateMate(id, updates) {
  var data = loadMates();
  for (var i = 0; i < data.mates.length; i++) {
    if (data.mates[i].id === id) {
      var keys = Object.keys(updates);
      for (var j = 0; j < keys.length; j++) {
        data.mates[i][keys[j]] = updates[keys[j]];
      }
      saveMates(data);
      return data.mates[i];
    }
  }
  return null;
}

function deleteMate(id) {
  var data = loadMates();
  var before = data.mates.length;
  data.mates = data.mates.filter(function (m) {
    return m.id !== id;
  });
  if (data.mates.length === before) return { error: "Mate not found" };
  saveMates(data);

  // Remove mate directory
  var mateDir = path.join(MATES_DIR, id);
  try {
    fs.rmSync(mateDir, { recursive: true, force: true });
  } catch (e) {
    // Directory may not exist
  }

  return { ok: true };
}

function getAllMates() {
  var data = loadMates();
  return data.mates;
}

function getMatesByUser(userId) {
  var data = loadMates();
  return data.mates.filter(function (m) {
    return m.createdBy === userId;
  });
}

function isMate(id) {
  if (!id) return false;
  if (typeof id === "string" && id.indexOf("mate_") === 0) {
    // Double check it exists in registry
    return !!getMate(id);
  }
  return false;
}

// Format seed data as a human-readable context string
function formatSeedContext(seedData) {
  if (!seedData) return "";
  var parts = [];

  if (seedData.relationship) {
    parts.push("The user wants a " + seedData.relationship + " relationship.");
  }

  if (seedData.activity && seedData.activity.length > 0) {
    parts.push("Primary activities: " + seedData.activity.join(", ") + ".");
  }

  if (seedData.communicationStyle) {
    var d = seedData.communicationStyle.directness;
    var det = seedData.communicationStyle.detail;
    var directLabel = d >= 0.7 ? "direct" : d <= 0.3 ? "soft and gentle" : "balanced";
    var detailLabel = det >= 0.7 ? "detailed" : det <= 0.3 ? "concise" : "moderate detail";
    parts.push("Communication style: " + directLabel + ", " + detailLabel + ".");
  }

  if (seedData.autonomy) {
    var autonomyLabels = {
      always_ask: "Always ask before acting",
      minor_stuff_ok: "Handle minor stuff without asking",
      mostly_autonomous: "Mostly autonomous, ask for big decisions",
      fully_autonomous: "Fully autonomous",
    };
    parts.push("Autonomy: " + (autonomyLabels[seedData.autonomy] || seedData.autonomy) + ".");
  }

  return parts.join(" ");
}

module.exports = {
  MATES_FILE: MATES_FILE,
  MATES_DIR: MATES_DIR,
  loadMates: loadMates,
  saveMates: saveMates,
  createMate: createMate,
  getMate: getMate,
  updateMate: updateMate,
  deleteMate: deleteMate,
  getAllMates: getAllMates,
  getMatesByUser: getMatesByUser,
  isMate: isMate,
  formatSeedContext: formatSeedContext,
};
