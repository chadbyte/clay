# Projects and working directories

A Clay Studio project registers a directory on the server. File tools, shell commands, and agent edits affect that actual directory. A project title is a label, not a filesystem boundary.

## Select the correct root

Open **Start a project → Open an existing folder** to register a directory. For a Git repository, choose its root unless a subdirectory is intentional. Use **Clone a repository** to obtain a remote repository first, or **Create a new project** for an empty directory.

Before requesting edits:

1. Select the project.
2. Check its path in project information/settings.
3. Open Files and confirm recognizable content.
4. In Terminal, use `pwd` to confirm the shell's working directory.
5. Name the intended directory and file scope in the request.

For example: “Work in the current project directory and change only the documentation folder.” This is useful when several repositories have similar names.

## Instructions and environment

Keep project guidance in a repository instruction file such as `AGENTS.md` or `CLAUDE.md`. Clay Studio also recognizes `.cursorrules`, `.github/copilot-instructions.md`, `COPILOT.md`, and `QWEN.md`; providers differ in which files they read directly.

For example, an `AGENTS.md` might say: “Run the existing unit tests before handing back a change. Keep generated files unchanged. Explain any check you could not run.” Add the real test command used by your project so another session can follow it.

Open the project header menu and choose **Project Settings → Environment** for process configuration. Keep secrets out of messages and committed files. A process already running may need restarting to read a changed environment; saving settings does not retroactively change its environment.

## Parallel tasks

Several sessions in one directory can edit the same files. A [split View](/docs/split-views) changes presentation, not isolation. For independent branches or conflicting changes, use [Git worktrees](/docs/worktree-sharing).

Check each worktree's path before running commands. Sharing project records does not make two worktree directories identical.

## Registration and access problems

The CLI supports:

```bash
npx clay-server --list
npx clay-server --add .
npx clay-server --remove /path/to/project
```

Removal unregisters the project; it is distinct from deleting its repository directory. Read the specific UI confirmation for any removal action.

If opening fails, check that the directory still exists, the daemon's OS account can access it, and your Clay Studio account has permission. Reopening a browser tab cannot restore files deleted outside Clay Studio.

See [Project sharing](/docs/project-sharing) for workspace access and [Troubleshooting](/docs/troubleshooting) for discovery and connection failures.
