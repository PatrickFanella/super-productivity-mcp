package bridge

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

// noteStore is a stateful fake of the v20 note routes.
type noteStore struct {
	mu     sync.Mutex
	notes  map[string]map[string]any
	writes int
	next   int
}

func newNoteStore(t *testing.T) (*noteStore, *Router) {
	t.Helper()
	s := &noteStore{notes: map[string]map[string]any{
		"fx-note-project": {"id": "fx-note-project", "content": "Fixture project note body", "projectId": "fixture-project-alpha", "isPinnedToToday": false},
		"fx-note-today":   {"id": "fx-note-today", "content": "Fixture Today note body", "projectId": nil, "isPinnedToToday": true},
	}}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func (s *noteStore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ok := func(status int, data any) {
		w.WriteHeader(status)
		b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
		_, _ = w.Write(b)
	}
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"`+code+`","message":"`+code+`"}}`)
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if r.Method == http.MethodPost {
		s.writes++
		s.next++
		id := "fx-note-new-" + string(rune('0'+s.next))
		note := map[string]any{"id": id, "content": body["content"], "projectId": body["projectId"], "isPinnedToToday": body["isPinnedToToday"] == true}
		s.notes[id] = note
		ok(201, note)
		return
	}
	note := s.notes[parts[1]]
	if note == nil {
		fail(404, "NOTE_NOT_FOUND")
		return
	}
	switch r.Method {
	case http.MethodGet:
		ok(200, note)
	case http.MethodPatch:
		s.writes++
		for k, v := range body {
			note[k] = v
		}
		ok(200, note)
	case http.MethodDelete:
		s.writes++
		delete(s.notes, parts[1])
		ok(200, map[string]any{"deleted": true, "id": parts[1]})
	}
}

func TestCreateNotesInAcceptedPlacements(t *testing.T) {
	s, r := newNoteStore(t)
	resp, err := call(r, "note.create", map[string]any{"content": "Fixture new project note", "projectId": "fixture-project-beta"})
	if err != nil || resp.Result["created"] != true || resp.Result["projectId"] != "fixture-project-beta" {
		t.Fatalf("project note %#v %v", resp.Result, err)
	}
	if _, leaked := resp.Result["content"]; leaked {
		t.Fatalf("create returned the body")
	}
	resp, err = call(r, "note.create", map[string]any{"content": "Fixture Today note", "projectId": nil, "isPinnedToToday": true})
	if err != nil || resp.Result["projectId"] != nil || resp.Result["isPinnedToToday"] != true {
		t.Fatalf("Today note %#v %v", resp.Result, err)
	}
	if len(s.notes) != 4 || s.notes["fx-note-project"]["content"] != "Fixture project note body" {
		t.Fatalf("unrelated notes changed: %#v", s.notes)
	}
}

func TestNoteWritesRefuseInvalidPlacementBeforeWriting(t *testing.T) {
	cases := []struct {
		action  string
		payload map[string]any
	}{
		{"note.create", map[string]any{"content": "Fixture nowhere"}},
		{"note.create", map[string]any{"content": "Fixture nowhere", "isPinnedToToday": false}},
		{"note.create", map[string]any{"content": "   ", "projectId": "fixture-project-alpha"}},
		{"note.update", map[string]any{"noteId": "fx-note-project", "projectId": "fixture-project-beta", "content": "x"}},
		{"note.update", map[string]any{"noteId": "fx-note-project", "projectId": "fixture-project-beta", "isPinnedToToday": true}},
		{"note.update", map[string]any{"noteId": "fx-note-today", "isPinnedToToday": false}},
		{"note.update", map[string]any{"noteId": "fx-note-project"}},
	}
	for _, c := range cases {
		s, r := newNoteStore(t)
		if _, err := call(r, c.action, c.payload); err == nil {
			t.Errorf("%s %v: no error", c.action, c.payload)
		}
		if s.writes != 0 {
			t.Errorf("%s %v: %d writes", c.action, c.payload, s.writes)
		}
	}
}

func TestUpdateNoteMovesAndEditsSeparately(t *testing.T) {
	s, r := newNoteStore(t)
	resp, err := call(r, "note.update", map[string]any{"noteId": "fx-note-project", "projectId": "fixture-project-beta"})
	if err != nil || resp.Result["moved"] != true || s.notes["fx-note-project"]["projectId"] != "fixture-project-beta" {
		t.Fatalf("move %#v %v", resp.Result, err)
	}
	// Sending the current project with other fields is not a move.
	resp, err = call(r, "note.update", map[string]any{"noteId": "fx-note-project", "projectId": "fixture-project-beta", "content": "Fixture edited", "isPinnedToToday": true})
	if err != nil || resp.Result["moved"] != false || s.notes["fx-note-project"]["content"] != "Fixture edited" {
		t.Fatalf("edit %#v %v", resp.Result, err)
	}
	if _, leaked := resp.Result["content"]; leaked {
		t.Fatalf("update returned the body")
	}
	if s.notes["fx-note-today"]["content"] != "Fixture Today note body" {
		t.Fatalf("unrelated note changed")
	}
}

func TestDeleteNoteAndMissingNotes(t *testing.T) {
	s, r := newNoteStore(t)
	resp, err := call(r, "note.delete", map[string]any{"noteId": "fx-note-today"})
	if err != nil || resp.Result["deleted"] != true || s.notes["fx-note-today"] != nil {
		t.Fatalf("delete %#v %v", resp.Result, err)
	}
	if _, err := call(r, "note.delete", map[string]any{"noteId": "fx-note-today"}); code(t, err) != "NOTE_NOT_FOUND" {
		t.Fatalf("second delete: %v", err)
	}
	if _, err := call(r, "note.update", map[string]any{"noteId": "fx-missing", "content": "x"}); code(t, err) != "NOTE_NOT_FOUND" {
		t.Fatalf("update missing: %v", err)
	}
}

func TestNoteWriteFailuresAreNotRetried(t *testing.T) {
	srv := newRESTServer(t, 504, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"x"}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	if _, err := call(r, "note.create", map[string]any{"content": "Fixture", "isPinnedToToday": true}); code(t, err) != localrest.CodeOutcomeUnknown {
		t.Fatalf("create: %v", err)
	}
	if srv.requests.Load() != 1 {
		t.Fatalf("requests %d", srv.requests.Load())
	}
	if _, err := call(NewWith(nil, unavailablePlugin(t)), "note.delete", map[string]any{"noteId": "x"}); code(t, err) != "UNSUPPORTED_ACTION" {
		t.Fatalf("no REST: %v", err)
	}
}

func TestNoteWriteScopesThroughMCP(t *testing.T) {
	_, r := newNoteStore(t)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	create := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_note","arguments":{"content":"Fixture capture","isPinnedToToday":true}}}` + "\n"
	del := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"delete_note","arguments":{"noteId":"fx-note-project"}}}` + "\n"
	captureOnly := mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"create"}})
	if reply := serveOne(t, captureOnly, create); strings.Contains(reply, `"isError":true`) || strings.Contains(reply, "Fixture capture") {
		t.Fatalf("create-only grant: %s", reply)
	}
	if reply := serveOne(t, captureOnly, del); !strings.Contains(reply, "NOT_PERMITTED") {
		t.Fatalf("create-only delete: %s", reply)
	}
	extra := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_note","arguments":{"content":"x","isPinnedToToday":true,"color":"red"}}}` + "\n"
	if reply := serveOne(t, captureOnly, extra); !strings.Contains(reply, `"isError":true`) {
		t.Fatalf("unknown field accepted: %s", reply)
	}
}
