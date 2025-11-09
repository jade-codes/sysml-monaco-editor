// node lsp-ws-proxy.js
// npm i express ws cross-spawn
const express = require("express");
const { WebSocketServer } = require("ws");
const spawn = require("cross-spawn");

const app = express();
const port = process.env.PORT || 3000;

// Serve static web app (optional)
app.use(express.static("dist"));

const server = app.listen(port, () => {
  console.log(`HTTP server listening on http://localhost:${port}`);
});

// WebSocket server for LSP
const wss = new WebSocketServer({ server, path: "/sysml" });

console.log("WebSocket server created on path /sysml");

wss.on("connection", async (ws) => {
  console.log("✓ Browser connected — spawning SysIDE language server");

  try {
    // Ensure SysML library is available
    const libraryPath = "./sysml";

    // spawn the SysIDE language server process from local bin directory
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

    // forward server logs for debugging
    ls.stderr.on("data", (data) => {
      console.error("[SysIDE stderr]", data.toString());
    });

    // Handle process events
    ls.on("error", (error) => {
      console.error("[SysIDE error]", error);
      if (ws.readyState === 1) { // WebSocket.OPEN = 1
        ws.close();
      }
    });

    ls.on("exit", (code, signal) => {
      console.log(
        `[SysIDE] process exited with code ${code}, signal ${signal}`
      );
      if (ws.readyState === 1) { // WebSocket.OPEN = 1
        ws.close();
      }
    });

    // Forward messages from WebSocket to SysIDE stdin with proper LSP framing
    ws.on("message", (message) => {
      try {
        const messageStr = message.toString();
        console.log("📤 WebSocket -> SysIDE:", messageStr);

        // Format message with Content-Length header for LSP
        const contentLength = Buffer.byteLength(messageStr, "utf8");
        const lspMessage = `Content-Length: ${contentLength}\r\n\r\n${messageStr}`;

        ls.stdin.write(lspMessage);
      } catch (error) {
        console.error("Error forwarding message to SysIDE:", error);
      }
    });

    // Parse LSP messages from SysIDE stdout and forward to WebSocket
    let buffer = "";
    ls.stdout.on("data", (data) => {
      console.log(`[SysIDE stdout] Received ${data.length} bytes`);
      buffer += data.toString();

      // Process LSP messages (Content-Length: X\r\n\r\n{json})
      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break; // No complete header yet

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

        if (buffer.length < messageEnd) {
          console.log(`[SysIDE] Waiting for more data. Have ${buffer.length}, need ${messageEnd}`);
          break; // Not enough data yet
        }

        const messageContent = buffer.substring(messageStart, messageEnd);
        buffer = buffer.substring(messageEnd);

        try {
          // Validate JSON and send to WebSocket
          const parsed = JSON.parse(messageContent);
          console.log("📥 SysIDE -> WebSocket:", messageContent);
          if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(messageContent);
            console.log("✓ Message sent to WebSocket");
          } else {
            console.error("✗ WebSocket not open, readyState:", ws.readyState);
          }
        } catch (error) {
          console.error(
            "[SysIDE] Invalid JSON in LSP message:",
            messageContent
          );
        }
      }
    });

    // cleanup on websocket close
    ws.on("close", (code, reason) => {
      console.log(`WebSocket closed with code ${code}, reason: ${reason || 'none'}`);
      console.log("Terminating SysIDE server");
      if (ls && !ls.killed) {
        ls.kill("SIGTERM");
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  } catch (error) {
    console.error("Failed to initialize SysIDE server:", error);
    ws.close();
  }
});
