import React, { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { SimpleLSPClient } from "./lsp-client";

const languageId = "sysml";

interface ErrorItem {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string;
  uri: string;
}

interface FileTab {
  id: string;
  name: string;
  uri: string;
  content: string;
  isDirty: boolean;
}

export default function SysMLEditor() {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const clientRef = useRef<SimpleLSPClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");
  const [currentErrors, setCurrentErrors] = useState<ErrorItem[]>([]);
  const [openFiles, setOpenFiles] = useState<FileTab[]>([
    {
      id: 'main',
      name: 'main.sysml',
      uri: 'file:///main.sysml',
      content: `package MainPackage {
    import LibraryPackage::*;
    
    part MainPart specializes LibraryPart {
        attribute mainAttr : String;
        port mainPort;
    }
}`,
      isDirty: false
    },
    {
      id: 'library',
      name: 'library.sysml',
      uri: 'file:///library.sysml',
      content: `package LibraryPackage {
    part LibraryPart {
        attribute baseAttr : Integer;
        port basePort;
    }
    
    part AnotherLibraryPart {
        attribute anotherAttr : Boolean;
    }
}`,
      isDirty: false
    }
  ]);
  const [activeFileId, setActiveFileId] = useState<string>('main');

  useEffect(() => {
    if (!editorContainerRef.current) return;

    // Register SysML language first
    if (!monaco.languages.getLanguages().find((lang) => lang.id === languageId)) {
      monaco.languages.register({ id: languageId, extensions: ['.sysml'] });
      
      // Basic syntax highlighting (fallback when semantic tokens aren't available)
      monaco.languages.setMonarchTokensProvider(languageId, {
        tokenizer: {
          root: [
            [/\b(package|part|attribute|item|port|connection|interface|action|state|requirement|use|import|public|private|abstract|readonly|derived|end|specializes|subsets|redefines|features|typed|by|multiplicity|ordered|nonunique)\b/, "keyword"],
            [/\b(Boolean|Integer|Real|String|UnlimitedNatural)\b/, "type"],
            [/[{}()\[\]]/, "bracket"],
            [/[<>=!]+/, "operator"],
            [/".*?"/, "string"],
            [/'.*?'/, "string"],
            [/\/\/.*$/, "comment"],
            [/\/\*[\s\S]*?\*\//, "comment"],
            [/[;,.]/, "delimiter"],
          ],
        },
      });
    }

    // Create Monaco models for all files
    const models = openFiles.map(file => {
      const existingModel = monaco.editor.getModels().find(m => m.uri.toString() === file.uri);
      if (existingModel) {
        return existingModel;
      }
      return monaco.editor.createModel(file.content, languageId, monaco.Uri.parse(file.uri));
    });

    // Create Monaco editor with the active file's model
    const activeFile = openFiles.find(f => f.id === activeFileId);
    const activeModel = models.find(m => m.uri.toString() === activeFile?.uri);

    editorRef.current = monaco.editor.create(editorContainerRef.current, {
      model: activeModel,
      automaticLayout: true,
      minimap: { enabled: false },
      theme: "vs-dark",
      hover: {
        enabled: true,
        above: true,
        delay: 100,
        sticky: true,
      },
      quickSuggestions: false,
      parameterHints: { enabled: false },
      scrollBeyondLastLine: true,
      overviewRulerBorder: true,
      fixedOverflowWidgets: true,
      'semanticHighlighting.enabled': true,
    });

    // Register hover provider immediately (before LSP connection)
    const hoverDisposable = monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position) => {
        if (!clientRef.current) return null;

        try {
          const hoverResult = await clientRef.current.getHover(
            model.uri.toString(),
            position.lineNumber - 1,
            position.column - 1
          );

          if (!hoverResult || !hoverResult.contents) {
            // Fall back to showing diagnostic markers if no LSP hover info
            const markers = monaco.editor.getModelMarkers({
              resource: model.uri,
            });

            const hit = markers.find(
              (m) =>
                position.lineNumber >= m.startLineNumber &&
                position.lineNumber <= m.endLineNumber &&
                position.column >= m.startColumn &&
                position.column <= m.endColumn
            );

            if (!hit) return null;

            const range = new monaco.Range(
              hit.startLineNumber,
              hit.startColumn,
              hit.endLineNumber,
              hit.endColumn
            );

            return {
              range,
              contents: [
                { value: `**${hit.source}**: ${hit.message}` }
              ]
            };
          }

          // Convert LSP hover response to Monaco format
          const contents = Array.isArray(hoverResult.contents)
            ? hoverResult.contents
            : [hoverResult.contents];

          const formattedContents = contents.map((content: any) => {
            if (typeof content === 'string') {
              return { value: content };
            } else if (content.kind === 'markdown') {
              return { value: content.value };
            } else if (content.language) {
              return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
            } else {
              return { value: content.value || String(content) };
            }
          });

          let range;
          if (hoverResult.range) {
            range = new monaco.Range(
              hoverResult.range.start.line + 1,
              hoverResult.range.start.character + 1,
              hoverResult.range.end.line + 1,
              hoverResult.range.end.character + 1
            );
          }

          return {
            range,
            contents: formattedContents
          };
        } catch (error) {
          console.error("Error getting hover info:", error);
          return null;
        }
      },
    });
    console.log("✓ Hover provider registered, disposable:", hoverDisposable);

    // Setup LSP connection
    const connectToLSP = async () => {
      setConnectionStatus("connecting");

      try {
        const client = new SimpleLSPClient();
        clientRef.current = client;

        // Set up connection status handler before connecting
        client.setConnectionStatusHandler((status) => {
          setConnectionStatus(status);
        });

        await client.connect("ws://localhost:3000/sysml");
        setConnectionStatus("connected");

        // Initialize the LSP client
        const serverCapabilities = await client.initialize();

        // Set up diagnostics handler
        client.setDiagnosticsHandler((uri, diagnostics) => {
          // Find the corresponding Monaco model for this URI
          const models = monaco.editor.getModels();
          const model = models.find(m => m.uri.toString() === uri);
          
          if (model) {
            // Convert LSP diagnostics to Monaco markers
            const markers = diagnostics.map((diagnostic) => {
              const severity =
                diagnostic.severity === 1
                  ? monaco.MarkerSeverity.Error
                  : diagnostic.severity === 2
                  ? monaco.MarkerSeverity.Warning
                  : diagnostic.severity === 3
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Hint;

              const marker = {
                startLineNumber: diagnostic.range.start.line + 1,
                startColumn: diagnostic.range.start.character + 1,
                endLineNumber: diagnostic.range.end.line + 1,
                endColumn: diagnostic.range.end.character + 1,
                message: diagnostic.message,
                severity: severity,
                code: diagnostic.code?.toString(),
                source: "SysIDE",
              };

              return marker;
            });

            // Set markers on the specific model
            monaco.editor.setModelMarkers(model, "lsp", markers);
          }

          // Update current errors list (aggregate from all files)
          setCurrentErrors(prevErrors => {
            // Remove old errors for this URI
            const filteredErrors = prevErrors.filter(error => error.uri !== uri);
            
            // Add new errors for this URI
            const newErrors: ErrorItem[] = diagnostics.map((diagnostic) => ({
              line: diagnostic.range.start.line + 1,
              column: diagnostic.range.start.character + 1,
              message: diagnostic.message,
              severity: diagnostic.severity === 1 ? 'error' :
                       diagnostic.severity === 2 ? 'warning' :
                       diagnostic.severity === 3 ? 'info' : 'hint',
              code: diagnostic.code?.toString(),
              uri: uri
            }));

            return [...filteredErrors, ...newErrors];
          });
        });

        // Register semantic tokens provider
        const semanticTokensLegend = serverCapabilities.capabilities.semanticTokensProvider?.legend;
        if (semanticTokensLegend) {
          monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
            provideDocumentSemanticTokens: async (model) => {
              if (!clientRef.current) return null;
              
              try {
                const result = await clientRef.current.getSemanticTokens(model.uri.toString());
                if (!result || !result.data) return null;
                
                return {
                  data: new Uint32Array(result.data),
                  resultId: result.resultId,
                };
              } catch (error) {
                console.error("Error getting semantic tokens:", error);
                return null;
              }
            },
            releaseDocumentSemanticTokens: () => {},
            getLegend: () => semanticTokensLegend,
          });
        }

        // Send didOpen notifications for all documents
        models.forEach(model => {
          client.didOpenTextDocument(
            model.uri.toString(),
            languageId,
            1,
            model.getValue()
          );

          // Listen for content changes on each model
          model.onDidChangeContent(() => {
            if (clientRef.current) {
              clientRef.current.didChangeTextDocument(
                model.uri.toString(),
                model.getVersionId(),
                [
                  {
                    text: model.getValue(),
                  },
                ]
              );
            }
          });
        });
      } catch (error) {
        console.error("Failed to connect to LSP:", error);
        setConnectionStatus("error");
      }
    };

    // Connect to LSP after a short delay to ensure proxy is ready
    const connectTimeout = setTimeout(connectToLSP, 1000);

    return () => {
      clearTimeout(connectTimeout);
      hoverDisposable?.dispose();
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      editorRef.current?.dispose();
    };
  }, []);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case "connected":
        return "#4CAF50";
      case "connecting":
        return "#FF9800";
      case "error":
        return "#F44336";
      default:
        return "#9E9E9E";
    }
  };

  const getSeverityColor = (severity: ErrorItem['severity']) => {
    switch (severity) {
      case 'error': return '#ff6b6b';
      case 'warning': return '#ffd93d';
      case 'info': return '#74c0fc';
      case 'hint': return '#51cf66';
      default: return '#adb5bd';
    }
  };

  const getSeverityIcon = (severity: ErrorItem['severity']) => {
    switch (severity) {
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
      case 'hint': return '💡';
      default: return '•';
    }
  };

  const jumpToError = (line: number, column: number, uri: string) => {
    // Switch to the file containing the error if it's not already active
    const file = openFiles.find(f => f.uri === uri);
    if (file && file.id !== activeFileId) {
      switchToFile(file.id);
    }
    
    // Jump to the error location
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.setPosition({ lineNumber: line, column: column });
        editorRef.current.focus();
      }
    }, 100); // Small delay to ensure file switch completes
  };

  const switchToFile = (fileId: string) => {
    const file = openFiles.find(f => f.id === fileId);
    if (!file || !editorRef.current) return;

    const model = monaco.editor.getModels().find(m => m.uri.toString() === file.uri);
    if (model) {
      editorRef.current.setModel(model);
      setActiveFileId(fileId);
    }
  };

  const closeFile = (fileId: string) => {
    if (openFiles.length <= 1) return; // Don't close the last file

    const fileToClose = openFiles.find(f => f.id === fileId);
    if (!fileToClose) return;

    // Remove the model
    const model = monaco.editor.getModels().find(m => m.uri.toString() === fileToClose.uri);
    if (model) {
      model.dispose();
    }

    // Update the file list
    const newFiles = openFiles.filter(f => f.id !== fileId);
    setOpenFiles(newFiles);

    // If we're closing the active file, switch to another one
    if (fileId === activeFileId) {
      const newActiveFile = newFiles[0];
      switchToFile(newActiveFile.id);
    }

    // Remove errors for this file
    setCurrentErrors(prev => prev.filter(error => error.uri !== fileToClose.uri));
  };

  return (
    <div style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "8px 12px",
          backgroundColor: "#1e1e1e",
          color: "white",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
        }}
      >
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: getStatusColor(),
          }}
        />
        SysIDE LSP: {connectionStatus}
      </div>
      
      {/* File Tabs */}
      <div style={{
        backgroundColor: "#2d2d2d",
        borderBottom: "1px solid #333",
        display: "flex",
        overflowX: "auto"
      }}>
        {openFiles.map(file => (
          <div
            key={file.id}
            style={{
              padding: "8px 16px",
              backgroundColor: file.id === activeFileId ? "#1e1e1e" : "transparent",
              borderRight: "1px solid #333",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: file.id === activeFileId ? "#ffffff" : "#cccccc",
              minWidth: "120px",
              userSelect: "none"
            }}
            onClick={() => switchToFile(file.id)}
          >
            <span>{file.name}</span>
            {file.isDirty && <span style={{ color: "#ffd93d" }}>●</span>}
            {openFiles.length > 1 && (
              <span
                style={{
                  marginLeft: "auto",
                  padding: "2px 4px",
                  borderRadius: "2px",
                  fontSize: "10px",
                  cursor: "pointer",
                  opacity: 0.7,
                  transition: "opacity 0.2s"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.id);
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "0.7"}
              >
                ×
              </span>
            )}
          </div>
        ))}
      </div>
      <div
        ref={editorContainerRef}
        style={{
          flex: 2,
          border: "1px solid #ddd",
          position: "relative",
          overflow: "visible",
          zIndex: 1,
        }}
      />
      
      {/* Problems Panel */}
      <div style={{
        flex: 1,
        minHeight: "200px",
        backgroundColor: "#1e1e1e",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column"
      }}>
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          backgroundColor: "#2d2d2d",
          fontSize: "12px",
          fontWeight: "bold",
          display: "flex",
          alignItems: "center",
          gap: "8px"
        }}>
          Problems ({currentErrors.length})
          <div style={{ display: "flex", gap: "12px", fontSize: "10px" }}>
            <span style={{ color: getSeverityColor('error') }}>
              {getSeverityIcon('error')} {currentErrors.filter(e => e.severity === 'error').length}
            </span>
            <span style={{ color: getSeverityColor('warning') }}>
              {getSeverityIcon('warning')} {currentErrors.filter(e => e.severity === 'warning').length}
            </span>
            <span style={{ color: getSeverityColor('info') }}>
              {getSeverityIcon('info')} {currentErrors.filter(e => e.severity === 'info').length}
            </span>
          </div>
        </div>
        <div style={{
          flex: 1,
          overflowY: "auto"
        }}>
          {currentErrors.map((error, index) => (
            <div 
              key={index} 
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #333",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                backgroundColor: "transparent",
                transition: "background-color 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#2d2d2d"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
              onClick={() => jumpToError(error.line, error.column, error.uri)}
            >
              <span style={{ 
                color: getSeverityColor(error.severity),
                fontSize: "12px",
                flexShrink: 0,
                width: "16px"
              }}>
                {getSeverityIcon(error.severity)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: "12px",
                  color: "#ffffff",
                  marginBottom: "2px",
                  wordBreak: "break-word"
                }}>
                  {error.message}
                </div>
                <div style={{
                  fontSize: "10px",
                  color: "#888",
                  display: "flex",
                  gap: "8px"
                }}>
                  <span>{openFiles.find(f => f.uri === error.uri)?.name || 'Unknown'}</span>
                  <span>Line {error.line}, Column {error.column}</span>
                  {error.code && <span>({error.code})</span>}
                </div>
              </div>
            </div>
          ))}
          {currentErrors.length === 0 && (
            <div style={{ 
              padding: "20px", 
              textAlign: "center", 
              color: "#666", 
              fontStyle: "italic" 
            }}>
              No problems detected. {connectionStatus === 'connected' ? 'All good!' : 'Connect to LSP server to see diagnostics.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}