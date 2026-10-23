# Account, devices, and security

Manage your own credentials and browser sessions in **Personal settings → Account**. Administrators configure server-wide authentication policy separately.

## Find personal preferences

The shared settings shell separates **Personal**, **Project** and **Server**. Personal pages include **Account**, **Appearance**, **Notifications**, **AI providers**, **Agent behavior** and **Integrations**.

Use **AI providers** for coding-agent installation status and sign-in, AI defaults, execution preferences and personal audio transcription API keys. **Integrations** continues to hold your email and Linear connections. The former Conversation page is removed: voice keys are under AI providers, and **Capsules** is under **AI providers → Experimental features**. Existing AI preferences, Conversation and Experimental shortcuts open their replacement destination.

See [Provider sign-in](/docs/provider-auth#manage-providers-in-personal-settings) and [Voice input](/docs/mentions-voice-slash#dictate-a-request) for the setup and recovery steps.

## Review signed-in devices

1. Open Personal settings and choose **Account**.
2. Find **Signed-in devices**.
3. Select **Manage sessions**.
4. Identify **This session** before signing anything out.
5. Review browser/device information, last observed activity, IP, and expiry.
6. Choose **Sign out** for the intended entry and confirm.

You can also sign out other sessions through the offered control. Signing out the current session returns you to sign-in. Merely expanding the device list stays inside settings.

Older migrated sessions can show **Unknown device** or **Previous activity unknown**. These are missing historical metadata, not evidence of a particular device or login time.

Sessions expire, so an older browser tab may ask you to sign in again.

## Passwords and PINs

Account settings shows whether you use a PIN or password. Choose its Change control and complete the verification shown.

An administrator can switch account sign-in from PINs to passwords. This change cannot be reversed through the policy control. At your next sign-in, use your existing PIN to enroll a password, then use the password for normal access.

A legacy single-user Server PIN is separate from multi-user account authentication. Do not try to repair an account login by changing an unrelated Server PIN.

## Passkeys

Where configured, choose **Manage passkeys**. Password-enrolled accounts can register, name, rename, and remove passkeys. Management requires fresh password verification and your browser or device's verification.

Use the sign-in address configured for passkeys. If you open Clay Studio through a different hostname or tunnel, a passkey may not work there; use password fallback and ask the administrator to check the [passkey settings](/docs/server-settings).

Password fallback remains available. Recovery can clear passkeys and invalidate affected sessions. TOTP authenticator enrollment is not part of this supported flow.

## Resolve sign-in problems

Use the server's actual sign-in URL, check HTTPS and account policy, and distinguish an expired browser session from provider authentication. Your coding-agent login does not sign you into Clay Studio.

See [Users and roles](/docs/team-users-roles), [Server settings](/docs/server-settings), and [Provider authentication](/docs/provider-auth).
