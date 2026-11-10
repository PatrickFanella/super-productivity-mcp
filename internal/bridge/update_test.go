package bridge

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// patchServer records PATCH /tasks/:id bodies and answers with a task. A
// deadline of today re-plans the task as the app's setDeadline action does.
type patchServer struct {
	mu     sync.Mutex
	today  string
	bodies []map[string]any
	status int
}

func (s *patchServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.bodies = append(s.bodies, body)
	if s.status != 0 {
		w.WriteHeader(s.status)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"INVALID_INPUT","message":"deadlineRemindAt needs a deadline"}}`)
		return
	}
	task := map[string]any{"id": "fx-deadline-day", "dueDay": nil, "dueWithTime": float64(1794236400000), "remindAt": float64(1794235800000)}
	for k, v := range body {
		task[k] = v
	}
	if task["deadlineDay"] == s.today {
		task["dueDay"], task["dueWithTime"], task["remindAt"] = s.today, nil, nil
	}
	b, _ := json.Marshal(map[string]any{"ok": true, "data": task})
	_, _ = w.Write(b)
}

func newPatchRouter(t *testing.T) (*patchServer, *Router) {
	t.Helper()
	s := &patchServer{today: "2026-11-09"}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func TestMixedDeadlineUpdateIsOneRESTRequest(t *testing.T) {
	s, r := newPatchRouter(t)
	resp, err := call(r, "task.update", map[string]any{"taskId": "fx-deadline-day", "title": "Fixture #12 deadline", "notes": "x", "deadlineDay": "2026-11-12", "deadlineRemindAt": float64(1794500000000)})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"title": "Fixture #12 deadline", "notes": "x", "deadlineDay": "2026-11-12", "deadlineRemindAt": float64(1794500000000), "isIgnoreShortSyntax": true}
	if !reflect.DeepEqual(s.bodies, []map[string]any{want}) {
		t.Fatalf("bodies %#v", s.bodies)
	}
	if resp.Result["updated"] != true || resp.Result["deadlineDay"] != "2026-11-12" || resp.Result["via"] != "localRest" {
		t.Fatalf("result %#v", resp.Result)
	}
}

func TestDeadlineTodayReportsTheAppsReplanning(t *testing.T) {
	_, r := newPatchRouter(t)
	resp, err := call(r, "task.update", map[string]any{"taskId": "fx-deadline-day", "deadlineDay": "2026-11-09"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["dueDay"] != "2026-11-09" || resp.Result["dueWithTime"] != nil || resp.Result["remindAt"] != nil {
		t.Fatalf("result %#v", resp.Result)
	}
}

func TestClearingDeadlinesAndAliasMapping(t *testing.T) {
	s, r := newPatchRouter(t)
	if _, err := call(r, "task.update", map[string]any{"taskId": "fx-deadline-day", "deadlineDay": nil, "deadlineWithTime": nil}); err != nil {
		t.Fatal(err)
	}
	if _, err := call(r, "task.update", map[string]any{"taskId": "fx-deadline-day", "deadlineRemindAt": nil, "plannedAt": float64(1794240000000)}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.bodies[0], map[string]any{"deadlineDay": nil, "deadlineWithTime": nil}) {
		t.Fatalf("clear body %#v", s.bodies[0])
	}
	if !reflect.DeepEqual(s.bodies[1], map[string]any{"deadlineRemindAt": nil, "dueWithTime": float64(1794240000000)}) {
		t.Fatalf("alias body %#v", s.bodies[1])
	}
}

func TestInvalidDeadlineUpdatesSendNothing(t *testing.T) {
	cases := []map[string]any{
		{"taskId": "fx-deadline-day", "deadlineDay": "2026-11-12", "deadlineWithTime": float64(1794500000000)},
		{"taskId": "fx-deadline-day", "deadlineDay": "2026-02-30"},
		{"taskId": "fx-deadline-day", "deadlineWithTime": float64(-1)},
		{"taskId": "fx-deadline-day", "deadlineRemindAt": 1.5},
		{"taskId": "fx-deadline-day", "deadlineDay": "2026-11-12", "dueWithTime": float64(1), "plannedAt": float64(2)},
		{"deadlineDay": "2026-11-12"},
	}
	for _, payload := range cases {
		s, r := newPatchRouter(t)
		_, err := call(r, "task.update", payload)
		if got := code(t, err); got != "INVALID_REQUEST" {
			t.Errorf("%v: code = %s", payload, got)
		}
		if len(s.bodies) != 0 {
			t.Errorf("%v: sent %v", payload, s.bodies)
		}
	}
}

func TestDeadlineUpdateErrorsAreNotRetriedOrSplit(t *testing.T) {
	s, r := newPatchRouter(t)
	s.status = 400
	_, err := call(r, "task.update", map[string]any{"taskId": "fx-deadline-day", "title": "x", "deadlineRemindAt": float64(1794500000000)})
	if got := code(t, err); got != "INVALID_REQUEST" {
		t.Fatalf("code = %s", got)
	}
	if len(s.bodies) != 1 {
		t.Fatalf("requests %d", len(s.bodies))
	}

	srv := newRESTServer(t, 504, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"x"}}`)
	r2 := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	_, err = call(r2, "task.update", map[string]any{"taskId": "x", "deadlineDay": "2026-11-12"})
	if got := code(t, err); got != localrest.CodeOutcomeUnknown {
		t.Fatalf("code = %s", got)
	}
}

func TestDeadlinesWithoutRESTAreUnsupportedAndOtherUpdatesUseThePlugin(t *testing.T) {
	plugin := &fakePlugin{result: map[string]any{"updated": true}}
	r := NewWith(nil, func() (domain.Bridge, error) { return plugin, nil })
	_, err := call(r, "task.update", map[string]any{"taskId": "x", "title": "y", "deadlineDay": "2026-11-12"})
	if got := code(t, err); got != "UNSUPPORTED_ACTION" {
		t.Fatalf("code = %s", got)
	}
	if len(plugin.calls) != 0 {
		t.Fatalf("a deadline edit reached the plugin")
	}
	if _, err := call(r, "task.update", map[string]any{"taskId": "x", "title": "y"}); err != nil || len(plugin.calls) != 1 {
		t.Fatalf("plain update: %v %#v", err, plugin.calls)
	}
}
