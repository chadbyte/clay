# Start with Clay Studio

Clay Studio gives you a browser workspace for working with AI agents. Use a **project** for work in a folder or repository, or create a **Mate** for a continuing role such as research or review. **Clay** is your built-in lead Mate. [Projects and Mates](/docs/clay-vs-mates) explains how they work together.

## Join an existing server

If someone has given you a Clay Studio address, open it in your browser and complete the sign-in or invitation flow. You do not need to install coding agents on the device you use to view it. Ask the server operator for project access and provider setup if those are unavailable.

The same address can work from your phone when the server is reachable. An address beginning with localhost refers to the device opening it, so use the server's actual hostname when connecting remotely.

## Set up your own server

The server machine holds your project files and runs the coding agents. It can be the computer you are using now.

1. Install a supported **Node.js LTS release** (Clay Studio requires version 20 or newer) using the [official Node.js download instructions](https://nodejs.org/en/download).
2. Open a terminal on that machine and run `node --version` to check the installation.
3. Install and sign in to a coding-agent CLI under the account that will run Clay Studio. [Provider sign-in](/docs/provider-auth) includes a complete Claude Code example and links for alternatives.
4. Start Clay Studio:

```bash
npx clay-server
```

Follow the startup prompts, then open the printed URL. Complete the administrator setup or sign-in shown. HTTPS is enabled by default; follow the printed certificate instructions. The default port is **2633**. To choose another port, use `npx clay-server -p 8080`.

A second invocation can connect to an already running server. Use the [CLI reference](/docs/cli-flags) when you need unattended startup or an independent installation.

## Try a first task

Follow [Your first project](/docs/first-project) to open a folder and create a session. Send a small request such as “Explain how to run this project's checks. Do not change files yet.” You should see the response in the conversation, with tool activity and any permission requests alongside it.

If you want a continuing collaborator instead, follow [Create and shape a Mate](/docs/mate-creation-identity).

## Understand where information goes

Your request travels through the Clay Studio server and the selected coding-agent application to its provider; it does not require a Clay Studio-hosted relay. Connected services, email, websites, and agent network commands can also receive data when used for your task.

Private conversations limit who can see them in Clay Studio. They do not prevent the agent from using a connected service you authorize. For remote access and server maintenance, see [Server administration](/docs/server-settings).
