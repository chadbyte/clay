# GitHub

Clay Studio links sessions and project Issues to exact GitHub issues and pull requests. A link helps identify related work; it does not post a comment, create a commit, merge a PR, or grant repository access.

## Link session work

In the intended session, provide the exact GitHub URL or an unambiguous repository and issue/PR number:

“Investigate this pull request and its linked issue.”

An eligible agent can read the work and save relevant session links. Ask it to check existing linked conversations before duplicating an active investigation. Linking metadata itself does not modify GitHub.

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
