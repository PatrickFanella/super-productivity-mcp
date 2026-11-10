package mcpadapter

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

func noteResult() domain.Response {
	return domain.Response{Result: map[string]any{"notes": []any{map[string]any{"id": "fx-note-today", "content": "Fixture Today note body", "projectId": nil, "isPinnedToToday": true}}}}
}

func TestNoteToolsNeedBothReadAndNotes(t *testing.T) {
	for _, grant := range [][]string{{"read"}, {"notes"}, {"read", "create", "write"}} {
		bridge := &stubBridge{resp: noteResult()}
		s := newServerWith(t, bridge, Options{Scopes: grant})
		tools := listedTools(t, s)
		for _, name := range []string{"get_notes", "get_note"} {
			if _, listed := tools[name]; listed {
				t.Errorf("grant %v lists %s", grant, name)
			}
			if code := errorCode(t, callResult(t, s, name, `{"noteId":"fx-note-today"}`)); code != "NOT_PERMITTED" {
				t.Errorf("grant %v: %s code %s", grant, name, code)
			}
		}
		if bridge.lastReq.Action != "" {
			t.Errorf("grant %v reached the backend: %#v", grant, bridge.lastReq)
		}
	}
	bridge := &stubBridge{resp: noteResult()}
	s := newServerWith(t, bridge, Options{Scopes: []string{"read", "notes"}})
	result := callResult(t, s, "get_notes", `{}`)
	if result["isError"] == true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "Fixture Today note body") {
		t.Fatalf("read+notes: %#v", result)
	}
}

func TestNoteResourceNeedsTheNotesScope(t *testing.T) {
	bridge := &stubBridge{resp: noteResult()}
	readOnly := newServerWith(t, bridge, Options{Scopes: []string{"read"}})
	list := runRPC(t, readOnly, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)
	if strings.Contains(mustJSON(t, list), "sp://notes") {
		t.Fatalf("read-only grant lists sp://notes")
	}
	reply := runRPC(t, readOnly, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://notes"}}`)
	if !strings.Contains(mustJSON(t, reply), "NOT_PERMITTED") || bridge.lastReq.Action != "" {
		t.Fatalf("read-only resource read: %s backend=%#v", mustJSON(t, reply), bridge.lastReq)
	}
	full := newServerWith(t, bridge, Options{Scopes: []string{"read", "notes"}})
	reply = runRPC(t, full, `{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"sp://notes"}}`)
	if !strings.Contains(mustJSON(t, reply), "Fixture Today note body") {
		t.Fatalf("read+notes resource read: %s", mustJSON(t, reply))
	}
}

func TestRedactionRemovesNoteContentWithoutTheNotesScope(t *testing.T) {
	// A read tool whose result carries a standalone note body, for example a
	// future tool or resource: the body must not reach a grant without notes.
	bridge := &stubBridge{resp: domain.Response{Result: map[string]any{"tasks": []any{map[string]any{"id": "a", "notes": "task body", "content": "note body", "noteLength": 9}}}}}
	s := newServerWith(t, bridge, Options{Scopes: []string{"read"}})
	text := callResult(t, s, "get_tasks", `{}`)["content"].([]any)[0].(map[string]any)["text"].(string)
	if strings.Contains(text, "note body") || strings.Contains(text, "task body") || !strings.Contains(text, "noteLength") {
		t.Fatalf("redacted text %s", text)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
