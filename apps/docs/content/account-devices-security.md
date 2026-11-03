# Account, devices, and security

Manage your own credentials and browser sessions in **Personal settings → Account**. Administrators configure server-wide authentication policy separately.

## Find personal preferences

The shared settings shell separates **Personal**, **Project** and **Server**. Personal pages include **Account**, **Appearance**, **Notifications**, **AI providers**, **Agent behavior** and **Integrations**.

Use **AI providers** for coding-agent installation status and sign-in, AI defaults, execution preferences and personal audio transcription API keys. **Integrations** holds your email, Linear and [GitHub](/docs/github) connections. GitHub uses the server GitHub CLI account; review its runtime scope before connecting. The former Conversation page is removed: voice keys are under AI providers, and **Capsules** is under **AI providers → Experimental features**. Existing AI preferences, Conversation and Experimental shortcuts open their replacement destination.

See [Provider sign-in](/docs/provider-auth#manage-providers-in-personal-settings) and [Voice input](/docs/mentions-voice-slash#dictate-a-request) for the setup and recovery steps.

## Choose the workspace background

Open **Personal settings → Appearance** and find **Workspace background**. Choose a circular swatch in the color strip, or select **Clay Embossed**, **Classic Mac Dither**, **Clay Memphis**, **Clay Clouds**, **Clay Mates**, **Clay Meadow**, **Clay Silicon**, **Clay Aqua**, **Clay Light**, **Clay Galaxy**, or **Clay Cove** under **Pictures**. **Clay Gray** is the default when you have not saved a workspace color. The ring marks your selected background; hover or focus a swatch to see its name.

The strip includes nine presets: **Windows 95 Teal**, **Windows 2000 Blue**, **Mac OS 8 Blue**, **Amiga Workbench Blue**, **NeXTSTEP Gray**, **BeOS Blue**, **Commodore 64 Blue**, **DOS Black**, and **Clay Gray**. NeXTSTEP Gray recalls its early monochrome dark-gray workspace. DOS Black recalls a black text screen; Commodore 64 Blue recalls its blue screen.

Your saved custom colors appear in the same strip. A previously selected preset remains available without changing its saved color. Swipe horizontally or use the chevrons to see more. With a swatch focused, use the arrow keys to change the selection, **Home** for the first color, or **End** for Clay Cove.

To add your own color, choose **+** at the end of the strip. In the small picker, choose a color visually or enter a six-digit HEX value such as `#E9CBD4`. The sun and moon buttons switch between its light and dark versions, one at a time. Choose **Add** to save the pair. The saved swatch joins the same strip. Choose **Cancel**, press **Escape**, or click outside the picker to discard the preview.

The eight historical swatches keep the same color in light and dark appearances. Clay Gray, your custom color pairs, and previously saved presets follow your appearance, including **Follow system**.

Clay Embossed repeats the same periwinkle logo artwork in both appearances, at a fixed tile size rather than stretching to fill the window. Classic Mac Dither repeats a crisp black-and-white checkerboard with two-pixel squares in both appearances. Clay Memphis fills the window with abstract artwork; Clay Clouds uses a natural sky with a subtle Clay-shaped cloud near the upper right. Clay Mates shows five distinct pixel Mate heads and the Clay symbol floating above a checkerboard. Clay Meadow shows a green hill with a winding path beneath a blue sky. Clay Silicon shows a blue-black hardware collage with a processor bearing the Clay symbol, network cables, and a reflective silicon wafer. Clay Aqua shows flowing translucent blue curves with a nested mint fold. Clay Light shows blue beams passing through the Clay silhouette. Clay Galaxy shows a rounded C-shaped galaxy with a nested teal curl. Clay Cove looks out through a wide cave opening toward a low rock arch and grassy headland. These nine pictures stay the same in light and dark, center the artwork, and may crop its edges to fill the window. Each picture applies its intended fit automatically; there is no fit or repeat control.

Previously saved Workshop artwork continues to fill the window and switch between day and evening artwork, but Workshop is no longer offered in Pictures. Choose a color or a current picture to replace it.

The background continues behind the softly blurred desktop Dock, sidebar, and pane headers; the Dock and sidebar use denser glass than pane headers. The top menu bar and conversation reading surfaces stay fully opaque. Your content palette stays separate from the workspace background, and selecting a picture retains your last solid color.

Wait for **Saved** before reloading; other devices use the saved choice when they reload. If adding a color fails, the picker retains your preview so you can try **Add** again. A failed swatch or picture selection offers **Retry save**. You can save up to 12 custom colors; the picker tells you when that limit is reached. Unsaved previews do not survive reloading.

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
