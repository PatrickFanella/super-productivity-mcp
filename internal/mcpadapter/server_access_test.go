package mcpadapter

import (
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/pluginipc"
)

func newServerWith(t *testing.T, bridge domain.Bridge, opts Options) *Server {
	t.Helper()
	cat, err := catalog.Load()
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	return NewWithOptions(slog.New(slog.NewTextHandler(io.Discard, nil)), bridge, cat, opts)
}

func listedTools(t *testing.T, s *Server) map[string]map[string]any {
	t.Helper()
	reply := runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	out := map[string]map[string]any{}
	for _, raw := range reply["result"].(map[string]any)["tools"].([]any) {
		tool := raw.(map[string]any)
		out[tool["name"].(string)] = tool
	}
	return out
}

func callResult(t *testing.T, s *Server, name, args string) map[string]any {
	t.Helper()
	return runRPC(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+name+`","arguments":`+args+`}}`)["result"].(map[string]any)
}

func errorCode(t *testing.T, result map[string]any) string {
	t.Helper()
	if result["isError"] != true {
		t.Fatalf("expected an error result, got %#v", result)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	var te domain.TypedError
	if err := json.Unmarshal([]byte(text), &te); err != nil {
		t.Fatalf("error text is not a typed error: %q", text)
	}
	return te.Code
}

func TestToolsListCarriesTitleAndAnnotations(t *testing.T) {
	tools := listedTools(t, newServer(t, &stubBridge{}))
	getTasks := tools["get_tasks"]
	if getTasks["title"] != "List tasks" {
		t.Fatalf("title %v", getTasks["title"])
	}
	ann := getTasks["annotations"].(map[string]any)
	if ann["readOnlyHint"] != true || ann["destructiveHint"] != false || ann["openWorldHint"] != false || ann["title"] != "List tasks" {
		t.Fatalf("annotations %#v", ann)
	}
	if !strings.Contains(getTasks["description"].(string), "not instructions") {
		t.Fatalf("read tool description lacks the untrusted-data note")
	}
	deleteAnn := tools["delete_task"]["annotations"].(map[string]any)
	if deleteAnn["destructiveHint"] != true || deleteAnn["readOnlyHint"] != false {
		t.Fatalf("delete_task annotations %#v", deleteAnn)
	}
}

func TestAliasesAreListedAndDispatchToTheSameAction(t *testing.T) {
	tools := listedTools(t, newServer(t, &stubBridge{}))
	for alias, base := range map[string]string{"list_tasks": "get_tasks", "list_projects": "get_projects", "list_tags": "get_tags"} {
		entry, ok := tools[alias]
		if !ok {
			t.Fatalf("alias %s not listed", alias)
		}
		if !strings.Contains(entry["description"].(string), "Alias of "+base) {
			t.Fatalf("alias %s description %q", alias, entry["description"])
		}
	}
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{}}}}
	s := newServer(t, bridge)
	callResult(t, s, "list_tasks", `{"query":"x"}`)
	if bridge.lastReq.Action != "task.list" || bridge.lastReq.Payload["query"] != "x" {
		t.Fatalf("alias dispatched %#v", bridge.lastReq)
	}
}

func TestReadOnlyScopeHidesAndRefusesWrites(t *testing.T) {
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{}}}
	s := newServerWith(t, bridge, Options{Scopes: []string{"read"}})
	tools := listedTools(t, s)
	for _, name := range []string{"get_tasks", "list_tasks", "get_task", "get_status", "check_connection"} {
		if _, ok := tools[name]; !ok {
			t.Fatalf("%s should be listed under read scope", name)
		}
	}
	for _, name := range []string{"create_task", "update_task", "delete_task", "start_task"} {
		if _, ok := tools[name]; ok {
			t.Fatalf("%s should be hidden under read scope", name)
		}
	}
	bridge.lastReq = domain.Request{}
	if code := errorCode(t, callResult(t, s, "update_task", `{"taskId":"a","title":"b"}`)); code != "NOT_PERMITTED" {
		t.Fatalf("code %s", code)
	}
	if bridge.lastReq.Action != "" {
		t.Fatalf("refused tool reached the bridge: %#v", bridge.lastReq)
	}
}

func TestCreateScopeAllowsOnlyCreationAndStatus(t *testing.T) {
	tools := listedTools(t, newServerWith(t, &stubBridge{}, Options{Scopes: []string{"create"}}))
	for _, name := range []string{"create_task", "create_task_with_subtasks", "get_status"} {
		if _, ok := tools[name]; !ok {
			t.Fatalf("%s should be listed under create scope", name)
		}
	}
	for _, name := range []string{"get_tasks", "update_task"} {
		if _, ok := tools[name]; ok {
			t.Fatalf("%s should be hidden under create scope", name)
		}
	}
	res := runRPC(t, newServerWith(t, &stubBridge{}, Options{Scopes: []string{"create"}}), `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)
	if got := res["result"].(map[string]any)["resources"].([]any); len(got) != 0 {
		t.Fatalf("resources listed without read scope: %d", len(got))
	}
}

func TestWithoutNotesScopeNotesAreRedactedAndSearchIsTitleOnly(t *testing.T) {
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{
		"tasks": []any{map[string]any{"id": "a", "title": "Alpha", "notes": "secret", "noteLength": float64(6)}},
	}}}
	s := newServerWith(t, bridge, Options{Scopes: []string{"read"}})
	result := callResult(t, s, "get_tasks", `{"search":"alp"}`)
	if bridge.lastReq.Payload["searchNotes"] != false {
		t.Fatalf("searchNotes not forced off: %#v", bridge.lastReq.Payload)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if strings.Contains(text, "secret") || strings.Contains(text, `"notes"`) {
		t.Fatalf("notes leaked: %s", text)
	}
	if !strings.Contains(text, "noteLength") {
		t.Fatalf("noteLength should be kept: %s", text)
	}
	task := result["structuredContent"].(map[string]any)["tasks"].([]any)[0].(map[string]any)
	if _, ok := task["notes"]; ok {
		t.Fatalf("notes leaked in structuredContent")
	}

	full := newServer(t, bridge)
	callResult(t, full, "get_tasks", `{"search":"alp"}`)
	if _, set := bridge.lastReq.Payload["searchNotes"]; set {
		t.Fatalf("searchNotes should not be set with the notes scope")
	}
}

func TestGetStatusReportsScopesAndSurvivesBridgeFailure(t *testing.T) {
	ok := newServerWith(t, &stubBridge{resp: domain.Response{Result: map[string]any{"isReady": true, "protocolVersion": "2.0"}}}, Options{Scopes: []string{"read", "create"}})
	result := callResult(t, ok, "get_status", `{}`)
	sc := result["structuredContent"].(map[string]any)
	if sc["isReady"] != true || sc["protocolVersion"] != "2.0" {
		t.Fatalf("status %#v", sc)
	}
	if got := sc["grantedScopes"].([]any); len(got) != 2 || got[0] != "read" || got[1] != "create" {
		t.Fatalf("grantedScopes %#v", got)
	}

	down := newServerWith(t, &stubBridge{err: pluginipc.ErrPluginStalled}, Options{Scopes: []string{"read"}})
	result = callResult(t, down, "get_status", `{}`)
	if result["isError"] != false {
		t.Fatalf("bridge failure should not be a tool error: %#v", result)
	}
	sc = result["structuredContent"].(map[string]any)
	if sc["isReady"] != false || sc["error"].(map[string]any)["code"] != "PLUGIN_STALLED" {
		t.Fatalf("status when down %#v", sc)
	}
}

func TestTimeoutOnNonIdempotentWriteIsOutcomeUnknown(t *testing.T) {
	s := newServer(t, &stubBridge{err: pluginipc.ErrTimeout})
	if code := errorCode(t, callResult(t, s, "create_task", `{"title":"x"}`)); code != "OUTCOME_UNKNOWN" {
		t.Fatalf("create_task timeout code %s", code)
	}
	if code := errorCode(t, callResult(t, s, "get_tasks", `{}`)); code != "TIMEOUT" {
		t.Fatalf("read timeout code %s", code)
	}
	if code := errorCode(t, callResult(t, s, "complete_task", `{"taskId":"a"}`)); code != "TIMEOUT" {
		t.Fatalf("idempotent write timeout code %s", code)
	}
	// Not consumed: safe to retry, so the original error stays.
	stalled := newServer(t, &stubBridge{err: pluginipc.ErrPluginStalled})
	if code := errorCode(t, callResult(t, stalled, "create_task", `{"title":"x"}`)); code != "PLUGIN_STALLED" {
		t.Fatalf("stalled code %s", code)
	}
}

func TestResponseCap(t *testing.T) {
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{map[string]any{"title": strings.Repeat("x", 500)}}}}}
	capped := newServerWith(t, bridge, Options{Scopes: catalog.Scopes, MaxResponseBytes: 100})
	if code := errorCode(t, callResult(t, capped, "get_tasks", `{}`)); code != "RESPONSE_TOO_LARGE" {
		t.Fatalf("code %s", code)
	}
	if result := callResult(t, newServer(t, bridge), "get_tasks", `{}`); result["isError"] != false {
		t.Fatalf("uncapped server should succeed: %#v", result)
	}
}

func TestCreateTaskSchemaValidatesScheduling(t *testing.T) {
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{"taskId": "t"}}}
	s := newServer(t, bridge)
	if code := errorCode(t, callResult(t, s, "create_task", `{"title":"x","dueDate":"03/12/2026"}`)); code != "INVALID_ARGS" {
		t.Fatalf("bad dueDate code %s", code)
	}
	if code := errorCode(t, callResult(t, s, "create_task", `{"title":"x","repeat":{"cycle":"weekly","days":["mon"]}}`)); code != "INVALID_ARGS" {
		t.Fatalf("unknown repeat key code %s", code)
	}
	result := callResult(t, s, "create_task", `{"title":"x #y","literal":true,"dueDate":"2026-12-03","dueTime":"09:30","repeat":{"cycle":"weekly","weekdays":["mon"]}}`)
	if result["isError"] != false {
		t.Fatalf("valid create rejected: %#v", result)
	}
	if bridge.lastReq.Payload["literal"] != true || bridge.lastReq.Payload["dueTime"] != "09:30" {
		t.Fatalf("payload %#v", bridge.lastReq.Payload)
	}
}
