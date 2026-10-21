# Troubleshooting

Start by identifying the layer that failed: browser connection, account access, project directory, provider runtime, tool connection, or task execution. Repeatedly sending the same prompt can obscure the original problem and duplicate effects.

## Clay Studio will not open

Check that the daemon is running and use its printed URL and port. On another device, localhost refers to that device. Confirm network reachability, host binding, certificate trust, and any private-network connection.

If a reverse proxy loads the page but WebSocket connection fails, inspect **Server Settings → Network → Reverse proxy & tunnels**. A rewritten Host can require an exact allowed external origin. Account HTTPS proxy trust is a separate setting.

Use [CLI flags](/docs/cli-flags) and [Server settings](/docs/server-settings) before changing configuration.

## Sign-in or access fails

Check the signed-in account, server authentication policy, project grants, and session privacy. An administrator can have overview metadata without access to foreign private content.

For passkeys, use the configured permanent sign-in origin. An alternate tunnel address can be allowed for networking yet invalid for passkeys. Use password fallback where available.

See [Account security](/docs/account-devices-security) and [Project sharing](/docs/project-sharing).

## Provider missing, model empty, or request rejected

Confirm the CLI is installed and authenticated under the daemon's OS account. A provider discovered as installed can still have expired credentials or no model entitlement.

Use Retry in the model catalog, then inspect the actual error. Check account usage if authentication works but requests are rate-limited. See [Provider authentication](/docs/provider-auth).

## Nothing seems to happen

Look for an unanswered structured question, permission card, paused queue, scheduled future message, active tool, or rate-limit state. Queued means waiting, not completed.

For a Scheduled Task, expand its readiness and **Open blocked run** when it needs input. For a background task, open the exact task viewer and Refresh after resolving failures.

## Files or records look stale

Confirm project/worktree and full path. Use Refresh in Files. In Knowledge, distinguish document persistence from a pending index sync; use Retry sync rather than creating duplicates.

Clear table filters before concluding a record is missing. Resolve stale-revision conflicts against current data while preserving your draft.

## Browser or voice fails

Browser pane size is not viewport size; use **Browser viewport** for responsive testing. Check whether the agent's browser control is paused and whether the Browser is live or displaying its last frame.

For voice, check microphone permission, HTTPS, selected device/transcription mode, and external provider credentials. Review transcription before sending.

## After a crash or uncertain action

Reconnect and inspect transcript, queue, files, and external destination before retrying. A timeout cannot prove an email, GitHub creation, or command never happened.

Use [Stop and recovery](/docs/stop-recovery). If reporting a problem, include version, provider, exact error, relevant steps, and what you observed—without credentials or unrelated private content.
