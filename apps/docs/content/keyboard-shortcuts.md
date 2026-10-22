# Keyboard shortcuts

These keys apply to Clay Studio's workspace. Focus matters: keys typed into Terminal or the streamed Browser page go to that surface rather than necessarily to the composer.

## Workspace and transcript

| Keys | Action |
| --- | --- |
| **Command+K / Ctrl+K** | Open the workspace command palette |
| **Up / Down** in the palette | Move between results |
| **Enter** in the palette | Activate the selected result |
| **Escape** in the palette | Close it |
| **Command+F / Ctrl+F** in a session | Open find within the session |
| **Enter** in session search | Next match |
| **Shift+Enter** in session search | Previous match |
| **Escape** in session search | Close search |

Command is the usual macOS modifier; Ctrl is the alternative supported by these handlers. The docs site's search is separate from Clay Studio workspace navigation.

## Composer

| Keys | Action |
| --- | --- |
| **Enter** on desktop | Send the current message when no selection menu consumes Enter |
| **Shift+Enter** | Insert a newline |
| **Ctrl+J** | Insert a newline |
| **Up / Down** in slash menu | Choose a command |
| **Tab / Enter** in slash menu | Select the highlighted command |
| **Escape** in slash menu | Dismiss that menu |
| **Backspace** in empty mentioned composer | Remove the recipient mention chip |

On touch devices, Enter inserts a newline and the Send button submits. IME composition does not submit merely because its confirmation uses Enter. An empty Enter press while processing does not send a stale suggestion.

## Editing and organization

Session Rename uses Enter to save and Escape to cancel. Moving focus away also saves a changed nonempty title.

Session context menus support Up/Down, Tab/Shift+Tab, Home, End, and Escape. The Worker runtime picker supports arrow navigation and Home/End. Native selects and buttons retain their ordinary activation behavior.

Queued-message drag handles support arrow-key reordering. Check the resulting order, especially if the queue updates while you are editing.

In a reserved split-session picker, Escape cancels the reservation and returns to the prior geometry. Menus can consume Escape before the containing conversation closes.

## Tool focus

Terminal supplies touch controls for modifiers and arrows. Ctrl+C there normally interrupts a foreground shell command; it is not a global Clay Studio Stop shortcut.

Use visible Stop controls for agent interruption. In shared Browser, verify the selected tab and control mode before typing.

See [Composer](/docs/composer-basics), [Session search](/docs/session-history-search), and [Terminal](/docs/terminal).
