# SysML Monaco Editor

A web-based SysML v2 editor built with Monaco Editor and integrated with the SysIDE Language Server Protocol (LSP) server.

## Features

- **Monaco Editor Integration**: Full-featured code editor with syntax highlighting for SysML v2
- **LSP Integration**: Real-time language support via SysIDE LSP server (v0.8.1)
  - Hover information
  - Diagnostics (errors, warnings, info)
  - Semantic tokens for enhanced syntax highlighting
  - Auto-completion support (planned)
  - Code formatting (planned)
- **Multi-file Editing**: Tab-based interface for working with multiple SysML files
- **Problems Panel**: Visual display of diagnostics across all open files
- **WebSocket Proxy**: Browser-friendly WebSocket bridge to the native LSP server

## Architecture

```
Browser (Monaco Editor)
    ↓ WebSocket
LSP Proxy Server (Express + ws)
    ↓ stdio
SysIDE LSP Server (syside binary)
    ↓
SysML Library Files
```

### Components

1. **Frontend** (`src/`)
   - `sysml-editor.tsx`: Main editor component with Monaco setup
   - `lsp-client.ts`: WebSocket-based LSP client
   - `main.tsx`: React app entry point

2. **LSP Proxy** (`lsp-server-proxy/`)
   - `lsp-server-proxy.js`: WebSocket server that forwards messages between browser and syside
   - `syside`: SysIDE LSP server binary (v0.8.1)
   - `sysml/`: SysML v2 standard library files

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

```bash
# Install frontend dependencies
npm install

# Install LSP proxy dependencies
cd lsp-server-proxy
npm install
cd ..
```

### Running the Editor

You need to run two processes:

**Terminal 1 - LSP Proxy Server:**
```bash
npm run server
```

This starts the WebSocket proxy on `http://localhost:3000/sysml` which bridges the browser to the SysIDE LSP server.

**Terminal 2 - Development Server:**
```bash
npm run dev
```

This starts the Vite development server with the Monaco editor UI.

Then open your browser to the URL shown by Vite (typically `http://localhost:5173`).

## How It Works

### LSP Integration

1. **Connection**: The React app establishes a WebSocket connection to the proxy server
2. **Initialization**: LSP handshake is performed to exchange capabilities
3. **Document Sync**: File content is synchronized via `textDocument/didOpen` and `textDocument/didChange` notifications
4. **Diagnostics**: Server publishes diagnostics which are displayed as markers in the editor and the problems panel
5. **Hover**: Hover provider requests information from the LSP server for symbols under the cursor
6. **Semantic Tokens**: Enhanced syntax highlighting based on semantic analysis

### Syntax Highlighting

The editor uses a two-tier highlighting approach:

1. **Monarch Tokenizer**: Basic syntax highlighting as fallback
2. **Semantic Tokens**: LSP-provided semantic analysis for accurate highlighting

### Multi-file Support

- Each file gets its own Monaco model with a unique URI
- The LSP server tracks all open documents
- Diagnostics are aggregated across all files in the problems panel
- Click on any problem to jump to the relevant file and location

## Project Structure

```
example-sysml-editor/
├── src/
│   ├── main.tsx              # React entry point
│   ├── sysml-editor.tsx      # Main editor component
│   ├── lsp-client.ts         # LSP WebSocket client
│   ├── styles.css            # Global styles
│   └── types.d.ts            # TypeScript declarations
├── lsp-server-proxy/
│   ├── lsp-server-proxy.js   # WebSocket proxy server
│   ├── package.json          # Proxy dependencies
│   ├── syside                # SysIDE LSP binary
│   └── sysml/                # SysML v2 standard library
│       ├── Domain Libraries/
│       ├── Kernel Libraries/
│       └── Systems Library/
├── index.html                # HTML template
├── package.json              # Frontend dependencies
├── tsconfig.json             # TypeScript configuration
└── vite.config.ts            # Vite build configuration
```

## Troubleshooting

### LSP Server Not Connecting

- Check that the proxy server is running (`npm run server`)
- Verify WebSocket connection in browser console
- Ensure port 3000 is not in use by another process

### Hover Not Working

- Hover is triggered manually via mouse events (500ms delay)
- Ensure LSP connection status shows "connected"
- Check browser console for errors

### Diagnostics Not Showing

- Verify the LSP server has initialized successfully
- Check that files are being sent via `textDocument/didOpen`
- Look for diagnostic messages in the proxy server logs

## Future Enhancements

- [ ] Auto-completion support
- [ ] Code formatting via LSP
- [ ] Go to definition
- [ ] Find references
- [ ] Symbol outline/breadcrumbs
- [ ] File persistence (save/load from disk)
- [ ] Git integration
- [ ] Customizable themes

## Third-Party Components

This project integrates with:

- **SysIDE LSP Server**: Language server implementation for SysML v2
  - Repository: https://github.com/sensmetry/sysml-2ls (archived, now superseded by Syside Editor)
  - License: Eclipse Public License 2.0 OR GPL v2 with Classpath Exception
  - The `syside` binary is used under the terms of this dual license
- **SysML v2 Standard Library**: Official library files from the OMG SysML v2 specification
  - License: LGPL v3.0
- **Monaco Editor**: Microsoft's code editor
  - License: MIT
