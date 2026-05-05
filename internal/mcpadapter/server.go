// Package mcpadapter speaks the MCP JSON-RPC 2.0 wire protocol over stdio
// and dispatches tools/call requests through the catalog into the bridge.
package mcpadapter

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
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

// MCP JSON-RPC 2.0 wire types.

type rpcMsg struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type toolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func (s *Server) reply(enc *json.Encoder, id json.RawMessage, result any) {
	_ = enc.Encode(rpcMsg{JSONRPC: "2.0", ID: id, Result: result})
}

func (s *Server) replyErr(enc *json.Encoder, id json.RawMessage, code int, msg string) {
	_ = enc.Encode(rpcMsg{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}})
}

// toolListEntry is the shape MCP clients expect from tools/list.
type toolListEntry struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func (s *Server) toolList() []toolListEntry {
	tools := s.catalog.MCPTools()
	out := make([]toolListEntry, len(tools))
	for i, t := range tools {
		out[i] = toolListEntry{Name: t.MCPName, Description: t.Description, InputSchema: t.InputSchema}
	}
	return out
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
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "super-productivity", "version": version.BinaryVersion},
			})

		case "tools/list":
			s.reply(enc, msg.ID, map[string]any{"tools": s.toolList()})

		case "tools/call":
			s.handleToolsCall(ctx, enc, msg)

		default:
			s.replyErr(enc, msg.ID, -32601, fmt.Sprintf("method not found: %s", msg.Method))
		}
	}
	return scanner.Err()
}

func (s *Server) handleToolsCall(ctx context.Context, enc *json.Encoder, msg rpcMsg) {
	var p toolCallParams
	if err := json.Unmarshal(msg.Params, &p); err != nil {
		s.replyErr(enc, msg.ID, -32602, "invalid params: "+err.Error())
		return
	}
	tool := s.catalog.LookupMCP(p.Name)
	if tool == nil {
		s.reply(enc, msg.ID, map[string]any{
			"content": []contentBlock{{Type: "text", Text: fmt.Sprintf("unknown tool %q", p.Name)}},
			"isError": true,
		})
		return
	}
	args := p.Arguments
	if args == nil {
		args = map[string]any{}
	}
	if err := tool.Validate(args); err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	resp, err := s.bridge.Call(ctx, domain.Request{Action: tool.Action, Payload: args})
	if err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	b, _ := json.Marshal(resp.Result)
	s.reply(enc, msg.ID, map[string]any{
		"content": []contentBlock{{Type: "text", Text: string(b)}},
		"isError": false,
	})
}

// errorContent renders any error (typed or plain) as an MCP isError reply.
// Typed errors are surfaced as JSON so callers can inspect code/retryable.
func errorContent(err error) map[string]any {
	var te domain.TypedError
	if errors.As(err, &te) {
		b, _ := json.Marshal(te)
		return map[string]any{
			"content": []contentBlock{{Type: "text", Text: string(b)}},
			"isError": true,
		}
	}
	return map[string]any{
		"content": []contentBlock{{Type: "text", Text: err.Error()}},
		"isError": true,
	}
}
