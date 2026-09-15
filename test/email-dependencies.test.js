var test = require("node:test");
var assert = require("node:assert/strict");
var net = require("node:net");
var smtp = require("../lib/smtp");
var accounts = require("../lib/email-accounts");
var ImapFlow = require("imapflow").ImapFlow;

async function listen(t, greeting, handleLine) {
  var sockets = new Set();
  var server = net.createServer(function (socket) {
    sockets.add(socket);
    socket.on("close", function () { sockets.delete(socket); });
    socket.on("error", function () {});
    socket.write(greeting + "\r\n");
    var pending = "";
    var state = {};
    socket.on("data", function (chunk) {
      pending += chunk.toString();
      var end;
      while ((end = pending.indexOf("\r\n")) >= 0) {
        var line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        handleLine(socket, line, state);
      }
    });
  });
  t.after(function () {
    sockets.forEach(function (socket) { socket.destroy(); });
    return new Promise(function (resolve) { server.close(resolve); });
  });
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("SMTP verification and Clay test delivery preserve recipient envelopes", { timeout: 10000 }, async function (t) {
  var recipients = [];
  var message = [];
  var port = await listen(t, "220 localhost SMTP", function (socket, line, state) {
    if (state.data) {
      if (line === ".") {
        state.data = false;
        socket.write("250 queued locally\r\n");
      } else {
        message.push(line);
      }
    } else if (/^EHLO /i.test(line)) {
      socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
    } else if (/^AUTH /i.test(line)) {
      socket.write("235 authenticated\r\n");
    } else if (/^MAIL FROM:/i.test(line)) {
      socket.write("250 sender accepted\r\n");
    } else if (/^RCPT TO:/i.test(line)) {
      recipients.push(line);
      socket.write("250 recipient accepted\r\n");
    } else if (line === "DATA") {
      state.data = true;
      socket.write("354 send message\r\n");
    } else if (line === "QUIT") {
      socket.end("221 bye\r\n");
    } else {
      socket.write("500 unexpected command\r\n");
    }
  });
  var config = { host: "127.0.0.1", port: port, secure: false, user: "sender@example.test", pass: "test", from: "Clay <sender@example.test>" };
  assert.deepEqual(await smtp.testConnection(config), { ok: true });
  var result = await smtp.sendTestEmail(config, '"Receiver, One" <one@example.test>, two@example.test');
  assert.equal(result.ok, true);
  assert.ok(result.messageId);
  assert.deepEqual(recipients, ["RCPT TO:<one@example.test>", "RCPT TO:<two@example.test>"]);
  assert.match(message.join("\n"), /Subject: Clay SMTP Test/);
  assert.match(message.join("\n"), /SMTP is configured correctly/);
});

test("IMAP account verification and inbox fetch decode message envelopes", { timeout: 10000 }, async function (t) {
  var port = await listen(t, "* OK local IMAP", function (socket, line) {
    var parts = line.split(" ");
    var tag = parts[0];
    var command = parts[1].toUpperCase();
    if (command === "CAPABILITY") {
      socket.write("* CAPABILITY IMAP4rev1\r\n" + tag + " OK capability\r\n");
    } else if (command === "LOGIN") {
      socket.write(tag + " OK login\r\n");
    } else if (command === "LIST") {
      socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n' + tag + " OK list\r\n");
    } else if (command === "SELECT") {
      socket.write("* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 1] stable\r\n" + tag + " OK [READ-WRITE] selected\r\n");
    } else if (command === "FETCH" || (command === "UID" && parts[2] === "FETCH")) {
      socket.write('* 1 FETCH (UID 7 FLAGS (\\Seen) ENVELOPE ("Tue, 15 Sep 2026 12:00:00 +0000" "=?UTF-8?Q?Hello_=E2=9C=93?=" (("Sender" NIL "sender" "example.test")) NIL NIL (("Receiver" NIL "receiver" "example.test")) NIL NIL NIL "<test@example.test>"))\r\n' + tag + " OK fetched\r\n");
    } else if (command === "LOGOUT") {
      socket.end("* BYE local logout\r\n" + tag + " OK logout\r\n");
    } else {
      socket.write(tag + " BAD unexpected command\r\n");
    }
  });
  var account = { email: "receiver@example.test", appPassword: "test", imap: { host: "127.0.0.1", port: port, tls: false } };
  assert.deepEqual(await accounts.testImapConnection(account), { ok: true });
  var client = new ImapFlow({ host: account.imap.host, port: port, secure: false, auth: { user: account.email, pass: account.appPassword }, logger: false });
  t.after(function () { client.close(); });
  await client.connect();
  var lock = await client.getMailboxLock("INBOX");
  try {
    var result = await client.fetchOne(7, { uid: true, envelope: true, flags: true }, { uid: true });
    assert.equal(result.uid, 7);
    assert.equal(result.envelope.subject, "Hello ✓");
    assert.equal(result.envelope.from[0].address, "sender@example.test");
    assert.equal(result.envelope.to[0].address, "receiver@example.test");
    assert.equal(result.envelope.messageId, "<test@example.test>");
    assert.equal(result.flags.has("\\Seen"), true);
  } finally {
    lock.release();
    await client.logout();
  }
});
