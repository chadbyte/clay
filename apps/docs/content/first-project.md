# Your first project

A project connects Clay Studio to a directory on the server machine. Sessions work against that directory; project records preserve context between conversations. Start with an [authenticated provider](/docs/provider-auth) and a repository you can safely inspect.

## Open or create

1. Select **+** in the rail (**Add Mate or project**), then choose **Start a project**.
2. Choose **Open an existing folder**, **Create a new project**, or **Clone a repository**.
3. For an existing folder, browse the server to the project root and choose **Open**. Use **Enter path**, enter the server path, and select **Go** if you already know its location.
4. For a new project, enter **Project name** and select **Create project**.
5. For a clone, enter **GitHub repository URL**, choose the destination offered by the dialog, and select **Clone repository**.

Wait for creation or cloning to finish. The folder chooser describes the machine running Clay Studio. It cannot open an unrelated folder on the device displaying the browser. Private repository cloning also needs Git credentials in the server environment.

Confirm the project name and path when it opens. You can alternatively register a directory with `npx clay-server --add .` while the daemon runs.

## Start the first task

1. Choose **New session** under the intended session folder, including **Unfiled**.
2. Choose an installed provider in the inline creation row.
3. Select **Create**.
4. Check the model and permission controls.
5. Send: “Inspect this repository. Explain its entry point and the command used to run its tests.”

A response should appear in the transcript. Read permission cards before approving tool actions. If files cannot be found, check the working directory.

Next, request one bounded change: “Correct the typo in the welcome heading. Show the diff and run the relevant existing check. Do not commit.”

## Review and return

Open [Files](/docs/files) to inspect the result and the [Git view](/docs/file-history-git) to review changed paths. Read the check result alongside the changed files.

Use **Rename** in the session menu to give the task a recognizable name. Keep lasting project guidance in repository instruction files such as `AGENTS.md`; [Projects and working directories](/docs/projects-working-directories) explains supported files. Another session does not automatically contain this conversation.

Before parallel edits, learn about [working directories](/docs/projects-working-directories) and [worktrees](/docs/worktree-sharing): several sessions can otherwise change the same files.
