# Knowledge documents

Knowledge stores maintained reference material for a project or Mate: decisions, procedures, specifications, and explanations worth finding again. Use a document for evolving prose, rather than leaving its only useful copy in a long transcript.

## Create and read

1. Open **Knowledge** from the tool palette in the intended workspace.
2. Use the create action and select **New document**.
3. Give it a meaningful document path/name.
4. Write Markdown content in the editor.
5. Select **Save** and wait for confirmation.
6. Return to reading mode to inspect the rendered result.

Use **Search names and contents** to locate documents. Open tabs retain several references. The details area offers **Outline**, **Links**, and **History**. Headings make long procedures easier to navigate.

A suitable document is “Release procedure,” with prerequisites, ordered steps, expected results, and recovery instructions. A one-time failed command usually belongs in the task's Log instead.

## Edit and organize

Open a document and choose **Edit fullscreen**. Make changes, Save, then use **Exit editor** to return to reading. Expanding the Knowledge pane itself is only a layout action.

The editor distinguishes **Unsaved changes**, **Saving draft…**, **Draft saved on server**, and the saved document. A saved draft is recovery state; use Save to publish the document revision.

Use **Move / rename** for a saved clean document. Update meaningful links after reorganizing material. Relative document links and heading links can appear in Links, with unresolved targets identified.

## Resolve conflicts

If another change reaches the document, Clay Studio can offer **Keep draft** and **Reload disk version**. Copy important unsaved text before discarding it. Compare the versions and reapply the intended change against the current document.

A retry-index or sync warning can mean the document was saved while its search projection remains pending. Read that distinction before repeating creation. Use the offered **Retry index sync** rather than making duplicate documents.

## History and recovery

Use **Load version history** to inspect recorded revisions. Select a version to open its read-only preview. Choose **Review restore fullscreen**, inspect the exact content, then **Restore this version** if it is the intended replacement. Merely selecting a historical version does not restore it.

Use **Recover deleted documents** to find recoverable content and review its history through the same explicit restore flow. Deleting a document is distinct from erasing its entire recorded history. Recovery can fail if the target changed or a path conflicts; preserve your draft and resolve the current error rather than overwriting another document.

Knowledge ownership and write access still apply. A read-only document has no writable editor merely because you can view it.

For structured records, see [Knowledge databases](/docs/knowledge-databases). For durable task outcomes, see [Project Logs](/docs/project-logs); for reminders, see [Notes](/docs/notes).
