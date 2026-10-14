# User Settings

User Settings owns personal choices and defaults. It remains a modal with six destinations, one navigation model and a narrow navigation/detail view. Existing server administration, projects and individual Mate editors retain their scopes.

## Current-to-new map

| Previous entry/control | Destination and question | Owner, persistence and effect | Save contract |
| --- | --- | --- | --- |
| Account identity; account-menu name/avatar | Account — who am I here? | Current account/profile; `/api/profile`, `/api/avatar`; existing identity displays | Name Save/Cancel (including acknowledged account-menu edit); avatar upload after positioning; existing pixel-avatar and regeneration shortcuts retained |
| Account PIN | Account / Security — how do I sign in? | Authenticated account; `/api/user/pin`; immediate account credential change; unavailable for local profiles without an account | Current PIN plus validated matching new PIN; explicit Save; failed draft retained |
| Logout page | Account / Sign out | Current browser login; `/auth/logout` | Explicit action |
| Appearance theme; legacy browser theme | Appearance / Theme | `/api/user/appearance`; per-user `users.json`, single-user `appearance-preferences.json`; independently saved lightTheme/darkTheme plus system/light/dark mode; old single-theme values remain compatible; preview immediate, other devices on reload | Autosave acknowledged; failed preview retained for retry. Legacy theme import is explicit and only offered to unconfigured accounts |
| Appearance Bubble/Channel | Appearance / Conversation layout | `/api/user/chat-layout`; per-user or local profile; current view | Acknowledged autosave |
| Terminal title-bar typography | Appearance / Terminal typography; toolbar preserved | `/api/user/terminal-font`; personal profile; existing and new terminals via shared terminal-prefs controller | Direct font/size controls with acknowledged autosave and retry; toolbar uses the same saver |
| Chat language + composer speech picker | Conversation / Voice providers manages API keys only; model/mode/language stay in composer | `/api/speech/settings`; encrypted account speech store shared by both entry points; one key per provider | Inline Save/Remove with retained failed drafts and custom discard guard; key management never changes model or language |
| Mates page / project DM shortcut switch | Removed | DM entry points are always enabled for accessible Mates; legacy preference is ignored by the client | Existing ownership and access checks remain |
| Experimental / Capsules | Conversation / Experimental features disclosure | `/api/user/capsules-enabled`; personal account, daemon fallback for local mode | Existing optimistic preference with rollback and error toast |
| Notifications alert and sound; bell shortcut | Notifications / Account preferences | `/api/user/notifications`; server-side personal preferences; future notification decisions | Acknowledged autosave with retained failed selection and Retry |
| Notifications push | Notifications / This device | Browser permission and service-worker push subscription; device-specific | Browser permission and subscription lifecycle; never represented as an account-wide permission |
| Account-menu Default AI | AI preferences / Default AI; account shortcut retained | Account default-AI preference and provider catalog via WebSocket; new Clay interviews and built-in assistance | Existing correlated Apply/Cancel transaction; custom discard confirmation; unavailable provider state preserved |
| Chat Auto-continue | AI preferences / Execution behavior | `/api/user/auto-continue`; per-user or daemon fallback; eligible rate-limit retries | Acknowledged autosave; explains automatic continuation and usage |
| Chat Claude terminal mode | Removed | Legacy saved preferences are ignored; new sessions and idle legacy sessions open in Clay chat; live terminal runtimes remain intact | Old setting requests are refused; no stored history is deleted |
| Chat auto-approved command rules | AI preferences / Command permissions | Account allow list via WS, then `~/.claude/settings.json` in resolved OS home or shared daemon home | Explicit Save/Cancel; managed rules shown separately. Installation failures reported separately from saved account preference |
| Integrations / Linear | Removed from User Settings; project placement deferred by user | Existing personal credential service and saved keys retained; no scope migration | Project configuration entry point is future work |
| Email page / personal mailboxes | Email / Personal mailboxes | Existing personal email account service, setup workbench and WS account removal | Provider-specific setup and masked credentials; custom draft-discard guard; confirmed disconnect with acknowledgement feedback |

No unsupported input preference is invented: current composer keyboard behavior remains unchanged. No universal inheritance cascade is implied.

## Boundaries and compatibility

- Server SMTP, users, invitations, access policy, network, retention and operations remain in Server Settings.
- Project settings, individual Mate settings, Knowledge, MCP/Skills and scheduled work remain contextual editors/workbenches. Project cursor sharing remains a project-scoped account-menu control.
- Voice credentials stay with speech configuration, not a generic integration form. Personal mailboxes remain distinct from server SMTP.
- Old section identifiers resolve to the new destinations; desktop and narrow navigation derive from one list.
- Theme and layout no longer write localStorage. Legacy theme values remain untouched until an explicit theme selection/import is acknowledged. Bootstrap uses system colors, avoiding another account's cached palette before authenticated preferences load. Existing notification migration behavior is preserved.
- Account allow rules do not grant Clay session approval mode or server administration authority. On shared non-OS servers their existing CLI installation target is the shared daemon home; the UI states this limitation. No path or authorization expansion is introduced.
- Dirty voice keys, name, terminal, PIN and AI/rule drafts survive leaving the modal within the current tab after a custom warning. Secret drafts are not persisted to browser storage. Reload destroys tab-only drafts; they are intentionally not persisted to disk.

## Composition

Simple preferences remain directly adjustable: separate light/dark palette dropdowns with color previews and a system/light/dark mode selector, illustrated compact layout selection, terminal font/size, and provider API-key management. Voice shows one row per provider with its logo, connection state and Connect/API key action. Masked editors expand beneath the provider row for save, replacement and removal. All models from the provider share the key. Model, transcription mode and language selection remain in the composer picker; User Settings does not duplicate them. Edit steps are reserved for text-heavy or sensitive transactions. The profile picture itself opens avatar editing; the name uses a styled inline form. Six plain navigation rows avoid category headings and one-page-per-toggle expansion. Appearance groups visual choices; Conversation groups interaction; AI preferences groups defaults separately from execution and permission rules. Connection objects retain their own lifecycle and setup forms.

Shared settings selectors, focus outlines, control sizes and semantic colors reuse Server Settings primitives. Modal navigation is 196px on desktop, content is bounded; narrow screens show either navigation or detail with a Settings return action. Reduced motion removes transitions.

## Verification

42 targeted tests pass, including production-page Playwright flows, authenticated appearance persistence and account isolation, single-user persistence across handler reload, failed name saves retaining drafts, mailbox discard recovery, voice-language agreement between Settings and composer, six-page navigation parity, narrow layout, keyboard dismissal/focus return and console-error checks. Existing default-AI, speech, custom-selector, capsule and Server Settings tests also pass. Shared-browser review covered Account, Appearance, Conversation/Voice, AI preferences and Email at 1280×800 and 390×844, including light and dark palettes.

Live external credentials, mailbox delivery, speech-provider billing and real Linux OS-home permission failures were not exercised. Tests use isolated accounts and mocked failures. No live server shutdown/restart, commit or deployment occurred.
