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
	capabilities := result["capabilities"].(map[string]any)
	if _, ok := capabilities["resources"]; !ok {
		t.Fatalf("expected resources capability, got %#v", capabilities)
	}
}

func TestToolsListIsCatalogDriven(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	tools := reply["result"].(map[string]any)["tools"].([]any)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(tools) != len(cat.MCPTools()) {
		t.Fatalf("expected %d tools, got %d", len(cat.MCPTools()), len(tools))
	}
	var foundOutputSchema bool
	for _, raw := range tools {
		tool := raw.(map[string]any)
		if tool["name"] == "get_tasks" {
			_, foundOutputSchema = tool["outputSchema"].(map[string]any)
		}
	}
	if !foundOutputSchema {
		t.Fatalf("expected get_tasks outputSchema in tools/list")
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

func TestToolsCallRejectsInvalidOutput(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"results": []any{}}}}
	s := newServer(t, br)
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_tasks","arguments":{}}}`)
	result := reply["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatalf("expected isError=true, got %#v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "INVALID_OUTPUT") {
		t.Fatalf("expected INVALID_OUTPUT, got %q", text)
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

func TestResourcesListExposesSuperProductivityResources(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)
	resources := reply["result"].(map[string]any)["resources"].([]any)
	uris := make(map[string]bool)
	for _, raw := range resources {
		res := raw.(map[string]any)
		uris[res["uri"].(string)] = true
	}
	for _, uri := range []string{"sp://projects", "sp://tags", "sp://tasks/active", "sp://tasks/archived", "sp://tasks/current-context", "sp://tasks/today", "sp://tasks/overdue", "sp://tasks/unscheduled", "sp://schedule/today", "sp://schedule/health", "sp://counters"} {
		if !uris[uri] {
			t.Fatalf("missing resource %s in %#v", uri, resources)
		}
	}
}

func TestResourcesReadDispatchesToBridge(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{map[string]any{"id": "t1"}}}}}
	s := newServer(t, br)
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://tasks/overdue"}}`)
	if br.lastReq.Action != "task.list" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	if br.lastReq.Payload["overdue"] != true || br.lastReq.Payload["includeDone"] != false {
		t.Fatalf("unexpected payload %#v", br.lastReq.Payload)
	}
	contents := reply["result"].(map[string]any)["contents"].([]any)
	content := contents[0].(map[string]any)
	if content["uri"] != "sp://tasks/overdue" || content["mimeType"] != "application/json" {
		t.Fatalf("unexpected content metadata %#v", content)
	}
	if !strings.Contains(content["text"].(string), `"t1"`) {
		t.Fatalf("unexpected content text %q", content["text"])
	}
}

func TestScheduleResourceReadsDispatchToBridge(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"counts": map[string]any{"overdue": 1}}}}
	s := newServer(t, br)
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://schedule/health"}}`)
	if br.lastReq.Action != "task.scheduleHealth" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	contents := reply["result"].(map[string]any)["contents"].([]any)
	content := contents[0].(map[string]any)
	if content["uri"] != "sp://schedule/health" || content["mimeType"] != "application/json" {
		t.Fatalf("unexpected content metadata %#v", content)
	}
	if !strings.Contains(content["text"].(string), `"overdue"`) {
		t.Fatalf("unexpected content text %q", content["text"])
	}
}

func TestTasksUnscheduledResourceDispatchesTopLevelFilter(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{}}}}
	s := newServer(t, br)
	_ = runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://tasks/unscheduled"}}`)
	if br.lastReq.Action != "task.findUnscheduledActive" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	if br.lastReq.Payload["topLevelOnly"] != true {
		t.Fatalf("unexpected payload %#v", br.lastReq.Payload)
	}
}

func TestArchivedAndCounterResourcesDispatchToBridge(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"ok": true}}}
	s := newServer(t, br)
	_ = runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://tasks/archived"}}`)
	if br.lastReq.Action != "task.listArchived" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	_ = runRPC(t, s, `{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"sp://counters"}}`)
	if br.lastReq.Action != "counter.list" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
}

func TestCurrentContextResourceDispatchesIncompleteFilter(t *testing.T) {
	br := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{}}}}
	s := newServer(t, br)
	_ = runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://tasks/current-context"}}`)
	if br.lastReq.Action != "task.listCurrentContext" {
		t.Fatalf("dispatched action %q", br.lastReq.Action)
	}
	if br.lastReq.Payload["includeDone"] != false {
		t.Fatalf("unexpected payload %#v", br.lastReq.Payload)
	}
}

func TestResourcesReadRejectsUnknownURI(t *testing.T) {
	s := newServer(t, &stubBridge{})
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://missing"}}`)
	if reply["error"] == nil {
		t.Fatalf("expected JSON-RPC error, got %#v", reply)
	}
}
