package bridge

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

const minute = 60 * 1000

// timeServer fakes GET /tasks/:id and POST/PUT /tasks/:id/time with the v20
// rules: today or earlier, at most 24 h per day, leaf tasks only, and the
// parent total kept as the sum of its subtasks.
type timeServer struct {
	mu     sync.Mutex
	today  string
	tasks  map[string]*timedTask
	parent map[string]string
	writes int
}

func newTimeServer(t *testing.T, plugin func() (domain.Bridge, error)) (*timeServer, *Router) {
	t.Helper()
	s := &timeServer{
		today: "2026-11-09",
		tasks: map[string]*timedTask{
			"fx-parent":  {ID: "fx-parent", SubTaskIDs: []string{"fx-child-1"}, TimeSpent: 45 * minute, TimeSpentOnDay: map[string]float64{"2026-11-06": 30 * minute, "2026-11-09": 15 * minute}},
			"fx-child-1": {ID: "fx-child-1", TimeSpent: 45 * minute, TimeSpentOnDay: map[string]float64{"2026-11-06": 30 * minute, "2026-11-09": 15 * minute}},
		},
		parent: map[string]string{"fx-child-1": "fx-parent"},
	}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, NewWith(restClient(t, srv.URL), plugin)
}

func (s *timeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ok := func(data any) {
		b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
		_, _ = w.Write(b)
	}
	fail := func(status int, code string) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"`+code+`","message":"`+code+`"}}`)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	task, found := s.tasks[parts[1]]
	if !found {
		fail(404, "TASK_NOT_FOUND")
		return
	}
	if r.Method == http.MethodGet && len(parts) == 2 {
		ok(task)
		return
	}
	if len(parts) != 3 || parts[2] != "time" || (r.Method != http.MethodPost && r.Method != http.MethodPut) {
		fail(404, "NOT_FOUND")
		return
	}
	s.writes++
	var body struct {
		Date     string  `json:"date"`
		Duration float64 `json:"duration"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Date > s.today || len(task.SubTaskIDs) > 0 {
		fail(400, "INVALID_INPUT")
		return
	}
	next := body.Duration
	if r.Method == http.MethodPost {
		next += task.TimeSpentOnDay[body.Date]
	}
	if next > maxDayMs {
		fail(400, "INVALID_INPUT")
		return
	}
	delta := next - task.TimeSpentOnDay[body.Date]
	if next == 0 {
		delete(task.TimeSpentOnDay, body.Date)
	} else {
		task.TimeSpentOnDay[body.Date] = next
	}
	task.TimeSpent += delta
	if p := s.tasks[s.parent[task.ID]]; p != nil {
		p.TimeSpentOnDay[body.Date] += delta
		p.TimeSpent += delta
	}
	ok(task)
}

// dayPlugin answers task.dayContext only.
type dayPlugin struct {
	result map[string]any
	calls  int
}

func (p *dayPlugin) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	p.calls++
	if req.Action != "task.dayContext" {
		return domain.Response{}, domain.TypedError{Code: "UNEXPECTED", Message: req.Action}
	}
	return domain.Response{Result: p.result}, nil
}

func appDay(today string) func() (domain.Bridge, error) {
	return func() (domain.Bridge, error) {
		return &dayPlugin{result: map[string]any{"todayStr": today, "startOfNextDayDiffMs": float64(0), "source": "app"}}, nil
	}
}

func TestAddTimeUpdatesTheDayAndParentOnce(t *testing.T) {
	s, r := newTimeServer(t, unavailablePlugin(t))
	resp, err := call(r, "task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(10 * minute), "date": "2026-11-06"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["dayTimeMs"] != float64(40*minute) || resp.Result["timeSpent"] != float64(55*minute) || resp.Result["dateSource"] != "caller" {
		t.Fatalf("result %#v", resp.Result)
	}
	if p := s.tasks["fx-parent"]; p.TimeSpent != 55*minute || p.TimeSpentOnDay["2026-11-06"] != 40*minute {
		t.Fatalf("parent %+v", p)
	}
	if s.writes != 1 {
		t.Fatalf("writes %d", s.writes)
	}
}

func TestAddTimeDefaultsToTheAppsLogicalDay(t *testing.T) {
	s, r := newTimeServer(t, appDay("2026-11-08"))
	resp, err := call(r, "task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(5 * minute)})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Result["date"] != "2026-11-08" || resp.Result["dateSource"] != "app" || s.tasks["fx-child-1"].TimeSpentOnDay["2026-11-08"] != 5*minute {
		t.Fatalf("result %#v", resp.Result)
	}
}

func TestMissingDayContextIsReportedNotGuessed(t *testing.T) {
	hostClock := func() (domain.Bridge, error) {
		return &dayPlugin{result: map[string]any{"todayStr": "2026-11-09", "startOfNextDayDiffMs": float64(0), "source": "host-clock"}}, nil
	}
	broken := func() (domain.Bridge, error) { return nil, io.ErrUnexpectedEOF }
	for name, plugin := range map[string]func() (domain.Bridge, error){"host clock": hostClock, "no plugin": broken} {
		s, r := newTimeServer(t, plugin)
		for _, action := range []string{"task.addTime", "task.setTimeForDay"} {
			_, err := call(r, action, map[string]any{"taskId": "fx-child-1", "timeMs": float64(minute)})
			if got := code(t, err); got != "DAY_CONTEXT_UNAVAILABLE" {
				t.Errorf("%s %s: code = %s", name, action, got)
			}
		}
		if s.writes != 0 {
			t.Errorf("%s: %d writes", name, s.writes)
		}
	}
}

func TestSetTimeForDayIsIdempotentAndZeroClearsOneDay(t *testing.T) {
	s, r := newTimeServer(t, unavailablePlugin(t))
	set := func(ms float64) map[string]any {
		resp, err := call(r, "task.setTimeForDay", map[string]any{"taskId": "fx-child-1", "timeMs": ms, "date": "2026-11-06"})
		if err != nil {
			t.Fatal(err)
		}
		return resp.Result
	}
	first := set(60 * minute)
	second := set(60 * minute)
	if first["dayTimeMs"] != float64(60*minute) || second["timeSpent"] != first["timeSpent"] || s.tasks["fx-parent"].TimeSpent != 75*minute {
		t.Fatalf("set twice: %#v %#v parent %+v", first, second, s.tasks["fx-parent"])
	}
	cleared := set(0)
	child := s.tasks["fx-child-1"]
	if cleared["dayTimeMs"] != float64(0) || child.TimeSpentOnDay["2026-11-09"] != 15*minute || child.TimeSpent != 15*minute {
		t.Fatalf("clear: %#v child %+v", cleared, child)
	}
}

func TestTimeLoggingRefusesBadInputBeforeWriting(t *testing.T) {
	cases := []struct {
		action  string
		payload map[string]any
	}{
		{"task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(0), "date": "2026-11-06"}},
		{"task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": 1.5, "date": "2026-11-06"}},
		{"task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(maxDayMs + 1), "date": "2026-11-06"}},
		{"task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(minute), "date": "2026-02-30"}},
		{"task.addTime", map[string]any{"taskId": "fx-parent", "timeMs": float64(minute), "date": "2026-11-06"}},
		{"task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(maxDayMs - 10*minute), "date": "2026-11-06"}},
		{"task.setTimeForDay", map[string]any{"taskId": "fx-parent", "timeMs": float64(0), "date": "2026-11-06"}},
		{"task.setTimeForDay", map[string]any{"taskId": "fx-child-1", "timeMs": float64(-1), "date": "2026-11-06"}},
	}
	for _, c := range cases {
		s, r := newTimeServer(t, unavailablePlugin(t))
		_, err := call(r, c.action, c.payload)
		if got := code(t, err); got != "INVALID_REQUEST" {
			t.Errorf("%s %v: code = %s", c.action, c.payload, got)
		}
		if s.writes != 0 {
			t.Errorf("%s %v: %d writes", c.action, c.payload, s.writes)
		}
	}
}

func TestFutureDateIsRefusedByTheApp(t *testing.T) {
	s, r := newTimeServer(t, unavailablePlugin(t))
	_, err := call(r, "task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(minute), "date": "2026-11-10"})
	if got := code(t, err); got != "INVALID_REQUEST" {
		t.Fatalf("code = %s", got)
	}
	if s.tasks["fx-child-1"].TimeSpentOnDay["2026-11-10"] != 0 {
		t.Fatalf("future time logged")
	}
}

func TestUncertainAddIsNotRetried(t *testing.T) {
	var posts int
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, `{"ok":true,"data":{"id":"x","subTaskIds":[],"timeSpentOnDay":{}}}`)
			return
		}
		mu.Lock()
		posts++
		mu.Unlock()
		w.WriteHeader(504)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"x"}}`)
	}))
	defer srv.Close()
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	_, err := call(r, "task.addTime", map[string]any{"taskId": "x", "timeMs": float64(minute), "date": "2026-11-06"})
	if got := code(t, err); got != localrest.CodeOutcomeUnknown {
		t.Fatalf("code = %s", got)
	}
	if posts != 1 {
		t.Fatalf("posts = %d", posts)
	}
}

func TestTimeLoggingWithoutRESTIsUnsupported(t *testing.T) {
	r := NewWith(nil, unavailablePlugin(t))
	for _, action := range []string{"task.addTime", "task.setTimeForDay"} {
		_, err := call(r, action, map[string]any{"taskId": "x", "timeMs": float64(minute)})
		if got := code(t, err); got != "UNSUPPORTED_ACTION" {
			t.Errorf("%s: code = %s", action, got)
		}
	}
}
