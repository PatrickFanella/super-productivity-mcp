package mcpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type toolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type resourceReadParams struct {
	URI string `json:"uri"`
}

const statusAction = "bridge.status"

var (
	errNotPermitted = domain.TypedError{
		Code:      "NOT_PERMITTED",
		Message:   "This server's access scopes do not allow this tool. Adjust SP_MCP_SCOPES to grant it.",
		Retryable: false,
	}
	errResourceNotPermitted = domain.TypedError{
		Code:      "NOT_PERMITTED",
		Message:   "Resources need the read scope. Adjust SP_MCP_SCOPES to grant it.",
		Retryable: false,
	}
	errOutcomeUnknown = domain.TypedError{
		Code:      "OUTCOME_UNKNOWN",
		Message:   "The plugin took the request but did not answer in time, so the change may or may not have been applied. Check the current state before retrying.",
		Retryable: false,
	}
)

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
	if !s.allowed(tool) {
		s.reply(enc, msg.ID, errorContent(withAction(errNotPermitted, tool)))
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
	payload := cloneMap(args)
	if tool.ReadOnly() && !s.scopes[catalog.ScopeNotes] {
		// A text search over notes would reveal their contents.
		payload["searchNotes"] = false
	}
	resp, err := s.bridge.Call(ctx, domain.Request{Action: tool.Action, Payload: payload})
	if tool.Action == statusAction {
		s.replyResult(enc, msg.ID, s.statusResult(resp, err))
		return
	}
	if err != nil {
		s.reply(enc, msg.ID, errorContent(outcomeError(tool, err)))
		return
	}
	if err := tool.ValidateOutput(resp.Result); err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	s.replyResult(enc, msg.ID, s.redact(resp.Result))
}

// statusResult builds get_status's answer. A bridge failure is reported as
// isReady:false, not as a tool error, so a client can always learn its grant.
func (s *Server) statusResult(resp domain.Response, err error) map[string]any {
	out := map[string]any{"isReady": false, "grantedScopes": s.grantedScopes()}
	if err != nil {
		var te domain.TypedError
		if errors.As(err, &te) {
			out["error"] = map[string]any{"code": te.Code, "message": te.Message}
		} else {
			out["error"] = map[string]any{"code": "BRIDGE_ERROR", "message": err.Error()}
		}
		return out
	}
	for k, v := range resp.Result {
		out[k] = v
	}
	out["grantedScopes"] = s.grantedScopes()
	if ready, ok := resp.Result["isReady"].(bool); ok {
		out["isReady"] = ready
	} else {
		out["isReady"] = true
	}
	return out
}

// outcomeError turns a timeout after the plugin consumed a non-idempotent
// write into OUTCOME_UNKNOWN, so the client checks instead of retrying and
// creating a duplicate. Read-only and idempotent tools keep the original
// (retryable) timeout.
func outcomeError(tool *catalog.Tool, err error) error {
	var te domain.TypedError
	if errors.As(err, &te) && te.Code == "TIMEOUT" && !tool.ReadOnly() && !tool.Idempotent() {
		return withAction(errOutcomeUnknown, tool)
	}
	return err
}

func withAction(te domain.TypedError, tool *catalog.Tool) domain.TypedError {
	te.Details = map[string]any{"action": tool.Action, "tool": tool.MCPName}
	return te
}

// replyResult sends a successful tool result as text plus structuredContent,
// or RESPONSE_TOO_LARGE when it exceeds the configured cap.
func (s *Server) replyResult(enc *json.Encoder, id json.RawMessage, result map[string]any) {
	b, _ := json.Marshal(result)
	if s.opts.MaxResponseBytes > 0 && len(b) > s.opts.MaxResponseBytes {
		s.reply(enc, id, errorContent(tooLarge(len(b), s.opts.MaxResponseBytes)))
		return
	}
	s.reply(enc, id, map[string]any{
		"content":           []contentBlock{{Type: "text", Text: string(b)}},
		"structuredContent": result,
		"isError":           false,
	})
}

func tooLarge(size, limit int) domain.TypedError {
	return domain.TypedError{
		Code:      "RESPONSE_TOO_LARGE",
		Message:   fmt.Sprintf("The result is %d bytes, over the %d-byte limit. Narrow the request with filters, limit or fields.", size, limit),
		Retryable: false,
	}
}

func (s *Server) handleResourcesRead(ctx context.Context, enc *json.Encoder, msg rpcMsg) {
	var p resourceReadParams
	if err := json.Unmarshal(msg.Params, &p); err != nil {
		s.replyErr(enc, msg.ID, -32602, "invalid params: "+err.Error())
		return
	}
	res := s.catalog.LookupResource(p.URI)
	if res == nil {
		s.replyErr(enc, msg.ID, -32602, fmt.Sprintf("unknown resource %q", p.URI))
		return
	}
	if !s.scopes[catalog.ScopeRead] {
		s.reply(enc, msg.ID, errorContent(errResourceNotPermitted))
		return
	}
	// A resource backed by a content tool needs that tool's grant as well.
	if tool := s.catalog.LookupAction(res.Action); tool != nil && !s.allowed(tool) {
		s.reply(enc, msg.ID, errorContent(withAction(errNotPermitted, tool)))
		return
	}
	payload := cloneMap(res.Payload)
	if !s.scopes[catalog.ScopeNotes] {
		payload["searchNotes"] = false
	}
	resp, err := s.bridge.Call(ctx, domain.Request{Action: res.Action, Payload: payload})
	if err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	b, _ := json.Marshal(s.redact(resp.Result))
	if s.opts.MaxResponseBytes > 0 && len(b) > s.opts.MaxResponseBytes {
		s.reply(enc, msg.ID, errorContent(tooLarge(len(b), s.opts.MaxResponseBytes)))
		return
	}
	s.reply(enc, msg.ID, map[string]any{
		"contents": []map[string]any{{"uri": res.URI, "mimeType": "application/json", "text": string(b)}},
	})
}

// redact removes every "notes" field (task notes) and "content" field
// (standalone note bodies) from a result when the grant lacks the notes
// scope. Lengths such as noteLength are kept.
func (s *Server) redact(result map[string]any) map[string]any {
	if s.scopes[catalog.ScopeNotes] || result == nil {
		return result
	}
	return stripNotes(result).(map[string]any)
}

func stripNotes(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, x := range t {
			if k == "notes" || k == "content" {
				continue
			}
			out[k] = stripNotes(x)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, x := range t {
			out[i] = stripNotes(x)
		}
		return out
	default:
		return v
	}
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
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
