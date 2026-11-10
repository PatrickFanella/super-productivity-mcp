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
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

// trackingServer fakes /status, /tasks/:id and /task-control.
type trackingServer struct {
	mu          sync.Mutex
	tasks       map[string]map[string]any
	current     string
	otherDevice map[string]any
	writes      []string
}

func newTrackingServer(t *testing.T) (*trackingServer, *Router) {
	t.Helper()
	s := &trackingServer{tasks: map[string]map[string]any{
		"fx-parent":   {"id": "fx-parent", "title": "Fixture parent", "isDone": false, "subTaskIds": []any{"fx-child-1", "fx-child-2"}},
		"fx-child-1":  {"id": "fx-child-1", "title": "Fixture child one", "isDone": true, "parentId": "fx-parent", "subTaskIds": []any{}},
		"fx-child-2":  {"id": "fx-child-2", "title": "Fixture child two", "isDone": false, "parentId": "fx-parent", "subTaskIds": []any{}, "tagIds": []any{"fixture-tag-focus"}},
		"fx-done":     {"id": "fx-done", "title": "Fixture done", "isDone": true, "subTaskIds": []any{}},
		"fx-all-done": {"id": "fx-all-done", "title": "Fixture all done", "isDone": false, "subTaskIds": []any{"fx-done"}},
	}}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func (s *trackingServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ok := func(data any) {
		b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
		_, _ = w.Write(b)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/status":
		var cur any
		if s.current != "" {
			cur = s.tasks[s.current]
		}
		ok(map[string]any{"currentTask": cur, "currentTaskId": nilString(s.current), "taskCount": len(s.tasks), "trackingOnOtherDevice": s.otherDevice})
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "tasks":
		if task, found := s.tasks[parts[1]]; found {
			ok(task)
			return
		}
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"TASK_NOT_FOUND","message":"Task not found"}}`)
	case r.Method == http.MethodPost && r.URL.Path == "/task-control/current":
		var body struct {
			TaskID string `json:"taskId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.writes = append(s.writes, "start "+body.TaskID)
		// Like setCurrentTask: a parent tracks its first unfinished subtask.
		s.current = body.TaskID
		if subs, _ := s.tasks[body.TaskID]["subTaskIds"].([]any); len(subs) > 0 {
			for _, id := range subs {
				if s.tasks[id.(string)]["isDone"] != true {
					s.current = id.(string)
					break
				}
			}
		}
		s.otherDevice = nil
		ok(map[string]any{"currentTaskId": body.TaskID})
	case r.Method == http.MethodPost && r.URL.Path == "/task-control/stop":
		s.writes = append(s.writes, "stop")
		s.current = ""
		ok(map[string]any{"currentTaskId": nil})
	default:
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`)
	}
}

func nilString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func TestStartParentTracksFirstUnfinishedSubtask(t *testing.T) {
	s, r := newTrackingServer(t)
	resp, err := call(r, "task.start", map[string]any{"taskId": "fx-parent"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["started"] != true || resp.Result["trackedTaskId"] != "fx-child-2" || resp.Result["via"] != "localRest" || resp.Result["takeover"] != false {
		t.Fatalf("result %#v", resp.Result)
	}
	if strings.Join(s.writes, ",") != "start fx-parent" {
		t.Fatalf("writes %v", s.writes)
	}
	cur, err := call(r, "task.current", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	task := cur.Result["task"].(map[string]any)
	if task["id"] != "fx-child-2" || task["parentId"] != "fx-parent" || cur.Result["trackingOnOtherDevice"] != nil {
		t.Fatalf("current %#v", cur.Result)
	}
}

func TestStartRefusesDoneTasksWithoutWriting(t *testing.T) {
	s, r := newTrackingServer(t)
	for _, id := range []string{"fx-done", "fx-all-done"} {
		_, err := call(r, "task.start", map[string]any{"taskId": id})
		if got := code(t, err); got != "TASK_DONE" {
			t.Errorf("%s: code = %s", id, got)
		}
	}
	_, err := call(r, "task.start", map[string]any{"taskId": "fx-missing"})
	if got := code(t, err); got != "TASK_NOT_FOUND" {
		t.Errorf("missing: code = %s", got)
	}
	if len(s.writes) != 0 {
		t.Fatalf("writes %v", s.writes)
	}
}

func TestStartRefusesSilentTakeover(t *testing.T) {
	s, r := newTrackingServer(t)
	s.otherDevice = map[string]any{"taskId": "fx-child-2", "deviceLabel": "Fixture laptop", "sinceTs": float64(1794236100000)}

	cur, err := call(r, "task.current", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if cur.Result["task"] != nil || cur.Result["trackingOnOtherDevice"].(map[string]any)["deviceLabel"] != "Fixture laptop" {
		t.Fatalf("other device not visible: %#v", cur.Result)
	}
	_, err = call(r, "task.start", map[string]any{"taskId": "fx-child-2"})
	if got := code(t, err); got != "TRACKING_ON_OTHER_DEVICE" {
		t.Fatalf("code = %s", got)
	}
	if len(s.writes) != 0 {
		t.Fatalf("took over without consent: %v", s.writes)
	}
	resp, err := call(r, "task.start", map[string]any{"taskId": "fx-child-2", "takeover": true})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["takeover"] != true || len(s.writes) != 1 {
		t.Fatalf("explicit takeover: %#v %v", resp.Result, s.writes)
	}
}

func TestStopReportsWhetherAnythingWasTracked(t *testing.T) {
	s, r := newTrackingServer(t)
	resp, err := call(r, "task.stop", map[string]any{})
	if err != nil || resp.Result["stopped"] != false {
		t.Fatalf("idle stop %#v %v", resp.Result, err)
	}
	if len(s.writes) != 0 {
		t.Fatalf("idle stop wrote: %v", s.writes)
	}
	s.current = "fx-child-2"
	resp, err = call(r, "task.stop", map[string]any{})
	if err != nil || resp.Result["stopped"] != true || resp.Result["taskId"] != "fx-child-2" || s.current != "" {
		t.Fatalf("stop %#v %v", resp.Result, err)
	}
}

func TestTrackingFailuresDoNotFallBackToPlugin(t *testing.T) {
	srv := newRESTServer(t, 504, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"x"}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	for _, action := range []string{"task.start", "task.stop", "task.current"} {
		if _, err := call(r, action, map[string]any{"taskId": "x"}); err == nil {
			t.Errorf("%s succeeded", action)
		}
	}
}

func TestTrackingUsesPluginWithoutREST(t *testing.T) {
	plugin := &fakePlugin{result: map[string]any{"started": true, "via": "plugin"}}
	r := NewWith(nil, func() (domain.Bridge, error) { return plugin, nil })
	if _, err := call(r, "task.start", map[string]any{"taskId": "x", "takeover": true}); err != nil {
		t.Fatal(err)
	}
	if len(plugin.calls) != 1 {
		t.Fatalf("plugin calls %#v", plugin.calls)
	}
}

func TestCurrentTaskThroughMCPValidatesNull(t *testing.T) {
	_, r := newTrackingServer(t)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	s := mcpadapter.New(slog.New(slog.NewTextHandler(io.Discard, nil)), r, cat)
	reply := serveOne(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_current_task","arguments":{}}}`+"\n")
	if strings.Contains(reply, `"isError":true`) || !strings.Contains(reply, `\"task\":null`) {
		t.Fatalf("reply %s", reply)
	}
}
