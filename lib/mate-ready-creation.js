var resolveMateIdentityFile = require('./mate-identity-file').resolveMateIdentityFile;
// Atomic finalization of an interviewed Mate. No placeholder is exposed unless
// the complete identity has passed validation and is ready to register.

var fs = require("fs");
var path = require("path");

function cleanLine(value, maxLength, field) {
  if (typeof value !== "string") throw new Error(field + " is required.");
  var clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error(field + " is required.");
  return clean.slice(0, maxLength);
}

function cleanList(value, maxItems) {
  var source = Array.isArray(value) ? value : [];
  var result = [];
  for (var i = 0; i < source.length && result.length < maxItems; i++) {
    if (typeof source[i] !== "string") continue;
    var clean = source[i].replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    if (clean) result.push(clean);
  }
  return result;
}

function normalize(definition) {
  var identity = typeof definition.identityMarkdown === "string" ? definition.identityMarkdown.replace(/\u0000/g, "").trim() : "";
  if (identity.length < 200) throw new Error("The Mate identity is incomplete.");
  if (identity.length > 30000) throw new Error("The Mate identity is too long.");
  return {
    name: cleanLine(definition.name, 80, "Mate name"),
    bio: cleanLine(definition.bio, 280, "Mate bio"),
    relationship: cleanLine(definition.relationship || "collaborator", 120, "Working relationship"),
    activities: cleanList(definition.activities, 12),
    communicationStyle: cleanList(definition.communicationStyle, 12),
    autonomy: cleanLine(definition.autonomy || "Ask before consequential actions.", 500, "Autonomy"),
    identityMarkdown: identity,
    vendor: cleanLine(definition.vendor || "claude", 40, "Vendor"),
    model: cleanLine(definition.model, 240, "Mate model"),
  };
}

function createReadyMate(mates, mateCtx, definition) {
  var ready = normalize(definition || {});
  if (typeof mates.extractIdentity === "function" && mates.extractIdentity(ready.identityMarkdown).trim() !== ready.identityMarkdown.trim()) {
    throw new Error("The proposed identity contains reserved system sections.");
  }
  var mate = null;
  try {
    mate = mates.createMate(mateCtx, {
      relationship: ready.relationship,
      activity: ready.activities,
      communicationStyle: ready.communicationStyle,
      vendor: ready.vendor,
      model: ready.model,
      autonomy: ready.autonomy,
    });
    var mateDir = mates.getMateDir(mateCtx, mate.id);
    var identityPath = resolveMateIdentityFile(mateDir);
    fs.writeFileSync(identityPath, ready.identityMarkdown + "\n");
    mates.enforceAllSections(identityPath, { ctx: mateCtx, mateId: mate.id });
    fs.mkdirSync(path.join(mateDir, "knowledge"), { recursive: true });
    var yaml = "# Mate metadata\n";
    yaml += "id: " + JSON.stringify(mate.id) + "\n";
    yaml += "name: " + JSON.stringify(ready.name) + "\n";
    yaml += "status: ready\n";
    yaml += "createdBy: " + JSON.stringify(mate.createdBy) + "\n";
    yaml += "createdAt: " + mate.createdAt + "\n";
    yaml += "relationship: " + JSON.stringify(ready.relationship) + "\n";
    yaml += "activities: " + JSON.stringify(ready.activities) + "\n";
    yaml += "communicationStyle: " + JSON.stringify(ready.communicationStyle) + "\n";
    yaml += "autonomy: " + JSON.stringify(ready.autonomy) + "\n";
    yaml += "vendor: " + JSON.stringify(ready.vendor) + "\n";
    yaml += "model: " + JSON.stringify(ready.model) + "\n";
    fs.writeFileSync(path.join(mateDir, "mate.yaml"), yaml);
    var updated = mates.updateMate(mateCtx, mate.id, {
      name: ready.name,
      bio: ready.bio,
      status: "ready",
      vendor: ready.vendor,
      model: ready.model,
      profile: Object.assign({}, mate.profile || {}, { displayName: ready.name, bio: ready.bio }),
      seedData: Object.assign({}, mate.seedData || {}, { relationship: ready.relationship, activity: ready.activities, communicationStyle: ready.communicationStyle, autonomy: ready.autonomy }),
    });
    mates.backupIdentity(mateDir, ready.identityMarkdown);
    mates.logIdentityChange(mateDir, "clay_interview", ready.identityMarkdown, "");
    return updated;
  } catch (error) {
    if (mate && mate.id) {
      try { mates.deleteMate(mateCtx, mate.id); } catch (cleanupError) {}
    }
    throw error;
  }
}

module.exports = { createReadyMate: createReadyMate, normalize: normalize };
