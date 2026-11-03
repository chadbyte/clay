# Create, resume, and rename sessions

A session keeps a project's conversation available across visits. Return to it to continue a task with its history, or start another session for different work.

## Create

1. Select the project.
2. Choose **New session** under the intended folder.
3. Choose an installed provider.
4. Select **Create**.
5. Check model and permission mode before sending a request.

Cancel the inline creation row to abandon it before completion. If the connection drops during creation, inspect the session list before pressing Create again. A real session can exist even when your browser misses its acknowledgement.

Folders organize sessions; they do not create a new repository or branch. Sessions using the same directory can edit the same files.

Use **Close** at the far right of a pane header to remove that session from the current workspace, including when it is the only pane. The session, sidebar entry, history, and any running activity remain available. Closing the last pane opens the session picker over the workspace; search for a recent session or select a provider under **New session**. Press **Escape** to dismiss the picker, or use the sidebar to open or create a session.

## Resume

On project entry or refresh, your last visited session opens first if it is running or stopped less than 24 hours ago. Otherwise, Clay Studio opens the running session you visited most recently, or shows the session picker. The clock measures time since work stopped; opening history does not renew it. Your visit order is personal to your account and project. See [Sessions](/docs/sessions) for activity and older-session handling.

Select an existing session from its folder or a [search result](/docs/session-history-search). Wait for replay to finish before continuing. Scroll upward to load earlier messages when necessary.

A resumed conversation may restart its provider process or need authentication. Readable history does not establish readiness to execute. After an interruption, request a concrete next step: “Inspect current Git status and determine whether the previous validation finished before continuing.”

The latest visible response, pending queue, and actual files together provide the useful recovery context. Do not infer success from the absence of a spinner.

## Rename and organize

Open the session menu and choose **Rename**, or use the title's rename affordance. Enter saves; Escape cancels; leaving the field saves a changed nonempty title. A connection or permission change can cancel the edit.

Choose a descriptive task title, such as “Fix export validation,” rather than a provider name. Move the session into a folder for related work. A saved [View](/docs/split-views) displays several sessions without merging their transcripts.

## Finish deliberately

Use **Stop** to interrupt execution. **Close** only removes the pane from the current workspace and does not stop or delete the session. Check pending messages before resuming.

To remove a session, right-click its sidebar row and choose **Delete**, then read the confirmation. Preserve lasting project outcomes in [Project Logs](/docs/project-logs) and reference material in repository documents before deleting history. For an alternative investigation path, see [Fork and rewind](/docs/session-fork-rewind). For access, see [Session privacy](/docs/session-privacy-sharing).
