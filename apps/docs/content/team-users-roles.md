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

For **Ownership needs recovery**, use **Project Settings → Access** or **Recover ownership** on the restricted overview. Read the proposed owner and choose **Recover ownership** directly. On installations without OS-user isolation, if no verified account is identified, the authenticated administrator becomes the recovery owner. No command or approval code is needed. OS-isolated installations require verified account and directory mapping. See [Recover missing project ownership](/docs/project-sharing#recover-missing-project-ownership).

Administrator overview/access metadata for a foreign private project does not grant its files or transcripts. Private Mate projects are excluded from that ordinary overview.

## Reset another user’s credentials

As an administrator, open **Server Settings → Users → Accounts**, find the person, and choose **Reset PIN** (the key icon). Review the confirmation, then choose **Reset PIN**. Copy the new temporary PIN and share it privately with the intended person.

Resetting signs out that account’s existing browser sessions. On a password-policy installation, it also removes the old password and registered passkeys. The temporary PIN grants credential enrollment only; the person must choose new credentials before accessing the workspace.

On a PIN-policy installation, sign in with the temporary PIN and choose a different six-digit PIN. When passwords are enabled, choose **I still use an account PIN** at sign-in, enter the temporary PIN, and set a new password. Passkeys can be registered again afterward. If enrollment expires, verify the temporary PIN again. Once new credentials are saved, the temporary PIN stops working.

Administrators are trusted to issue sign-in credentials for other accounts. Give them only to the intended person: anyone who receives a temporary PIN can complete recovery as that account. Resetting credentials does not change project ownership, sharing, or role permissions. If a reset reports a failure, retry from the account row; existing sessions may already have been signed out.

## OS-level isolation

Application access checks are not isolation from a machine/root operator. Agent commands and terminal shells exercise the underlying OS account's authority. Distinct OS users and filesystem permissions are needed for stronger process separation; Clay Studio's OS-user mode requires Linux, root, and multi-user setup.

See [Project sharing](/docs/project-sharing), [Account security](/docs/account-devices-security), and [Server settings](/docs/server-settings).
