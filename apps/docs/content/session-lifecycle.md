# Create, resume, and rename sessions

A session is a durable conversation attached to a project and provider runtime. A pane, browser tab, session, and running turn are separate things.

## Create

1. Select the project.
2. Choose **New session** under the intended folder.
3. Choose an installed provider.
4. Select **Create**.
5. Check model and permission mode before sending a request.

Cancel the inline creation row to abandon it before completion. If the connection drops during creation, inspect the session list before pressing Create again. A real session can exist even when your browser misses its acknowledgement.

Folders organize sessions; they do not create a new repository or branch. Sessions using the same directory can edit the same files.

## Resume

Select an existing session from its folder or a [search result](/docs/session-history-search). Wait for replay to finish before continuing. Scroll upward to load earlier messages when necessary.

A resumed conversation may restart its provider process or need authentication. Readable history does not establish readiness to execute. After an interruption, request a concrete next step: “Inspect current Git status and determine whether the previous validation finished before continuing.”

The latest visible response, pending queue, and actual files together provide the useful recovery context. Do not infer success from the absence of a spinner.

## Rename and organize

Open the session menu and choose **Rename**, or use the title's rename affordance. Enter saves; Escape cancels; leaving the field saves a changed nonempty title. A connection or permission change can cancel the edit.

Choose a descriptive task title, such as “Fix export validation,” rather than a provider name. Move the session into a folder for related work. A saved [View](/docs/split-views) displays several sessions without merging their transcripts.

## Finish deliberately

Use **Stop** for execution. The pane's Close action changes presentation and is not a substitute for stopping. Check pending messages before resuming.

Use deletion only when you intend the session removal described by its confirmation. Preserve lasting results in [Project Logs](/docs/project-logs) or [Knowledge](/docs/knowledge-documents). For an alternative investigation path, see [Fork and rewind](/docs/session-fork-rewind). For access, see [Session privacy](/docs/session-privacy-sharing).
