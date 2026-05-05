package mcpadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type stubBridge struct {
	lastReq domain.Request
	resp    domain.Response
	err     error
}

func (s *stubBridge) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	s.lastReq = req
	return s.resp, s.err
}

func newServer(t *testing.T, bridge domain.Bridge) *Server {
	t.Helper()
	cat, err := catalog.Load()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), bridge, cat)
}

// runRPC pushes a single JSON-RPC request through Serve and returns the reply.
func runRPC(t *testing.T, s *Server, body string) map[string]any {
	t.Helper()
	in := bytes.NewBufferString(body + "\n")
	var out bytes.Buffer
	if err := s.Serve(context.Background(), in, &out); err != nil {
		t.Fatalf("serve: %v", err)
	}
	var reply map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &reply); err != nil {
		t.Fatalf("decode reply %q: %v", out.String(), err)
	}
	return reply
}

func TestInitializeAdvertisesMCPVersion(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	result := reply["result"].(map[string]any)
	if v, _ := result["protocolVersion"].(string); v != "2024-11-05" {
		t.Fatalf("protocolVersion %v", result["protocolVersion"])
	}
}

func TestToolsListIsCatalogDriven(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	tools := reply["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 18 {
		t.Fatalf("expected 18 tools, got %d", len(tools))
	}
}

func TestToolsCallDispatchesAction(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"taskId": "abc"}}}
	s := newServer(t, br)
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"hello"}}}`)
	if br.lastReq.Action != "task.create" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	result := reply["result"].(map[string]any)
	if result["isError"] != false {
		t.Fatalf("expected isError=false, got %v", result)
	}
}

func TestToolsCallRejectsInvalidArgs(t *testing.T) {
	s := newServer(t, &stubBridge{})
	// create_task requires `title`; sending without should fail validation
	// before reaching the bridge.
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_task","arguments":{}}}`)
	result := reply["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError=true, got %#v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "INVALID_ARGS") {
		t.Fatalf("expected INVALID_ARGS, got %q", text)
	}
}

func TestToolsCallUnknownTool(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"made_up","arguments":{}}}`)
	result := reply["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError=true")
	}
}
