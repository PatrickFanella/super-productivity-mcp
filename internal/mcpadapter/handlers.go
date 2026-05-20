package mcpadapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type toolCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type resourceReadParams struct {
	URI string `json:"uri"`
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
	if err := tool.ValidateOutput(resp.Result); err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	b, _ := json.Marshal(resp.Result)
	s.reply(enc, msg.ID, map[string]any{
		"content": []contentBlock{{Type: "text", Text: string(b)}},
		"isError": false,
	})
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
	resp, err := s.bridge.Call(ctx, domain.Request{Action: res.Action, Payload: cloneMap(res.Payload)})
	if err != nil {
		s.reply(enc, msg.ID, errorContent(err))
		return
	}
	b, _ := json.Marshal(resp.Result)
	s.reply(enc, msg.ID, map[string]any{
		"contents": []map[string]any{{"uri": res.URI, "mimeType": "application/json", "text": string(b)}},
	})
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
