// Test script to communicate directly with SysIDE LSP server
const spawn = require("cross-spawn");
const path = require("path");

const libraryPath = "./sysml";
const sysidePath = "./syside";

const args = [
  "server",
  "--stdio",
  "--std",
  libraryPath,
  "--client-process-id",
  process.pid.toString(),
  "--line-length",
  "120",
  "--limit-completions",
  "100",
];

console.log(`Starting: ${sysidePath} ${args.join(" ")}`);
const ls = spawn(sysidePath, args, {
  stdio: ["pipe", "pipe", "pipe"],
});

// Handle stderr
ls.stderr.on("data", (data) => {
  console.error("[SysIDE stderr]", data.toString());
});

// Handle process events
ls.on("error", (error) => {
  console.error("[SysIDE error]", error);
  process.exit(1);
});

ls.on("exit", (code, signal) => {
  console.log(`[SysIDE] process exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});

// Parse LSP messages from stdout
let buffer = "";
ls.stdout.on("data", (data) => {
  buffer += data.toString();

  // Process LSP messages (Content-Length: X\r\n\r\n{json})
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const headers = buffer.substring(0, headerEnd);
    const contentLengthMatch = headers.match(/Content-Length: (\d+)/);

    if (!contentLengthMatch) {
      console.error("[SysIDE] Invalid LSP header:", headers);
      buffer = buffer.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(contentLengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;

    if (buffer.length < messageEnd) break;

    const messageContent = buffer.substring(messageStart, messageEnd);
    buffer = buffer.substring(messageEnd);

    try {
      const parsed = JSON.parse(messageContent);
      console.log("\n📥 Received from SysIDE:");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (error) {
      console.error("[SysIDE] Invalid JSON:", messageContent);
    }
  }
});

// Send initialize request
const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    processId: process.pid,
    clientInfo: {
      name: "Test Client",
      version: "1.0.0",
    },
    capabilities: {
      textDocument: {
        synchronization: {
          dynamicRegistration: false,
          willSave: false,
          willSaveWaitUntil: false,
          didSave: false,
        },
        completion: {
          dynamicRegistration: false,
        },
        hover: {
          dynamicRegistration: false,
        },
      },
    },
    rootUri: null,
    workspaceFolders: null,
  },
};

const messageStr = JSON.stringify(initializeRequest);
const contentLength = Buffer.byteLength(messageStr, "utf8");
const lspMessage = `Content-Length: ${contentLength}\r\n\r\n${messageStr}`;

console.log("\n📤 Sending to SysIDE:");
console.log(messageStr);
console.log("");

// Wait a bit for the process to start, then send the message
setTimeout(() => {
  ls.stdin.write(lspMessage);

  // Send initialized notification after a delay
  setTimeout(() => {
    const initializedNotification = {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    };

    const notifStr = JSON.stringify(initializedNotification);
    const notifLength = Buffer.byteLength(notifStr, "utf8");
    const notifMessage = `Content-Length: ${notifLength}\r\n\r\n${notifStr}`;

    console.log("\n📤 Sending initialized notification:");
    console.log(notifStr);
    console.log("");

    ls.stdin.write(notifMessage);

    // Keep process alive for a few seconds to see responses
    setTimeout(() => {
      console.log("\nTest complete, shutting down...");
      ls.kill("SIGTERM");
    }, 3000);
  }, 1000);
}, 500);
