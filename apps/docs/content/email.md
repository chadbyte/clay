# Personal email and server SMTP

Personal mailboxes let an eligible assistant read, search, and send your mail. Server SMTP handles Clay Studio's server delivery, including invitations and login codes. These are separate connections and scopes.

## Connect a personal mailbox

1. Open **Settings → Personal → Integrations**.
2. Under **Available integrations**, choose Gmail, Outlook Mail, Yahoo Mail, or **Custom email**.
3. Enter the mailbox details and required app password.
4. Supply custom server information when needed.
5. Test the connection through the offered control.
6. Save and confirm the account appears.

Use provider-specific app-password instructions where required. An ordinary account password may not work for IMAP/SMTP access.

Saved accounts offer **Manage → Disconnect**. Disconnecting removes Clay Studio's connection while keeping mail at the provider.

## Ask for mailbox work

State the account and scope: “Search my work mailbox for messages from this sender since Monday and summarize them. Do not reply.”

Tools can read folders, search, inspect message details, reply, and mark messages where available. Specify the folder if it is not INBOX. Reading/searching and sending are different actions.

For a send request, review the sender account, To, CC/BCC, subject, and body. Say explicitly when you want it sent. If several accounts are enabled, name the sender rather than relying on a default.

A transport acceptance result is not proof that the recipient read the message. If sending times out, inspect the observed result before repeating it.

## Configure server delivery

Administrators use **Server Settings → Email delivery** for SMTP host, port, credentials, sender details, and applicable registration/email-code settings.

Port **587** with direct TLS off uses STARTTLS; port **465** with TLS on uses direct SSL. Use the actual mail service's requirements. Save and test delivery rather than assuming that credentials alone establish reachability.

Server SMTP does not provide a personal inbox reader. Assistant email tools can distinguish server and personal send modes; specify the intended identity.

## Fix failures

Check host/port, app-password requirements, network access, selected mailbox, and the actual error. Removing SMTP can affect invitation/login delivery, so read its confirmation.

Keep credentials in settings, never in repository files or chat. See [Account security](/docs/account-devices-security), [Users](/docs/team-users-roles), and [Permissions](/docs/permissions).
