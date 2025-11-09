// Simple LSP client that communicates directly via WebSocket
export class SimpleLSPClient {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: Function; reject: Function }
  >();
  private isInitialized = false;
  private diagnosticsHandler: ((uri: string, diagnostics: any[]) => void) | null = null;
  private connectionStatusHandler: ((status: 'connecting' | 'connected' | 'disconnected' | 'error') => void) | null = null;

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log("Connected to LSP server");
        if (this.connectionStatusHandler) {
          this.connectionStatusHandler('connected');
        }
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error("LSP connection error:", error);
        if (this.connectionStatusHandler) {
          this.connectionStatusHandler('error');
        }
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse LSP message:", error, "Data:", event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log("LSP connection closed");
        this.isInitialized = false;
        if (this.connectionStatusHandler) {
          this.connectionStatusHandler('disconnected');
        }
      };
    });
  }

  setDiagnosticsHandler(handler: (uri: string, diagnostics: any[]) => void) {
    this.diagnosticsHandler = handler;
  }

  setConnectionStatusHandler(handler: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void) {
    this.connectionStatusHandler = handler;
  }

  private handleMessage(message: any) {
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      // Handle response to our request
      const { resolve, reject } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    } else if (message.method === "textDocument/publishDiagnostics") {
      // Handle diagnostics notification
      const { uri, diagnostics } = message.params;

      if (this.diagnosticsHandler) {
        this.diagnosticsHandler(uri, diagnostics);
      }
    } else {
      // Handle other notifications
      console.log("LSP notification:", message);
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = ++this.messageId;
      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      // Set a timeout for the request (30 seconds)
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} (id: ${id}) timed out after 30 seconds`));
        }
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (result: any) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error: any) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      
      this.ws.send(JSON.stringify(message));
    });
  }

  private sendNotification(method: string, params?: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("Cannot send notification, WebSocket not connected");
      return;
    }

    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.ws.send(JSON.stringify(message));
  }

  async initialize(): Promise<any> {
    if (this.isInitialized) return;

    const result = await this.sendRequest("initialize", {
      processId: null,
      clientInfo: {
        name: "Monaco SysML Editor",
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
    });

    this.sendNotification("initialized", {});
    this.isInitialized = true;
    return result;
  }

  didOpenTextDocument(
    uri: string,
    languageId: string,
    version: number,
    text: string
  ) {
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version,
        text,
      },
    });
  }

  didChangeTextDocument(uri: string, version: number, changes: any[]) {
    this.sendNotification("textDocument/didChange", {
      textDocument: {
        uri,
        version,
      },
      contentChanges: changes,
    });
  }

  async getHover(uri: string, line: number, character: number): Promise<any> {
    return this.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async getSemanticTokens(uri: string): Promise<any> {
    return this.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri },
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
    this.isInitialized = false;
  }
}