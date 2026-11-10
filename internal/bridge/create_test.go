package bridge

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// createPlugin answers task.create and task.dayContext.
type createPlugin struct {
	mu    sync.Mutex
	calls []domain.Request
	today string
}

func (p *createPlugin) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, req)
	switch req.Action {
	case "task.create":
		return domain.Response{Result: map[string]any{"taskId": "fx-created-1"}}, nil
	case "task.dayContext":
		return domain.Response{Result: map[string]any{"todayStr": p.today, "startOfNextDayDiffMs": float64(0), "source": "app"}}, nil
	}
	return domain.Response{}, domain.TypedError{Code: "UNEXPECTED", Message: req.Action}
}

func (p *createPlugin) creates() []domain.Request {
	out := []domain.Request{}
	for _, c := range p.calls {
		if c.Action == "task.create" {
			out = append(out, c)
		}
	}
	return out
}

// attachServer answers GET /status and POST /task-repeat-cfgs.
type attachServer struct {
	mu          sync.Mutex
	statusCode  int
	attachCode  int
	attachBody  string
	attachCalls []map[string]any
	taskDueDay  any
}

func (s *attachServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/task-repeat-cfgs":
		// The pre-create probe of the attach route.
		w.WriteHeader(s.statusCode)
		if s.statusCode == 200 {
			_, _ = io.WriteString(w, `{"ok":true,"data":[]}`)
		} else {
			_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"APP_NOT_READY","message":"Renderer is not ready yet"}}`)
		}
		return
	case r.Method == http.MethodGet:
		// Read-back of the created task's day.
		b, _ := json.Marshal(map[string]any{"ok": true, "data": map[string]any{"id": "fx-created-1", "dueDay": s.taskDueDay}})
		_, _ = w.Write(b)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.attachCalls = append(s.attachCalls, body)
	w.WriteHeader(s.attachCode)
	_, _ = io.WriteString(w, s.attachBody)
}

func newCreateRouter(t *testing.T, s *attachServer) (*createPlugin, *Router) {
	t.Helper()
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	p := &createPlugin{today: "2026-11-10"}
	return p, NewWith(restClient(t, srv.URL), func() (domain.Bridge, error) { return p, nil })
}

func okAttach() *attachServer {
	return &attachServer{statusCode: 200, attachCode: 201, attachBody: `{"ok":true,"data":{"id":"fx-new-cfg"}}`}
}

func TestCreateWithRepeatMapsCompactRepeats(t *testing.T) {
	cases := []struct {
		name    string
		payload map[string]any
		want    map[string]any
	}{
		{"daily", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "daily"}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "DAILY"}},
		{"daily every 3", map[string]any{"title": "Fixture", "dueDate": "2026-11-12", "repeat": map[string]any{"cycle": "daily", "every": float64(3)}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "CUSTOM", "repeatCycle": "DAILY", "repeatEvery": float64(3), "startDate": "2026-11-12"}},
		{"weekly preset", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "weekly"}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "WEEKLY_CURRENT_WEEKDAY"}},
		{"weekly days", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "weekly", "every": float64(2), "weekdays": []any{"mon", "thu"}}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "CUSTOM", "repeatCycle": "WEEKLY", "repeatEvery": float64(2), "monday": true, "tuesday": false, "wednesday": false, "thursday": true, "friday": false, "saturday": false, "sunday": false}},
		{"weekly every 2 from dueDate", map[string]any{"title": "Fixture", "dueDate": "2026-11-12", "repeat": map[string]any{"cycle": "weekly", "every": float64(2)}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "CUSTOM", "repeatCycle": "WEEKLY", "repeatEvery": float64(2), "startDate": "2026-11-12", "monday": false, "tuesday": false, "wednesday": false, "thursday": true, "friday": false, "saturday": false, "sunday": false}},
		{"weekly every 2 from the app's day", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "weekly", "every": float64(2)}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "CUSTOM", "repeatCycle": "WEEKLY", "repeatEvery": float64(2), "monday": false, "tuesday": true, "wednesday": false, "thursday": false, "friday": false, "saturday": false, "sunday": false}},
		{"monthly", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "monthly"}},
			map[string]any{"taskId": "fx-created-1", "quickSetting": "MONTHLY_CURRENT_DATE"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := okAttach()
			p, r := newCreateRouter(t, s)
			resp, err := call(r, "task.create", c.payload)
			if err != nil {
				t.Fatal(err)
			}
			if resp.Result["taskId"] != "fx-created-1" || resp.Result["repeatCfgId"] != "fx-new-cfg" {
				t.Fatalf("result %#v", resp.Result)
			}
			if !reflect.DeepEqual(s.attachCalls, []map[string]any{c.want}) {
				t.Fatalf("attach %#v, want %#v", s.attachCalls, c.want)
			}
			creates := p.creates()
			if len(creates) != 1 || creates[0].Payload["repeat"] != nil || creates[0].Payload["title"] != "Fixture" {
				t.Fatalf("creates %#v", creates)
			}
		})
	}
}

func TestCreateWithRepeatValidatesBeforeCreating(t *testing.T) {
	for _, repeat := range []map[string]any{
		{"cycle": "hourly"},
		{"cycle": "daily", "every": float64(100)},
		{"cycle": "daily", "every": 1.5},
		{"cycle": "daily", "weekdays": []any{"mon"}},
		{"cycle": "weekly", "weekdays": []any{"mon", "mon"}},
		{"cycle": "weekly", "on": "mon"},
	} {
		s := okAttach()
		p, r := newCreateRouter(t, s)
		_, err := call(r, "task.create", map[string]any{"title": "Fixture", "repeat": repeat})
		if got := code(t, err); got != "INVALID_REQUEST" {
			t.Errorf("%v: code = %s", repeat, got)
		}
		if len(p.creates()) != 0 || len(s.attachCalls) != 0 {
			t.Errorf("%v: wrote before validating", repeat)
		}
	}
}

func TestCreateWithRepeatChecksRESTBeforeCreating(t *testing.T) {
	s := okAttach()
	s.statusCode = 503
	p, r := newCreateRouter(t, s)
	_, err := call(r, "task.create", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "daily"}})
	if got := code(t, err); got != localrest.CodeUnavailable {
		t.Fatalf("code = %s", got)
	}
	if len(p.creates()) != 0 {
		t.Fatalf("task created although the attach route was down")
	}
}

func TestCreateWithRepeatKeepsTheTaskWhenAttachFails(t *testing.T) {
	for status, want := range map[int]string{
		400: "INVALID_REQUEST",
		504: localrest.CodeOutcomeUnknown,
	} {
		s := okAttach()
		s.attachCode = status
		s.attachBody = `{"ok":false,"error":{"code":"INVALID_INPUT","message":"startDate must not be before 2026-11-10"}}`
		if status == 504 {
			s.attachBody = `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"x"}}`
		}
		p, r := newCreateRouter(t, s)
		resp, err := call(r, "task.create", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "daily"}})
		if err != nil {
			t.Fatalf("%d: %v", status, err)
		}
		recurrenceErr, _ := resp.Result["recurrenceError"].(map[string]any)
		if resp.Result["taskId"] != "fx-created-1" || recurrenceErr["code"] != want {
			t.Errorf("%d: result %#v", status, resp.Result)
		}
		if len(p.creates()) != 1 || len(s.attachCalls) != 1 {
			t.Errorf("%d: creates=%d attaches=%d; nothing may be retried", status, len(p.creates()), len(s.attachCalls))
		}
	}
}

func TestCreateWithRepeatWithoutRESTCreatesNothing(t *testing.T) {
	p := &createPlugin{}
	r := NewWith(nil, func() (domain.Bridge, error) { return p, nil })
	_, err := call(r, "task.create", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "daily"}})
	if got := code(t, err); got != "UNSUPPORTED_ACTION" {
		t.Fatalf("code = %s", got)
	}
	if len(p.calls) != 0 {
		t.Fatalf("plugin called: %#v", p.calls)
	}
	// Without repeat, creation goes straight to the plugin.
	if _, err := call(r, "task.create", map[string]any{"title": "Fixture"}); err != nil || len(p.creates()) != 1 {
		t.Fatalf("plain create: %v %#v", err, p.calls)
	}
}

func TestCreateWithRepeatOnTheLegacyRouteUsesThePlugin(t *testing.T) {
	p := &createPlugin{}
	r := New(config.Config{RecurrenceRoute: config.RecurrenceRoutePlugin})
	r.newPlugin = func() (domain.Bridge, error) { return p, nil }
	if _, err := call(r, "task.create", map[string]any{"title": "Fixture", "repeat": map[string]any{"cycle": "daily"}}); err != nil {
		t.Fatal(err)
	}
	creates := p.creates()
	if len(creates) != 1 || creates[0].Payload["repeat"] == nil {
		t.Fatalf("legacy create %#v", creates)
	}
}

func TestCreateWithRepeatRefusesSubtasksBeforeCreating(t *testing.T) {
	s := okAttach()
	p, r := newCreateRouter(t, s)
	_, err := call(r, "task.create", map[string]any{"title": "Fixture", "parentId": "fx-parent", "repeat": map[string]any{"cycle": "daily"}})
	if code(t, err) != "INVALID_REQUEST" || len(p.creates()) != 0 || len(s.attachCalls) != 0 {
		t.Fatalf("err %v creates %d", err, len(p.creates()))
	}
}

func TestCreateWithRepeatAndTimeLetsTheAppPickTheStart(t *testing.T) {
	s := okAttach()
	_, r := newCreateRouter(t, s)
	if _, err := call(r, "task.create", map[string]any{"title": "Fixture", "dueDate": "2026-11-09", "dueTime": "09:00", "repeat": map[string]any{"cycle": "daily"}}); err != nil {
		t.Fatal(err)
	}
	if _, has := s.attachCalls[0]["startDate"]; has {
		t.Fatalf("startDate sent with a time: %#v", s.attachCalls[0])
	}
}

func TestWeeklyRepeatUsesTheCreatedTasksDay(t *testing.T) {
	s := okAttach()
	s.taskDueDay = "2026-11-13" // a Friday, as "@fri" short syntax would set
	_, r := newCreateRouter(t, s)
	if _, err := call(r, "task.create", map[string]any{"title": "Fixture @fri", "repeat": map[string]any{"cycle": "weekly", "every": float64(2)}}); err != nil {
		t.Fatal(err)
	}
	if s.attachCalls[0]["friday"] != true || s.attachCalls[0]["tuesday"] != false {
		t.Fatalf("attach %#v", s.attachCalls[0])
	}
}
