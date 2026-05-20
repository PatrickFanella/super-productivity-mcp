// Package mcpadapter speaks the MCP JSON-RPC 2.0 wire protocol over stdio
// and dispatches tools/call requests through the catalog into the bridge.
package mcpadapter

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/version"
)

// Server is the MCP JSON-RPC server. It holds no per-request state and is
// safe to share for the lifetime of the process.
type Server struct {
	logger  *slog.Logger
	bridge  domain.Bridge
	catalog *catalog.Catalog
}

// New wires a server against a bridge and a loaded catalog.
func New(logger *slog.Logger, bridge domain.Bridge, cat *catalog.Catalog) *Server {
	return &Server{logger: logger, bridge: bridge, catalog: cat}
}

// Serve reads JSON-RPC messages line-by-line from in and writes replies to out.
// Returns scanner errors if the underlying reader fails.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	// MCP clients can send sizeable arguments (e.g. long task notes); raise
	// the default 64 KiB token cap to 1 MiB so we don't truncate them.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var msg rpcMsg
		if err := json.Unmarshal(line, &msg); err != nil {
			s.logger.Error("invalid json", "error", err)
			continue
		}

		// JSON-RPC notifications have no id — do not respond.
		if msg.ID == nil {
			continue
		}

		switch msg.Method {
		case "initialize":
			s.reply(enc, msg.ID, map[string]any{
				"protocolVersion": version.MCPProtocolVersion,
				"capabilities":    map[string]any{"tools": map[string]any{}, "resources": map[string]any{}},
				"serverInfo":      map[string]any{"name": "super-productivity", "version": version.BinaryVersion},
			})

		case "tools/list":
			s.reply(enc, msg.ID, map[string]any{"tools": s.toolList()})

		case "tools/call":
			s.handleToolsCall(ctx, enc, msg)

		case "resources/list":
			s.reply(enc, msg.ID, map[string]any{"resources": s.resourceList()})

		case "resources/read":
			s.handleResourcesRead(ctx, enc, msg)

		default:
			s.replyErr(enc, msg.ID, -32601, fmt.Sprintf("method not found: %s", msg.Method))
		}
	}
	return scanner.Err()
}
