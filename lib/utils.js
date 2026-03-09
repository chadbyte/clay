/**
 * Shared utility functions.
 */

var fs = require("fs");

/**
 * Encode a cwd path into a filesystem-safe directory/file name.
 * Replaces forward slashes, dots, and underscores with hyphens so that
 * usernames and workspace paths like "jon.doe_42" don't break session/note
 * lookups. This aligns to Claude Code CLI's encoding logic.
 *
 * Example: "/Users/jon.doe_42/my_project" -> "-Users-jon-doe-42-my-project"
 */
function encodeCwd(cwd) {
  return cwd.replace(/[\/\._]/g, "-");
}

/**
 * Legacy encoding (pre-underscore fix). Only slashes and dots were replaced.
 * Used for fallback resolution of on-disk data written before the fix.
 */
function legacyEncodeCwd(cwd) {
  return cwd.replace(/[\/\.]/g, "-");
}

/**
 * Resolve an encoded directory path with legacy fallback.
 * Returns the new-encoding path if it exists (or if neither exists),
 * falls back to the legacy-encoded path if only that one is present.
 */
function resolveEncodedDir(baseDir, cwd) {
  var newEncoded = encodeCwd(cwd);
  var legacyEncoded = legacyEncodeCwd(cwd);
  if (newEncoded === legacyEncoded) return newEncoded;
  var newPath = baseDir + "/" + newEncoded;
  var legacyPath = baseDir + "/" + legacyEncoded;
  try { if (fs.statSync(newPath).isDirectory()) return newEncoded; } catch (e) {}
  try { if (fs.statSync(legacyPath).isDirectory()) return legacyEncoded; } catch (e) {}
  return newEncoded;
}

/**
 * Resolve an encoded file path with legacy fallback.
 * Same logic as resolveEncodedDir but checks for file existence.
 */
function resolveEncodedFile(baseDir, cwd, ext) {
  var newEncoded = encodeCwd(cwd);
  var legacyEncoded = legacyEncodeCwd(cwd);
  if (newEncoded === legacyEncoded) return newEncoded;
  var newPath = baseDir + "/" + newEncoded + (ext || "");
  var legacyPath = baseDir + "/" + legacyEncoded + (ext || "");
  try { if (fs.statSync(newPath).isFile()) return newEncoded; } catch (e) {}
  try { if (fs.statSync(legacyPath).isFile()) return legacyEncoded; } catch (e) {}
  return newEncoded;
}

module.exports = {
  encodeCwd: encodeCwd,
  resolveEncodedDir: resolveEncodedDir,
  resolveEncodedFile: resolveEncodedFile,
};
