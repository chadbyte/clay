// Email MCP Server for Clay (in-process SDK version)
// Provides email tools (send, read, search, reply, list labels, mark read)
// to Claude via createSdkMcpServer.
//
// Usage:
//   var emailMcp = require("./email-mcp-server");
//   var mcpConfig = emailMcp.create(getEmailAccount, getCheckedAccounts, smtpConfig);
//   // Pass mcpConfig to sdk-bridge opts.mcpServers

var z;
try { z = require("zod"); } catch (e) { z = null; }

function buildShape(props, required) {
  if (!z) return {};
  var shape = {};
  var keys = Object.keys(props);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var p = props[k];
    var field;
    if (p.type === "number") field = z.number();
    else if (p.type === "boolean") field = z.boolean();
    else if (p.enum) field = z.enum(p.enum);
    else if (p.type === "array") field = z.array(z.string());
    else field = z.string();
    if (p.description) field = field.describe(p.description);
    if (!required || required.indexOf(k) === -1) field = field.optional();
    shape[k] = field;
  }
  return shape;
}

// deps:
//   getAccountForTool(email) -> decrypted account object or null
//   getCheckedAccounts() -> array of decrypted accounts (context source checked)
//   getServerSmtp() -> { sendMail(to, subject, html), from } or null
//   appendAuditLog(entry) -> void
function create(deps) {
  var sdk;
  try { sdk = require("./yoke/sdk-server-factory").load(); } catch (e) {
    console.error("[email-mcp] Failed to load SDK:", e.message);
    return null;
  }

  var createSdkMcpServer = sdk.createSdkMcpServer;
  var tool = sdk.tool;
  if (!createSdkMcpServer || !tool) {
    console.error("[email-mcp] SDK missing createSdkMcpServer or tool helper");
    return null;
  }

  var nodemailer = require("nodemailer");
  var tools = [];

  // --- Helper: get SMTP transport for a personal account ---
  function getPersonalTransport(account) {
    return nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port || 587,
      secure: false,
      auth: { user: account.email, pass: account.appPassword },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
  }

  // --- Helper: get IMAP client for a personal account ---
  function getImapClient(account) {
    var ImapFlow;
    try { ImapFlow = require("imapflow").ImapFlow; } catch (e) {
      return null;
    }
    return new ImapFlow({
      host: account.imap.host,
      port: account.imap.port || 993,
      secure: account.imap.tls !== false,
      auth: { user: account.email, pass: account.appPassword },
      logger: false,
    });
  }

  // --- clay_send_email ---
  tools.push(tool(
    "clay_send_email",
    "Send an email. Use via='server' for auditable server SMTP, via='personal' for user's own account, or omit for auto-detect (personal if available, otherwise server).",
    buildShape({
      to: { type: "string", description: "Comma-separated recipient email addresses" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body (plain text)" },
      account: { type: "string", description: "Sender email address (for personal mode). If omitted, uses first checked account." },
      via: { type: "string", description: "Send mode: 'server' (admin SMTP, audited) or 'personal' (user account). Omit for auto-detect." },
      cc: { type: "string", description: "Comma-separated CC addresses" },
      bcc: { type: "string", description: "Comma-separated BCC addresses" },
    }, ["to", "subject", "body"]),
    function (args) {
      var via = args.via || "auto";
      var recipients = args.to.split(",").map(function (s) { return s.trim(); }).filter(Boolean);

      if (via === "server" || (via === "auto" && !deps.getCheckedAccounts().length)) {
        // Server SMTP mode
        var serverSmtp = deps.getServerSmtp();
        if (!serverSmtp) {
          return Promise.resolve({ content: [{ type: "text", text: "Error: Server SMTP is not configured. Ask the admin to set it up, or connect a personal email account." }] });
        }
        return serverSmtp.sendMail(recipients.join(", "), args.subject, args.body).then(function (info) {
          // Audit log
          deps.appendAuditLog({
            ts: Date.now(),
            to: recipients,
            subject: args.subject,
            status: "sent",
            messageId: info.messageId || null,
          });
          return { content: [{ type: "text", text: "Email sent via server SMTP to " + recipients.join(", ") + ". Subject: " + args.subject }] };
        }).catch(function (err) {
          return { content: [{ type: "text", text: "Error sending via server SMTP: " + (err.message || "Unknown error") }] };
        });
      }

      // Personal account mode
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }

      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No personal email account available. The user needs to add and check an email account in Context Sources." }] });
      }

      var transport = getPersonalTransport(account);
      var mailOpts = {
        from: account.email,
        to: recipients.join(", "),
        subject: args.subject,
        text: args.body,
      };
      if (args.cc) mailOpts.cc = args.cc;
      if (args.bcc) mailOpts.bcc = args.bcc;

      return transport.sendMail(mailOpts).then(function (info) {
        try { transport.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Email sent from " + account.email + " to " + recipients.join(", ") + ". Subject: " + args.subject }] };
      }).catch(function (err) {
        try { transport.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error sending from " + account.email + ": " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_read_email ---
  tools.push(tool(
    "clay_read_email",
    "Read recent emails from inbox or a specified folder. Returns message list with snippets. Use clay_read_email_body to get full content.",
    buildShape({
      account: { type: "string", description: "Email address of the account to read from. If omitted, uses first checked account." },
      folder: { type: "string", description: "Folder/mailbox name (default: INBOX)" },
      limit: { type: "number", description: "Number of messages to fetch (default 10, max 50)" },
      unread_only: { type: "boolean", description: "Only fetch unread messages (default false)" },
    }, []),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available. The user needs to add and check an email account." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module (imapflow) not available." }] });
      }

      var folder = args.folder || "INBOX";
      var limit = Math.min(Math.max(args.limit || 10, 1), 50);
      var unreadOnly = !!args.unread_only;

      return client.connect().then(function () {
        return client.getMailboxLock(folder);
      }).then(function (lock) {
        var searchCriteria = unreadOnly ? { seen: false } : { all: true };
        return client.search(searchCriteria, { uid: true }).then(function (uids) {
          if (!uids || uids.length === 0) {
            lock.release();
            return client.logout().then(function () {
              return { content: [{ type: "text", text: JSON.stringify({ messages: [], total: 0, unread: 0 }, null, 2) }] };
            });
          }

          // Get the most recent N UIDs
          var recentUids = uids.slice(-limit).reverse();

          // client.fetch is async*, returns AsyncGenerator directly
          var fetchIter = client.fetch(recentUids, {
            uid: true,
            envelope: true,
            flags: true,
            bodyStructure: true,
            source: { start: 0, maxLength: 500 },
          }, { uid: true });
          var messages = [];

          function collectMessages() {
            return fetchIter.next().then(function (result) {
              if (result.done) return;
              var msg = result.value;
              var env = msg.envelope || {};
              var fromAddr = env.from && env.from[0] ? (env.from[0].address || "") : "";
              var toAddrs = (env.to || []).map(function (a) { return a.address || ""; });
              var snippet = "";
              if (msg.source) {
                snippet = msg.source.toString("utf8").replace(/\r?\n/g, " ").substring(0, 200);
              }
              messages.push({
                uid: msg.uid,
                from: fromAddr,
                to: toAddrs,
                subject: env.subject || "(no subject)",
                date: env.date ? env.date.toISOString() : null,
                snippet: snippet,
                unread: !msg.flags || !msg.flags.has("\\Seen"),
              });
              return collectMessages();
            });
          }

          return collectMessages().then(function () {
            lock.release();
            return client.logout().then(function () {
              return {
                content: [{ type: "text", text: JSON.stringify({
                  messages: messages,
                  total: uids.length,
                  account: account.email,
                  folder: folder,
                }, null, 2) }],
              };
            });
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error reading email from " + account.email + ": " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_read_email_body ---
  tools.push(tool(
    "clay_read_email_body",
    "Read the full body of a specific email by UID. Returns plain text content (HTML stripped). Truncated at 10,000 characters.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
      uid: { type: "number", description: "Message UID (from clay_read_email results)" },
      folder: { type: "string", description: "Folder/mailbox name (default: INBOX)" },
    }, ["uid"]),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      var folder = args.folder || "INBOX";
      var MAX_BODY = 10000;

      return client.connect().then(function () {
        return client.getMailboxLock(folder);
      }).then(function (lock) {
        return client.fetchOne(args.uid, {
          uid: true,
          source: true,
        }, { uid: true }).then(function (msg) {
          lock.release();
          return client.logout().then(function () {
            if (!msg || !msg.source) {
              return { content: [{ type: "text", text: "Message not found or empty." }] };
            }
            var raw = msg.source.toString("utf8");
            // Simple extraction: try to get text content after headers
            var bodyStart = raw.indexOf("\r\n\r\n");
            if (bodyStart === -1) bodyStart = raw.indexOf("\n\n");
            var body = bodyStart !== -1 ? raw.substring(bodyStart + (raw[bodyStart + 2] === "\n" ? 4 : 2)) : raw;
            // Strip HTML tags for a rough plain text extraction
            body = body.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            // Clean up whitespace
            body = body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
            if (body.length > MAX_BODY) {
              body = body.substring(0, MAX_BODY) + "\n\n[Truncated at " + MAX_BODY + " characters]";
            }
            return { content: [{ type: "text", text: body }] };
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error reading email body: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_search_email ---
  tools.push(tool(
    "clay_search_email",
    "Search emails using IMAP search criteria. Supports basic criteria like from, subject, since, before, and text content.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
      from: { type: "string", description: "Filter by sender address (partial match)" },
      subject: { type: "string", description: "Filter by subject text (partial match)" },
      text: { type: "string", description: "Search in entire message body and headers" },
      since: { type: "string", description: "Messages after this date (ISO 8601 format, e.g. 2026-04-15)" },
      before: { type: "string", description: "Messages before this date (ISO 8601 format)" },
      folder: { type: "string", description: "Folder/mailbox name (default: INBOX)" },
      limit: { type: "number", description: "Max results (default 20, max 50)" },
    }, []),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      var folder = args.folder || "INBOX";
      var limit = Math.min(Math.max(args.limit || 20, 1), 50);

      // Build IMAP search criteria
      var criteria = {};
      if (args.from) criteria.from = args.from;
      if (args.subject) criteria.subject = args.subject;
      if (args.text) criteria.body = args.text;
      if (args.since) criteria.since = new Date(args.since);
      if (args.before) criteria.before = new Date(args.before);
      if (Object.keys(criteria).length === 0) criteria.all = true;

      return client.connect().then(function () {
        return client.getMailboxLock(folder);
      }).then(function (lock) {
        return client.search(criteria, { uid: true }).then(function (uids) {
          if (!uids || uids.length === 0) {
            lock.release();
            return client.logout().then(function () {
              return { content: [{ type: "text", text: JSON.stringify({ messages: [], total: 0 }, null, 2) }] };
            });
          }

          var recentUids = uids.slice(-limit).reverse();

          var fetchIter2 = client.fetch(recentUids, {
            uid: true,
            envelope: true,
            flags: true,
          }, { uid: true });
          var messages = [];

          function collect() {
            return fetchIter2.next().then(function (result) {
              if (result.done) return;
              var msg = result.value;
              var env = msg.envelope || {};
              messages.push({
                uid: msg.uid,
                from: env.from && env.from[0] ? env.from[0].address : "",
                subject: env.subject || "(no subject)",
                date: env.date ? env.date.toISOString() : null,
                unread: !msg.flags || !msg.flags.has("\\Seen"),
              });
              return collect();
            });
          }

          return collect().then(function () {
            lock.release();
            return client.logout().then(function () {
              return { content: [{ type: "text", text: JSON.stringify({ messages: messages, total: uids.length, account: account.email }, null, 2) }] };
            });
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error searching email: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_reply_email ---
  tools.push(tool(
    "clay_reply_email",
    "Reply to an email by UID. Automatically sets In-Reply-To and References headers to preserve threading.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
      uid: { type: "number", description: "Message UID to reply to (from clay_read_email results)" },
      body: { type: "string", description: "Reply body text" },
      reply_all: { type: "boolean", description: "Reply to all recipients (default false)" },
      folder: { type: "string", description: "Folder/mailbox name (default: INBOX)" },
    }, ["uid", "body"]),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      var folder = args.folder || "INBOX";

      return client.connect().then(function () {
        return client.getMailboxLock(folder);
      }).then(function (lock) {
        return client.fetchOne(args.uid, {
          uid: true,
          envelope: true,
        }, { uid: true }).then(function (msg) {
          lock.release();
          return client.logout().then(function () {
            if (!msg || !msg.envelope) {
              return { content: [{ type: "text", text: "Original message not found." }] };
            }

            var env = msg.envelope;
            var replyTo = env.replyTo && env.replyTo[0] ? env.replyTo[0].address : (env.from && env.from[0] ? env.from[0].address : null);
            if (!replyTo) {
              return { content: [{ type: "text", text: "Cannot determine reply address from original message." }] };
            }

            var mailOpts = {
              from: account.email,
              to: replyTo,
              subject: "Re: " + (env.subject || ""),
              text: args.body,
              inReplyTo: env.messageId || undefined,
              references: env.messageId || undefined,
            };

            if (args.reply_all) {
              var allTo = (env.to || []).map(function (a) { return a.address; }).filter(function (a) {
                return a && a !== account.email;
              });
              var allCc = (env.cc || []).map(function (a) { return a.address; }).filter(function (a) {
                return a && a !== account.email;
              });
              if (allTo.length > 0) mailOpts.to = [replyTo].concat(allTo).join(", ");
              if (allCc.length > 0) mailOpts.cc = allCc.join(", ");
            }

            var transport = getPersonalTransport(account);
            return transport.sendMail(mailOpts).then(function () {
              try { transport.close(); } catch (e) {}
              return { content: [{ type: "text", text: "Reply sent from " + account.email + " to " + mailOpts.to + ". Subject: " + mailOpts.subject }] };
            });
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error replying to email: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_list_labels ---
  tools.push(tool(
    "clay_list_labels",
    "List all email folders/labels with message counts for an account.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
    }, []),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      return client.connect().then(function () {
        return client.list();
      }).then(function (mailboxes) {
        var folders = mailboxes.map(function (mb) {
          return {
            name: mb.name,
            path: mb.path,
            delimiter: mb.delimiter,
            flags: Array.from(mb.flags || []),
            specialUse: mb.specialUse || null,
          };
        });
        return client.logout().then(function () {
          return { content: [{ type: "text", text: JSON.stringify({ folders: folders, account: account.email }, null, 2) }] };
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error listing folders: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_mark_read ---
  tools.push(tool(
    "clay_mark_read",
    "Mark one or more emails as read by UID.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
      uids: { type: "string", description: "Comma-separated message UIDs to mark as read" },
      folder: { type: "string", description: "Folder/mailbox name (default: INBOX)" },
    }, ["uids"]),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      var folder = args.folder || "INBOX";
      var uidList = args.uids.split(",").map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); });

      if (uidList.length === 0) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No valid UIDs provided." }] });
      }

      return client.connect().then(function () {
        return client.getMailboxLock(folder);
      }).then(function (lock) {
        return client.messageFlagsAdd(uidList, ["\\Seen"], { uid: true }).then(function () {
          lock.release();
          return client.logout().then(function () {
            return { content: [{ type: "text", text: "Marked " + uidList.length + " message(s) as read in " + account.email + "/" + folder }] };
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error marking as read: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  // --- clay_move_email ---
  tools.push(tool(
    "clay_move_email",
    "Move one or more emails to a different folder/label by UID. Use clay_list_labels to see available folders. In Gmail, moving to a folder is equivalent to applying that label.",
    buildShape({
      account: { type: "string", description: "Email address of the account. If omitted, uses first checked account." },
      uids: { type: "string", description: "Comma-separated message UIDs to move" },
      from_folder: { type: "string", description: "Source folder (default: INBOX)" },
      to_folder: { type: "string", description: "Destination folder/label name (e.g. 'Work', '[Gmail]/Trash', '[Gmail]/All Mail')" },
    }, ["uids", "to_folder"]),
    function (args) {
      var account;
      if (args.account) {
        account = deps.getAccountForTool(args.account);
      } else {
        var checked = deps.getCheckedAccounts();
        account = checked.length > 0 ? checked[0] : null;
      }
      if (!account) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No email account available." }] });
      }

      var client = getImapClient(account);
      if (!client) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: IMAP module not available." }] });
      }

      var fromFolder = args.from_folder || "INBOX";
      var toFolder = args.to_folder;
      var uidList = args.uids.split(",").map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return !isNaN(n); });

      if (uidList.length === 0) {
        return Promise.resolve({ content: [{ type: "text", text: "Error: No valid UIDs provided." }] });
      }

      return client.connect().then(function () {
        return client.getMailboxLock(fromFolder);
      }).then(function (lock) {
        return client.messageMove(uidList, toFolder, { uid: true }).then(function () {
          lock.release();
          return client.logout().then(function () {
            return { content: [{ type: "text", text: "Moved " + uidList.length + " message(s) from " + fromFolder + " to " + toFolder + " in " + account.email }] };
          });
        });
      }).catch(function (err) {
        try { client.close(); } catch (e) {}
        return { content: [{ type: "text", text: "Error moving email: " + (err.message || "Unknown error") }] };
      });
    }
  ));

  return createSdkMcpServer({
    name: "clay-email",
    version: "1.0.0",
    tools: tools,
  });
}

module.exports = { create: create };
