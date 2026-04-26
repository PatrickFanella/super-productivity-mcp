package mcpadapter

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"

	"github.com/PatrickFanella/super-productivity-mcp/internal/service"
)

type Server struct {
	logger *slog.Logger
	svc    *service.Services
	tools  map[string]func(context.Context, map[string]any) (map[string]any, error)
}

func New(logger *slog.Logger, svc *service.Services) *Server {
	s := &Server{logger: logger, svc: svc, tools: map[string]func(context.Context, map[string]any) (map[string]any, error){}}
	s.registerTaskTools()
	s.registerProjectTools()
	s.registerTagTools()
	s.registerSystemTools()
	return s
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

// toolDefs is returned for tools/list and drives the MCP capability advertisement.
var toolDefs = []map[string]any{
	// Tasks
	{"name": "create_task", "description": "Create a new task in Super Productivity", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"title": map[string]any{"type": "string"}, "projectId": map[string]any{"type": "string"}, "notes": map[string]any{"type": "string"}, "tagIds": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}}},
	{"name": "get_tasks", "description": "List tasks from Super Productivity", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]any{"type": "string"}, "includeCompleted": map[string]any{"type": "boolean"}}}},
	{"name": "get_task", "description": "Get a specific task by ID", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	{"name": "update_task", "description": "Update an existing task", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}, "notes": map[string]any{"type": "string"}, "projectId": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	{"name": "complete_task", "description": "Mark a task as done", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	{"name": "uncomplete_task", "description": "Unmark a task as done", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	{"name": "archive_task", "description": "Archive a task", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	{"name": "add_time_to_task", "description": "Add tracked time to a task (duration in ms)", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "duration": map[string]any{"type": "integer"}}, "required": []string{"id", "duration"}}},
	{"name": "reorder_task", "description": "Reorder a task's position in the list", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "position": map[string]any{"type": "integer"}}, "required": []string{"id"}}},
	// Projects
	{"name": "get_projects", "description": "List all projects", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	{"name": "create_project", "description": "Create a new project", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"title": map[string]any{"type": "string"}}, "required": []string{"title"}}},
	{"name": "update_project", "description": "Update an existing project", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	// Tags
	{"name": "get_tags", "description": "List all tags", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	{"name": "create_tag", "description": "Create a new tag", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"title": map[string]any{"type": "string"}}, "required": []string{"title"}}},
	{"name": "update_tag", "description": "Update an existing tag", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "title": map[string]any{"type": "string"}}, "required": []string{"id"}}},
	// System
	{"name": "show_notification", "description": "Show a notification in Super Productivity", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"message": map[string]any{"type": "string"}}, "required": []string{"message"}}},
	{"name": "bridge_health", "description": "Check if the SP plugin bridge is healthy and responding", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
	{"name": "bridge_capabilities", "description": "Get the SP plugin bridge capabilities and supported actions", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}},
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
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
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "super-productivity", "version": "1.0.0"},
			})

		case "tools/list":
			s.reply(enc, msg.ID, map[string]any{"tools": toolDefs})

		case "tools/call":
			var p toolCallParams
			if err := json.Unmarshal(msg.Params, &p); err != nil {
				s.replyErr(enc, msg.ID, -32602, "invalid params: "+err.Error())
				continue
			}
			h, ok := s.tools[p.Name]
			if !ok {
				s.reply(enc, msg.ID, map[string]any{
					"content": []contentBlock{{Type: "text", Text: fmt.Sprintf("unknown tool %q", p.Name)}},
					"isError": true,
				})
				continue
			}
			result, err := h(ctx, p.Arguments)
			if err != nil {
				s.reply(enc, msg.ID, map[string]any{
					"content": []contentBlock{{Type: "text", Text: err.Error()}},
					"isError": true,
				})
				continue
			}
			b, _ := json.Marshal(result)
			s.reply(enc, msg.ID, map[string]any{
				"content": []contentBlock{{Type: "text", Text: string(b)}},
				"isError": false,
			})

		default:
			s.replyErr(enc, msg.ID, -32601, fmt.Sprintf("method not found: %s", msg.Method))
		}
	}
	return scanner.Err()
}
