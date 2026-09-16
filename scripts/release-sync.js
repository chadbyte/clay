#!/usr/bin/env node

var fs = require("fs");
var { execFileSync } = require("child_process");

var ALLOWED_METADATA_CONFLICTS = ["CHANGELOG.md", "package.json", "package-lock.json"];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitMayFail(args) {
  try {
    return { status: 0, stdout: git(args) };
  } catch (err) {
    return { status: typeof err.status === "number" ? err.status : 1, stdout: err.stdout ? String(err.stdout) : "", stderr: err.stderr ? String(err.stderr) : "" };
  }
}

function readGitFile(ref, file) {
  return git(["show", ref + ":" + file]);
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function assertClean() {
  if (git(["status", "--porcelain"]).trim()) throw new Error("release sync requires a clean worktree");
}

function mergeHeadExists() {
  return gitMayFail(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status === 0;
}

function conflictedFiles() {
  var output = git(["diff", "--name-only", "--diff-filter=U"]);
  return output.split("\n").filter(function (file) { return file; });
}

function abortMerge(message) {
  if (mergeHeadExists()) gitMayFail(["merge", "--abort"]);
  throw new Error(message);
}

function readSourceMetadata(source) {
  var packageText = readGitFile(source, "package.json");
  var lockText = readGitFile(source, "package-lock.json");
  var changelogText = readGitFile(source, "CHANGELOG.md");
  var packageJson = JSON.parse(packageText);
  var lock = JSON.parse(lockText);
  if (typeof packageJson.version !== "string" || !packageJson.version) throw new Error("source package has no version");
  if (!lock.packages || !lock.packages[""]) throw new Error("source lockfile has no root package entry");
  return { packageText: packageText, lockText: lockText, changelogText: changelogText, packageJson: packageJson, lock: lock };
}

function mergeSource(source) {
  var result = gitMayFail(["merge", "--no-commit", "--no-ff", source]);
  if (result.status !== 0 && !mergeHeadExists()) {
    throw new Error("merge failed: " + (result.stderr || result.stdout).trim());
  }
  if (!mergeHeadExists()) return false;
  var conflicts = conflictedFiles();
  if (conflicts.length) {
    if (conflicts.some(function (file) { return ALLOWED_METADATA_CONFLICTS.indexOf(file) === -1; })) {
      abortMerge("merge has conflicts outside release metadata and changelog");
    }
    for (var i = 0; i < conflicts.length; i++) {
      try {
        git(["checkout", "--theirs", "--", conflicts[i]]);
        git(["add", "--", conflicts[i]]);
      } catch (err) {
        abortMerge("unable to resolve allowed metadata conflict: " + conflicts[i]);
      }
    }
  }
  if (conflictedFiles().length) abortMerge("merge left unresolved conflicts");
  return true;
}

function restoreBackportMetadata(sourceMetadata, mainPackageText, mainLockText) {
  var releasePackage = sourceMetadata.packageJson;
  var mainPackage = JSON.parse(mainPackageText);
  var mainLock = JSON.parse(mainLockText);
  mainPackage.version = releasePackage.version;
  if (!mainLock.packages || !mainLock.packages[""]) throw new Error("main lockfile has no root package entry");
  mainLock.version = releasePackage.version;
  mainLock.packages[""].version = releasePackage.version;
  writeJson("package.json", mainPackage);
  writeJson("package-lock.json", mainLock);
  fs.writeFileSync("CHANGELOG.md", sourceMetadata.changelogText);
}

function restorePromotionMetadata(sourceMetadata) {
  fs.writeFileSync("package.json", sourceMetadata.packageText);
  fs.writeFileSync("package-lock.json", sourceMetadata.lockText);
  fs.writeFileSync("CHANGELOG.md", sourceMetadata.changelogText);
}

function stageAndCommit(message) {
  if (!mergeHeadExists()) throw new Error("expected MERGE_HEAD before finalizing release sync");
  git(["add", "-A"]);
  git(["commit", "-m", message]);
}

function releaseToMain(source) {
  assertClean();
  var mainPackageText = readGitFile("HEAD", "package.json");
  var mainLockText = readGitFile("HEAD", "package-lock.json");
  var sourceMetadata = readSourceMetadata(source);
  if (!mergeSource(source)) return;
  try {
    restoreBackportMetadata(sourceMetadata, mainPackageText, mainLockText);
    stageAndCommit("chore: sync release metadata into main");
  } catch (err) {
    abortMerge("post-merge release sync failed: " + err.message);
  }
}

function promoteMain(source) {
  assertClean();
  var sourceMetadata = readSourceMetadata(source);
  if (!mergeSource(source)) return;
  try {
    restorePromotionMetadata(sourceMetadata);
    stageAndCommit("chore: promote main to release");
  } catch (err) {
    abortMerge("post-merge promotion failed: " + err.message);
  }
}

function run(mode, source) {
  if (!mode || !source || (mode !== "release-to-main" && mode !== "promote")) {
    throw new Error("usage: release-sync.js <release-to-main|promote> <source-ref>");
  }
  if (mode === "release-to-main") releaseToMain(source);
  else promoteMain(source);
}

if (require.main === module) {
  try {
    run(process.argv[2], process.argv[3]);
  } catch (err) {
    console.error("[release-sync] " + err.message);
    process.exit(1);
  }
}

module.exports = { run: run, releaseToMain: releaseToMain, promoteMain: promoteMain };
