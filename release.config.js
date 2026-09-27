var config = {
  repositoryUrl: "https://github.com/chadbyte/clay.git",
  branches: [
    { name: "main", prerelease: "beta" },
    { name: "release" }
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    "@semantic-release/npm",
    ["@semantic-release/git", {
      assets: ["package.json", "package-lock.json", "CHANGELOG.md"],
      message: "chore(release): publish ${nextRelease.version}"
    }],
    ["@semantic-release/github", {
      successComment: "This issue has been resolved in version ${nextRelease.version} (${nextRelease.channel || 'stable'}).\n\nTo update, run:\n```\nnpx clay-server@${nextRelease.version}\n```\n\n*-- Clay Deploy Bot*\n\n*Build anything, with anyone, in one place.*",
      releasedLabels: ["released: ${nextRelease.channel || 'stable'}"]
    }]
  ]
}

module.exports = config
