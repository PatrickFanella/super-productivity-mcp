package bridge

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

type repeatFixture struct {
	RestWritableFields []string         `json:"restWritableFields"`
	RepeatCfgs         []map[string]any `json:"repeatCfgs"`
}

func loadRepeatFixture(t *testing.T) repeatFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "test", "fixtures", "upstream", "v20", "repeat-cfgs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx repeatFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

// repeatServer fakes the stock-v20 repeat-config and task read routes.
type repeatServer struct {
	mu     sync.Mutex
	cfgs   []map[string]any
	tasks  map[string]map[string]any
	paths  []string
	writes int
	bodies []map[string]any
}

func (s *repeatServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.paths = append(s.paths, r.Method+" "+r.URL.RequestURI())
	ok := func(data any) {
		b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
		_, _ = w.Write(b)
	}
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"`+code+`","message":"`+code+`"}}`)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.Method == http.MethodGet && len(parts) == 1 && parts[0] == "task-repeat-cfgs":
		out := []map[string]any{}
		for _, cfg := range s.cfgs {
			if p := r.URL.Query().Get("projectId"); p == "" || cfg["projectId"] == p {
				out = append(out, cfg)
			}
		}
		ok(out)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "task-repeat-cfgs":
		for _, cfg := range s.cfgs {
			if cfg["id"] == parts[1] {
				ok(cfg)
				return
			}
		}
		fail(404, "REPEAT_CFG_NOT_FOUND")
	case r.Method == http.MethodGet && len(parts) == 2 && parts[0] == "tasks":
		if task, found := s.tasks[parts[1]]; found {
			ok(task)
			return
		}
		fail(404, "TASK_NOT_FOUND")
	case r.Method == http.MethodPost && len(parts) == 1 && parts[0] == "task-repeat-cfgs":
		s.writes++
		body := s.readBody(r)
		if !s.validWrite(w, body, true, nil) {
			return
		}
		taskID, _ := body["taskId"].(string)
		task, found := s.tasks[taskID]
		if !found {
			fail(404, "TASK_NOT_FOUND")
			return
		}
		cfg := map[string]any{"id": "fx-created-cfg", "projectId": "fixture-project-alpha"}
		for k, v := range body {
			if k != "taskId" {
				cfg[k] = v
			}
		}
		s.cfgs = append(s.cfgs, cfg)
		task["repeatCfgId"] = "fx-created-cfg"
		w.WriteHeader(201)
		ok(cfg)
	case r.Method == http.MethodPatch && len(parts) == 2 && parts[0] == "task-repeat-cfgs":
		s.writes++
		cfg := s.cfg(parts[1])
		if cfg == nil {
			fail(404, "REPEAT_CFG_NOT_FOUND")
			return
		}
		body := s.readBody(r)
		if !s.validWrite(w, body, false, cfg) {
			return
		}
		for k, v := range body {
			cfg[k] = v
		}
		ok(cfg)
	case r.Method == http.MethodDelete && len(parts) == 2 && parts[0] == "task-repeat-cfgs":
		s.writes++
		if s.cfg(parts[1]) == nil {
			fail(404, "REPEAT_CFG_NOT_FOUND")
			return
		}
		kept := s.cfgs[:0]
		for _, c := range s.cfgs {
			if c["id"] != parts[1] {
				kept = append(kept, c)
			}
		}
		s.cfgs = kept
		// The app keeps the tasks; they no longer repeat.
		for _, task := range s.tasks {
			if task["repeatCfgId"] == parts[1] {
				task["repeatCfgId"] = nil
			}
		}
		ok(map[string]any{"deleted": true, "id": parts[1]})
	default:
		fail(404, "NOT_FOUND")
	}
}

func (s *repeatServer) readBody(r *http.Request) map[string]any {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.bodies = append(s.bodies, body)
	return body
}

func (s *repeatServer) cfg(id string) map[string]any {
	for _, c := range s.cfgs {
		if c["id"] == id {
			return c
		}
	}
	return nil
}

// validWrite applies the pinned v20 rules for repeat-config bodies.
func (s *repeatServer) validWrite(w http.ResponseWriter, body map[string]any, creating bool, _ map[string]any) bool {
	reply := func(code string) bool {
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"`+code+`","message":"`+code+`"}}`)
		return false
	}
	allowed := map[string]bool{}
	for _, f := range restRecurrenceWritableFields {
		allowed[f] = true
	}
	if creating {
		allowed["taskId"] = true
	}
	for k := range body {
		if !allowed[k] {
			return reply("UNSUPPORTED_FIELD")
		}
	}
	qs, hasQS := body["quickSetting"].(string)
	schedule := false
	custom := false
	for k := range body {
		switch k {
		case "startDate", "quickSetting":
			schedule = true
		case "repeatCycle", "repeatEvery", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday":
			schedule, custom = true, true
		}
	}
	if !creating && schedule && !hasQS {
		return reply("INVALID_INPUT")
	}
	if custom && qs != "CUSTOM" {
		return reply("INVALID_INPUT")
	}
	return true
}

func newRepeatServer(t *testing.T) (*repeatServer, *Router) {
	t.Helper()
	fx := loadRepeatFixture(t)
	s := &repeatServer{cfgs: fx.RepeatCfgs, tasks: map[string]map[string]any{
		"fx-recurring": {"id": "fx-recurring", "repeatCfgId": "fx-repeat-weekly-custom"},
		"fx-day-today": {"id": "fx-day-today", "repeatCfgId": nil},
		"fx-paused":    {"id": "fx-paused", "repeatCfgId": "fx-repeat-paused"},
		"fx-daily":     {"id": "fx-daily", "repeatCfgId": "fx-repeat-daily"},
	}}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func TestListRecurrencesThroughREST(t *testing.T) {
	_, r := newRepeatServer(t)
	fx := loadRepeatFixture(t)
	resp, err := r.Call(context.Background(), domain.Request{Action: "task.listRecurrences", Payload: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	cfgs := resp.Result["repeatCfgs"].([]any)
	if len(cfgs) != len(fx.RepeatCfgs) || resp.Result["via"] != "localRest" {
		t.Fatalf("result %#v", resp.Result)
	}
	paused := false
	for _, c := range cfgs {
		paused = paused || c.(map[string]any)["isPaused"] == true
	}
	if !paused {
		t.Fatalf("paused configs missing")
	}
	wf := resp.Result["writableFields"].(map[string]any)
	got := []string{}
	for _, f := range wf["localRest"].([]any) {
		got = append(got, f.(string))
	}
	if !reflect.DeepEqual(got, fx.RestWritableFields) {
		t.Fatalf("writable fields %v do not match the pinned REST contract %v", wf["localRest"], fx.RestWritableFields)
	}
}

func TestListRecurrencesFiltersAndProjects(t *testing.T) {
	s, r := newRepeatServer(t)
	s.cfgs = append(s.cfgs, map[string]any{"id": "fx-other", "projectId": "fixture-project-beta", "isPaused": false})
	resp, err := r.Call(context.Background(), domain.Request{Action: "task.listRecurrences", Payload: map[string]any{"project_id": "fixture-project-beta", "fields": []any{"isPaused"}}})
	if err != nil {
		t.Fatal(err)
	}
	cfgs := resp.Result["repeatCfgs"].([]any)
	if len(cfgs) != 1 || !reflect.DeepEqual(cfgs[0], map[string]any{"id": "fx-other", "isPaused": false}) {
		t.Fatalf("cfgs %#v", cfgs)
	}
	if got := s.paths[len(s.paths)-1]; got != "GET /task-repeat-cfgs?projectId=fixture-project-beta" {
		t.Fatalf("request %s", got)
	}
}

func TestGetRecurrenceResolvesTaskFreshly(t *testing.T) {
	s, r := newRepeatServer(t)
	get := func() (domain.Response, error) {
		return r.Call(context.Background(), domain.Request{Action: "task.getRecurrence", Payload: map[string]any{"taskId": "fx-recurring", "fields": []any{"repeatEvery"}}})
	}
	resp, err := get()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resp.Result["repeatCfg"], map[string]any{"id": "fx-repeat-weekly-custom", "repeatEvery": float64(2)}) || resp.Result["taskId"] != "fx-recurring" {
		t.Fatalf("result %#v", resp.Result)
	}
	// The task moves to another config; the next read follows it.
	s.mu.Lock()
	s.tasks["fx-recurring"]["repeatCfgId"] = "fx-repeat-daily"
	s.mu.Unlock()
	resp, err = get()
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["repeatCfg"].(map[string]any)["id"] != "fx-repeat-daily" {
		t.Fatalf("stale mapping: %#v", resp.Result)
	}
}

func TestGetRecurrenceErrors(t *testing.T) {
	_, r := newRepeatServer(t)
	cases := []struct {
		payload map[string]any
		want    string
	}{
		{map[string]any{}, "INVALID_REQUEST"},
		{map[string]any{"taskId": "fx-day-today"}, "TASK_NOT_RECURRING"},
		{map[string]any{"taskId": "fx-missing"}, "TASK_NOT_FOUND"},
		{map[string]any{"repeatCfgId": "fx-missing"}, "REPEAT_CFG_NOT_FOUND"},
		{map[string]any{"repeatCfgId": ".."}, "INVALID_REQUEST"},
	}
	for _, c := range cases {
		_, err := r.Call(context.Background(), domain.Request{Action: "task.getRecurrence", Payload: c.payload})
		if got := code(t, err); got != c.want {
			t.Errorf("%v: code = %s, want %s", c.payload, got, c.want)
		}
	}
}

func TestRecurrenceReadsOnAnAppWithoutTheRoute(t *testing.T) {
	srv := newRESTServer(t, 404, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	_, err := r.Call(context.Background(), domain.Request{Action: "task.listRecurrences", Payload: map[string]any{}})
	if got := code(t, err); got != localrest.CodeUnsupportedRoute {
		t.Fatalf("code = %s", got)
	}
}

// TestRecurrenceToolsThroughMCP checks scopes, output schemas and notes
// redaction for the new tools end to end.
func TestRecurrenceToolsThroughMCP(t *testing.T) {
	s, r := newRepeatServer(t)
	s.cfgs[0]["notes"] = "Fixture repeat note body"
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	list := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_task_recurrences","arguments":{}}}` + "\n"
	get := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_task_recurrence","arguments":{"taskId":"fx-recurring"}}}` + "\n"

	writeOnly := mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"write"}})
	before := len(s.paths)
	if reply := serveOne(t, writeOnly, list); !strings.Contains(reply, "NOT_PERMITTED") {
		t.Fatalf("write-only grant: %s", reply)
	}
	if len(s.paths) != before {
		t.Fatalf("REST called without read scope")
	}

	readOnly := mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"read"}})
	reply := serveOne(t, readOnly, list)
	if strings.Contains(reply, `"isError":true`) || strings.Contains(reply, "Fixture repeat note body") {
		t.Fatalf("read grant without notes: %s", reply)
	}
	if reply := serveOne(t, readOnly, get); strings.Contains(reply, `"isError":true`) || !strings.Contains(reply, "fx-repeat-weekly-custom") {
		t.Fatalf("get: %s", reply)
	}
	full := mcpadapter.New(logger, r, cat)
	if reply := serveOne(t, full, list); !strings.Contains(reply, "Fixture repeat note body") {
		t.Fatalf("notes scope should keep notes: %s", reply)
	}
}
