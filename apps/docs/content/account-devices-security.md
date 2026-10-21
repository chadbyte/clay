# Account, devices, and security

Manage your own credentials and browser sessions in **Personal settings → Account**. Administrators configure server-wide authentication policy separately.

## Review signed-in devices

1. Open Personal settings and choose **Account**.
2. Find **Signed-in devices**.
3. Select **Manage sessions**.
4. Identify **This session** before signing anything out.
5. Review browser/device information, last observed activity, IP, and expiry.
6. Choose **Sign out** for the intended entry and confirm.

You can also sign out other sessions through the offered control. Signing out the current session returns you to sign-in. Merely expanding the device list stays inside settings.

Older migrated sessions can show **Unknown device** or **Previous activity unknown**. These are missing historical metadata, not evidence of a particular device or login time.

Account sessions have expiry and revocation. Leaving a browser open does not guarantee perpetual sign-in.

## Passwords and PINs

The Account surface shows the credential action appropriate to the server policy: account PIN or password. Use the actual Change control and complete its verification.

Administrators can activate the server's account password policy. This is a one-way policy transition; existing account PINs then authorize restricted enrollment rather than ordinary continued workspace use. Finish password enrollment before expecting normal access.

A legacy single-user Server PIN is separate from multi-user account authentication. Do not try to repair an account login by changing an unrelated Server PIN.

## Passkeys

Where configured, choose **Manage passkeys**. Password-enrolled accounts can register, name, rename, and remove passkeys. Management requires fresh password verification and the browser/device's authentication ceremony.

Passkeys require the separately configured exact HTTPS sign-in address and hostname policy; localhost development has an exception. An allowed network origin does not automatically become a valid passkey origin.

Password fallback remains available. Recovery can clear passkeys and invalidate affected sessions. TOTP authenticator enrollment is not part of this supported flow.

## Resolve sign-in problems

Use the server's actual sign-in URL, check HTTPS and account policy, and distinguish an expired browser session from provider authentication. Your coding-agent login does not sign you into Clay Studio.

See [Users and roles](/docs/team-users-roles), [Server settings](/docs/server-settings), and [Provider authentication](/docs/provider-auth).
