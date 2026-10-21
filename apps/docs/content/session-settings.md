# Session settings and handoffs

Session controls configure the selected conversation's provider behavior. Project defaults influence creation; changing a default is different from changing an existing session.

## Change a session setting

1. Open the intended session and verify its title.
2. Open the model/session controls.
3. Select an offered model.
4. Set effort if supported.
5. Select the intended permission mode.
6. Wait for each change to finish and check any status or error before sending.

Clay Studio requests a live model catalog. **Retry** in an empty or failed picker reloads that catalog. A failed selection can leave the previous model active. Permission changes also have a confirmed effective state; an unavailable Auto mode can use a fallback.

Do not assume a running provider turn adopts every setting midway through execution. Check the current status and apply configuration deliberately before the next task.

## Continue elsewhere

Use **Continue in another agent** beside the composer when another provider should continue. The session needs history and must be idle. The **Continue in a new agent** dialog offers **Agent**, **Model**, and supported **Reasoning effort**. Select **Continue** to create an independent session with a focused copy of this conversation's context. These desktop controls can be hidden in split or Mate presentations; open the ordinary session workspace when needed. Prepare a concise but sufficient handoff:

- The requested outcome and constraints.
- The working directory, branch, or worktree.
- Files changed and checks that actually ran.
- Remaining questions and known failures.
- The next concrete action.

Example: “Continue the export fix in the current worktree. Validation now rejects empty names. The unit check passed; browser verification remains. Inspect the diff and exercise export in the running app. Do not commit.”

Wait for the destination to become available, then verify its provider and context. Shared project instructions support continuity, but hidden reasoning, native task state, and provider-specific tools do not transfer universally.

## Keep defaults distinct

The creation UI can offer a project default provider. Saving that default affects later creation choices; it does not migrate all current conversations. Personal settings and server settings have their own scopes and are not session settings.

If the destination cannot start, check authentication and model availability. If it starts with incomplete context, supply the missing facts rather than asking it to infer the previous provider's private state.

See [Models](/docs/models-and-providers), [Permissions](/docs/permissions), [Session lifecycle](/docs/session-lifecycle), and [Usage and context](/docs/usage-and-context).
