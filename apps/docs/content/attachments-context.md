# Attachments and context

Use attachments when the agent needs an exact artifact. Use a repository path when it should inspect a file already present in the working directory. A screenshot, pasted excerpt, and live source file provide different evidence.

## Attach a file or image

1. Select the intended conversation.
2. Open the composer attachment action. Floating conversations with Clay or another Mate group **File** and **Image** under **+**.
3. Choose the artifact.
4. Wait for reading or upload to finish.
5. Inspect the resulting chip or thumbnail.
6. Add the question and send.

You can also paste supported images or content into the composer. Preview images when precision matters and remove the wrong attachment before submission.

For example: “Compare this screenshot with the current search panel and fix the spacing.” Name the relevant project files so the agent can compare the artifact with implementation.

## Pasted text

Long pasted content can appear as a separate pasted-content chip. Open it to inspect the actual text; the dialog distinguishes **Pasted content** from **Edit pasted content**. Use its edit/save controls when changing the block.

Do not assume that deleting the surrounding message removes a separate paste chip. Check all outgoing context before sending. For a short log excerpt, include the command and error around the excerpt so it is interpretable.

## Context chips and access

Check the chips to see which attachments, context, and recipients will accompany the message. A path in another private project still requires access to that project.

Repository content can change after it was pasted. If the task requires current truth, ask the agent to inspect the file in the working directory. If the task requires an immutable input, say that the attachment is the version to evaluate.

If an upload fails or a provider cannot read the format, use a supported format or divide the material into relevant parts. Ask the agent to identify any portion it could not read.

## Fix a mistaken attachment

Before delivery, remove it from the composer or edit the pending queue item. After delivery, send a correction and identify which input should be disregarded. Removing a visible chip later does not recall information already sent to a provider.

See [Composer basics](/docs/composer-basics), [Drafts and queue](/docs/drafts-and-queue), and [Usage and context](/docs/usage-and-context).
