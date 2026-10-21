# Users and roles

Account roles govern server administration and feature permissions. Project ownership and session privacy govern content access separately. An administrator is not automatically the reader of every private project or conversation.

## Add an account

An administrator opens **Server Settings → Users → Accounts** and chooses **Add user**.

1. Enter the username and optional display name/email fields.
2. Review the account details.
3. Create the account.
4. Give the temporary sign-in information to the intended person through an appropriate channel.
5. Have them complete first-login credential changes.

The account form can generate a temporary six-digit PIN. Password-policy installations can require password enrollment before ordinary account use. Read the actual sign-in flow for the server's current policy.

## Invitations

Use **Users → Invitations** to create, copy, email, or revoke invitation links. Email invitations require configured [server SMTP](/docs/email).

An invitation is account onboarding, not automatic ownership of every project. After joining, the person still needs project access and permission for the relevant features.

Revoke an unused invitation when it should no longer admit someone. Do not treat revocation of an invitation as signing out an account that already joined.

## Permissions

Open a non-administrator user's **Permissions** control, review the feature toggles, and Save. Permissions can govern actions such as project/session management or tool access.

Check the actual account after a change. A hidden control or refused request may reflect role, feature permission, project access, or session ownership; these are different causes.

## Ownership and recovery

Only the project owner can transfer ownership or change sharing. Before removing an account, resolve the ordinary projects it owns, including registrations whose directories are unavailable. If removal is blocked and you cannot access the ownership controls, ask the server operator to investigate the affected registrations rather than deleting their directories.

Administrator overview/access metadata for a foreign private project does not grant its files or transcripts. Private Mate projects are excluded from that ordinary overview.

If someone cannot recover their sign-in through the offered flow, contact the server operator. Ordinary administrator access does not provide a way to impersonate another person and read private content.

## OS-level isolation

Application access checks are not isolation from a machine/root operator. Agent commands and terminal shells exercise the underlying OS account's authority. Distinct OS users and filesystem permissions are needed for stronger process separation; Clay Studio's OS-user mode requires Linux, root, and multi-user setup.

See [Project sharing](/docs/project-sharing), [Account security](/docs/account-devices-security), and [Server settings](/docs/server-settings).
