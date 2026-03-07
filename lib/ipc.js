var net = require("net");
var fs = require("fs");

/**
 * Create IPC server on a Unix domain socket.
 * handler(msg) should return a response object (or a Promise of one).
 */
function createIPCServer(sockPath, handler) {
  // Remove stale socket file (not needed for Windows named pipes)
  if (process.platform !== "win32") {
    try { fs.unlinkSync(sockPath); } catch (e) {}
  }

  var server = net.createServer(function (conn) {
    var buffer = "";
    conn.setEncoding("utf8");

    conn.on("data", function (chunk) {
      buffer += chunk;
      var lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (var i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          var msg = JSON.parse(lines[i]);
          var result = handler(msg);
          // Support both sync and async handlers
          if (result && typeof result.then === "function") {
            (function (c) {
              result.then(function (res) {
                try { c.write(JSON.stringify(res) + "\n"); } catch (e) {}
              }).catch(function (err) {
                try { c.write(JSON.stringify({ ok: false, error: err.message }) + "\n"); } catch (e) {}
              });
            })(conn);
          } else {
            conn.write(JSON.stringify(result) + "\n");
          }
        } catch (e) {
          try { conn.write(JSON.stringify({ ok: false, error: "parse error" }) + "\n"); } catch (e2) {}
        }
      }
    });

    conn.on("error", function () {});
  });

  var retried = false;
  server.on("error", function (err) {
    if (err.code === "EADDRINUSE" && !retried) {
      retried = true;
      console.log("[ipc] Socket in use, removing stale socket and retrying...");
      try { fs.unlinkSync(sockPath); } catch (e) {}
      server.listen(sockPath);
    } else {
      console.error("[ipc] Failed to bind socket:", err.message);
      process.exit(1);
    }
  });
  server.listen(sockPath);

  return {
    close: function () {
      server.close();
      if (process.platform !== "win32") {
        try { fs.unlinkSync(sockPath); } catch (e) {}
      }
    },
  };
}

/**
 * Send a command to the daemon IPC server and wait for response.
 * Returns a Promise resolving to the parsed response.
 */
function sendIPCCommand(sockPath, message) {
  return new Promise(function (resolve) {
    var client = net.connect(sockPath);
    var buffer = "";
    var done = false;

    var timer = setTimeout(function () {
      if (!done) {
        done = true;
        client.destroy();
        resolve({ ok: false, error: "timeout" });
      }
    }, 3000);

    client.on("connect", function () {
      client.write(JSON.stringify(message) + "\n");
    });

    client.on("data", function (chunk) {
      buffer += chunk;
      var idx = buffer.indexOf("\n");
      if (idx !== -1 && !done) {
        done = true;
        clearTimeout(timer);
        try {
          var resp = JSON.parse(buffer.substring(0, idx));
          resolve(resp);
        } catch (e) {
          resolve({ ok: false, error: "invalid response" });
        }
        client.destroy();
      }
    });

    client.on("error", function (err) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.code === "ECONNREFUSED" ? "daemon not responding" : err.message });
      }
    });
  });
}

module.exports = {
  createIPCServer: createIPCServer,
  sendIPCCommand: sendIPCCommand,
};
