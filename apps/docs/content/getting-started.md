# Start with Clay Studio

Clay Studio is the product and workspace, running a server on a machine you control. Open that server in a browser to work with coding agents, repositories, project records, and private AI collaborators called Mates. **Clay** is the lead Mate's name; other Mates have their own identities and roles. A phone connects to the same Clay Studio server and does not need its own coding-agent installation.

## Install and open

You need **Node.js 20 or newer** and at least one supported coding-agent CLI installed and authenticated on the server machine. Check Node, then start Clay Studio:

```bash
node --version
npx clay-server
```

Follow the startup prompts and open the URL Clay Studio prints. Production uses port **2633** by default. HTTPS is enabled by default; use the printed hostname and certificate instructions. For another port, run `npx clay-server -p 8080`. The [CLI reference](/docs/cli-flags) covers unattended startup and other options.

A second invocation can connect to an existing daemon. Do not assume it creates another independent workspace.

## Complete the first visit

1. Open the printed address.
2. Complete the sign-in or administrator setup shown for that installation.
3. Check that your provider is available. If requests fail, complete [provider authentication](/docs/provider-auth).
4. Open **Start a project** and choose an existing folder, a new project, or a repository to clone.
5. Create a session and send a small request such as “Explain how to run this project's checks. Do not change files yet.”

You should see a response in the transcript. Tool activity and permission requests appear as work runs. A queued message is waiting for delivery; it does not mean the task has completed.

## Where information goes

The usual model request travels from the browser to Clay Studio, then through your selected coding-agent runtime to its provider. This path does not require a Clay Studio-hosted relay. Providers are not the only possible destination: MCP services, integrations, email, visited websites, browser downloads, and agent network commands can also transmit data.

“Private” controls workspace visibility. It does not prevent an authorized agent from using connected services.

Follow [Your first project](/docs/first-project) for a complete first task. To connect another device, keep the server reachable and use its actual URL: localhost on a phone refers to the phone. See [Server settings](/docs/server-settings) for HTTPS, proxies, and remote access.
