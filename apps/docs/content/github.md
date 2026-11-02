# GitHub

Clay Studio links sessions and project Issues to exact GitHub issues and pull requests. A link helps identify related work; it does not post a comment, create a commit, merge a PR, or grant repository access.

## Connect your GitHub account

Open **Settings → Personal → Integrations** and choose **GitHub** under **Available integrations**. Clay Studio checks the GitHub CLI (`gh`) on the server. Signing into github.com in your viewing browser does not configure that CLI.

If the CLI already works, review the **Current CLI account**, including its login, numeric ID and `github.com` host. Choose **Connect** with the displayed login to save that exact account under **Your connections**. An existing account is reused without starting another login. The connection records account metadata; GitHub CLI continues to own its credentials.

If sign-in is required:

1. Choose **Sign in with browser**, review the runtime account and credential replacement consequence, then choose **Start GitHub login**.
2. In the terminal modal, follow the GitHub CLI prompts. Enter the displayed one-time code at [GitHub device activation](https://github.com/login/device). You can use a browser on another device.
3. Return to Clay Studio. After the terminal exits, wait for verification of the actual GitHub API account.
4. Review the resulting login and numeric ID, then choose **Connect** with that login. Approval or a successful terminal exit alone does not save the association.

Only `github.com` is supported here. GitHub Enterprise is unavailable. If `gh` is missing, ask the server operator to follow the [official installation instructions](https://github.com/cli/cli#installation) for the runtime account shown in settings, then choose **Refresh**. Clay Studio does not install it from this page or ask for a personal access token.

## Runtime scope and credentials

Expand **Runtime account** to check the OS account, UID/GID and HOME directory. With OS-user isolation, GitHub CLI uses your mapped server account. Otherwise, all processes using the server OS account share its CLI credentials, including other Clay Studio accounts. Personal settings do not create private credential isolation on a shared runtime.

A new CLI login may replace the active GitHub account and change Git authentication settings for that runtime. On a shared runtime, only a server administrator can start it. Other permitted users can inspect and explicitly connect the already authenticated account. Terminal permission and current project access are required.

If `GH_TOKEN` or `GITHUB_TOKEN` overrides the effective account, settings reports the override without showing its value. Browser login is unavailable until the server operator resolves it; signing into another browser account does not change the environment override.

## Refresh, reconnect and disconnect

Choose **Manage** beside your saved GitHub connection. **Refresh** checks the effective CLI identity without changing credentials or silently changing the saved account. A network failure leaves the association visible with **Verification unknown**. If the CLI account or runtime changes, review and explicitly confirm the new exact account. **Reconnect with browser** starts a new reviewed login when permitted.

**Disconnect** asks for confirmation and removes only the Clay Studio association. It does not log out of GitHub CLI, uninstall it, revoke GitHub credentials, remove existing session links, or necessarily disable existing CLI-backed GitHub tools. Those tools continue to use the same runtime credential environment, including for users who have never saved this association.

Choosing another integration replaces the GitHub editor. If sign-in is active, Clay Studio first stops that login and waits for terminal exit acknowledgement before showing the selected editor. An unconfirmed stop keeps the GitHub editor open; it does not start another login.

Closing the login modal, choosing **Stop login**, leaving Integrations, losing access, or disconnecting the browser ends the flow. Clay Studio waits for terminal exit acknowledgement. Credentials already written by GitHub CLI may remain. If shutdown or login has an unknown outcome, ask the server operator to inspect the runtime before a new attempt; Clay Studio does not replay the login automatically. After a server interruption, an unresolved login reservation likewise needs operator inspection.

Personal settings are human controls. Clay cannot connect, reconnect or disconnect this account through its canonical product tools. Existing authorized GitHub session tools keep their current scope.

## Link session work

In the intended session, provide the exact GitHub URL or an unambiguous repository and issue/PR number:

“Investigate this pull request and its linked issue.”

An eligible agent can read the work and save relevant session links. [Agent behavior](/docs/agent-behavior) can turn this off or limit it to your requests for your own Driver conversations. Ask it to check existing linked conversations before duplicating an active investigation. Linking metadata itself does not modify GitHub.

Open a linked-work badge to inspect its current title/status and related entries. Verify the repository when names or numbers overlap.

## Choose a primary

The linked-work popover groups issues and pull requests and offers **Make primary**. Select the item you want emphasized and check for **Primary saved**.

Refreshing or adding a link does not replace an existing primary automatically. If asking the assistant to change primary, make that request explicit and review the exact proposed change. Unlinking a saved primary can require choosing a replacement first.

## Connect a Clay Studio Issue

Open the Clay Studio Issue and choose **Connect to GitHub**. Clay Studio searches existing open and closed work and compares potential matches.

A clear match can be linked; ambiguous matches require your choice. If no suitable issue exists, review the proposed title, description, and repository before authorizing creation. This action publishes content to GitHub, unlike a local session link.

If creation has an uncertain result, inspect GitHub and link the actual created URL before trying again. Automatic retry can create a duplicate.

## Authentication and verification

GitHub operations use tools on the server. Where Clay Studio uses the GitHub CLI (`gh`), that CLI must be authenticated under the appropriate server OS account. Follow [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login); signing into the website in your viewing browser does not configure it.

Read failures carefully: wrong repository, missing permission, expired authentication, and unavailable tools are different problems.

For code work, inspect the actual diff, commit SHA, remote branch, and PR result. Open the repository or PR to confirm publication. Explicitly request comments, publication, or merge when those actions are intended.

See [Issues](/docs/issues), [File history and Git](/docs/file-history-git), and [Linear](/docs/linear).
