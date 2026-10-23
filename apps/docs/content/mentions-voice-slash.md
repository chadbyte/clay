# Mentions, voice, and slash commands

Use a mention to ask someone else for a second opinion, voice input to dictate a draft, or a slash command to choose an action offered by the current session.

## Mention a Mate or teammate

1. Type **@** in the composer.
2. Choose an available Mate or teammate.
3. Check the recipient chip and the “Ask @…” placeholder.
4. Write and send the message.

The mention menu explains that the coding agent stays out of this exchange until your next message. A side conversation is therefore different from immediately asking the main coding agent to act. Its visible exchange can become context on the next agent message.

For example, mention a review Mate and ask, “What could confuse someone using this form?” The Mate receives recent conversation context. After its reply, remove the recipient chip and tell the coding agent which suggestions to apply. The side exchange belongs to this conversation; use the Mate's own workspace for a separate conversation.

Use the chip's remove action to return to the main conversation. Backspace in an otherwise empty composer also removes a mention chip. Check the recipient whenever switching between a side conversation and ordinary work.

## Dictate a request

Open **Voice input** to choose **Live** or **After recording**.

- Live places text as you speak.
- After recording transcribes after you stop.

Choose an available transcription model and language. Browser transcription can be unavailable in the current browser. External transcription providers need a saved API key. To add one:

1. Open **Settings → Personal → AI providers → API connections**.
2. Under **Available providers**, select the provider you want to use for audio transcription.
3. Enter its API key and choose **Save connection**.
4. Check that it appears under **Your connections** with **Key saved**.
5. Return to the microphone menu to choose its model, mode and language.

The catalog comes from the supported speech providers: OpenAI, ElevenLabs, Soniox, Groq and Deepgram in this version. This connection is for audio transcription only: convert microphone audio into text for voice input. Audio is sent to the selected provider and billed to your provider account. **Key saved** confirms storage, not verified access.

Choose a saved row's **Manage** action to replace or remove its key. The saved key stays masked; leave the field blank to keep it. Saving moves the provider into **Your connections** and removes its setup tile. Removing the key returns its tile to **Available providers**. Neither action changes your selected microphone model or language; a model whose key you removed requires reconnection before use.

A failed save keeps your draft in the editor. **Cancel** asks before discarding a typed key. Leaving settings can retain a draft in the current tab after confirmation; reloading loses it. Account or workspace connection changes clear the editor so another account cannot see the draft.

Allow microphone access when the browser asks. Speak, stop, then review the text before sending. Transcription can mishear paths, identifiers, and negation. Correct those in the draft.

If recording cannot start, check HTTPS, browser microphone permissions, input device, and the selected transcription model. Finish or discard recording before transferring a conversation between presentations.

## Use slash commands

Type **/** to see the commands supplied for the current session. Use Up/Down to choose an entry and Tab or Enter to select it. Escape closes the menu. The offered commands can change with provider, skills, and runtime state.

Read the selected command and any required argument before sending. A command offered by one runtime is not a guarantee of support in another. Skills can also contribute specialized behavior; installing a skill and invoking it are distinct actions.

For files and paste chips, see [Attachments](/docs/attachments-context). For provider differences, see [Capabilities](/docs/provider-capabilities). For microphone or transcription failures, see [Troubleshooting](/docs/troubleshooting).
