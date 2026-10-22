# Troubleshooting

Start with the symptom below. If an action may already have completed, check its result before repeating it—especially a send, publication, or external update.

## Clay Studio will not open

**On the server machine:** check the terminal or service that started Clay Studio. Use its printed URL and port. If the server is stopped, start it through the normal [CLI flow](/docs/cli-flags). Follow any certificate instructions shown at startup.

**Only on another device:** first confirm the printed address works on the server. Use its reachable hostname from the other device; localhost on a phone refers to the phone. If the hostname cannot be reached, ask the operator to check the network, listening address, and firewall before changing account settings.

**Through a proxy or tunnel:** compare direct access with the proxy address. If the page loads but the connection fails, the operator should check **Server Settings → Network → Reverse proxy & tunnels**. A proxy that rewrites Host can require an allowed external origin. Account HTTPS proxy trust is a separate setting. If the UI is unreachable, use a working direct connection to inspect settings or ask the host operator for help.

See [Server administration](/docs/server-settings) for the distinction between network origins, trusted proxies, and the passkey address.

## Sign-in or project access fails

Check the signed-in account and the server's PIN/password policy. A provider login is separate from Clay Studio account sign-in.

For a project link, check project access, then session visibility. An administrator does not automatically have access to private conversations. For passkeys, use the configured sign-in address; a different tunnel hostname may require password fallback. See [Account security](/docs/account-devices-security) and [Project sharing](/docs/project-sharing).

## Provider missing or request rejected

If the provider is missing from the picker, check that its CLI is installed under the server's OS account. If it is listed but requests fail, check sign-in and model access.

Use **Retry** in a failed model picker. If authentication works but the provider reports a rate limit, read its reset information instead of repeatedly sending the request. [Provider sign-in](/docs/provider-auth) includes setup steps.

## Nothing seems to happen

Look for an unanswered question, permission card, paused queue, future scheduled message, active tool, or rate-limit notice. A queued message is waiting to run.

For a Scheduled Task, expand it and read the status. **Open blocked run** takes you to input it needs. For a background task, open its viewer and use **Refresh** after resolving a connection problem.

## Files or records look stale

Check the project, worktree, and full path, then use Refresh in Files. In a Mate's Knowledge, a document can be saved while its search update fails; use **Retry index sync** rather than creating a duplicate. Clear database filters before concluding a record is missing.

If an edit conflicts with another saved change, preserve your draft, reload the current version, and reapply the intended change.

## Browser or voice fails

For responsive testing, use **Browser viewport**; resizing the surrounding pane only scales the display. Check whether shared control is paused and whether Browser is live or showing its last frame.

For voice, check microphone permission, HTTPS, input device, transcription mode, and any required provider credentials. Review the transcription before sending.

## After a crash or uncertain action

Reconnect and inspect the conversation, queue, files, and any external destination before retrying. [Stop and recovery](/docs/stop-recovery) gives a recovery sequence.

If reporting a problem, include the Clay Studio version, provider, exact error, steps to reproduce, and what you observed. Leave out credentials and unrelated private content.
