package bridge

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type noteServer struct {
	mu    sync.Mutex
	paths []string
	notes []map[string]any
}

func newNoteServer(t *testing.T) (*noteServer, *Router) {
	t.Helper()
	s := &noteServer{notes: []map[string]any{
		{"id": "fx-note-project", "content": "Fixture project note body", "projectId": "fixture-project-alpha", "isPinnedToToday": false, "imgUrl": "x"},
		{"id": "fx-note-today", "content": "Fixture Today note body", "projectId": nil, "isPinnedToToday": true},
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.paths = append(s.paths, r.Method+" "+r.URL.RequestURI())
		ok := func(data any) {
			b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
			_, _ = w.Write(b)
		}
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) == 1 {
			out := []map[string]any{}
			for _, n := range s.notes {
				if p := r.URL.Query().Get("projectId"); p == "" || n["projectId"] == p {
					out = append(out, n)
				}
			}
			ok(out)
			return
		}
		for _, n := range s.notes {
			if n["id"] == parts[1] {
				ok(n)
				return
			}
		}
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"NOTE_NOT_FOUND","message":"Note not found"}}`)
	}))
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func TestListNotesThroughREST(t *testing.T) {
	s, r := newNoteServer(t)
	resp, err := call(r, "note.list", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	notes := resp.Result["notes"].([]any)
	today := notes[1].(map[string]any)
	if len(notes) != 2 || today["projectId"] != nil || today["isPinnedToToday"] != true {
		t.Fatalf("notes %#v", notes)
	}
	if _, leaked := notes[0].(map[string]any)["imgUrl"]; leaked {
		t.Fatalf("unexpected fields: %#v", notes[0])
	}
	resp, _ = call(r, "note.list", map[string]any{"project_id": "fixture-project-alpha"})
	if len(resp.Result["notes"].([]any)) != 1 || s.paths[len(s.paths)-1] != "GET /notes?projectId=fixture-project-alpha" {
		t.Fatalf("filtered %#v paths %v", resp.Result, s.paths)
	}
	resp, _ = call(r, "note.list", map[string]any{"pinnedToToday": true})
	if len(resp.Result["notes"].([]any)) != 1 {
		t.Fatalf("pinned %#v", resp.Result)
	}
}

func TestGetNoteThroughREST(t *testing.T) {
	_, r := newNoteServer(t)
	resp, err := call(r, "note.get", map[string]any{"noteId": "fx-note-project"})
	if err != nil || resp.Result["note"].(map[string]any)["projectId"] != "fixture-project-alpha" {
		t.Fatalf("get %#v %v", resp.Result, err)
	}
	for payload, want := range map[string]string{`{"noteId":"fx-missing"}`: "NOTE_NOT_FOUND", `{}`: "INVALID_REQUEST", `{"noteId":".."}`: "INVALID_REQUEST"} {
		var p map[string]any
		_ = json.Unmarshal([]byte(payload), &p)
		if _, err := call(r, "note.get", p); code(t, err) != want {
			t.Errorf("%s: %v", payload, err)
		}
	}
}

func TestNotesUsePluginWithoutREST(t *testing.T) {
	plugin := &fakePlugin{result: map[string]any{"notes": []any{}}}
	r := NewWith(nil, func() (domain.Bridge, error) { return plugin, nil })
	if _, err := call(r, "note.list", map[string]any{}); err != nil || len(plugin.calls) != 1 {
		t.Fatalf("plugin path: %v %#v", err, plugin.calls)
	}
}
