package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// counterServer fakes /simple-counters with the v20 PUT rules.
type counterServer struct {
	mu       sync.Mutex
	counters map[string]*simpleCounter
	writes   int
	paths    []string
}

func newCounterServer(t *testing.T) (*counterServer, string) {
	t.Helper()
	s := &counterServer{counters: map[string]*simpleCounter{
		"fx-counter-water":   {ID: "fx-counter-water", Title: "Fixture water glasses", Type: "ClickCounter", IsEnabled: true, CountOnDay: map[string]float64{"2026-11-07": 6, "2026-11-08": 8, "2026-11-09": 2}},
		"fx-counter-reading": {ID: "fx-counter-reading", Title: "Fixture reading stopwatch", Type: "StopWatch", IsEnabled: true, CountOnDay: map[string]float64{"2026-11-08": 1500000}},
	}}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	return s, srv.URL
}

func (s *counterServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.paths = append(s.paths, r.Method+" "+r.URL.Path)
	ok := func(data any) {
		b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
		_, _ = w.Write(b)
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) == 1 {
		list := []any{}
		for _, id := range []string{"fx-counter-water", "fx-counter-reading"} {
			list = append(list, s.counters[id])
		}
		ok(list)
		return
	}
	c := s.counters[parts[1]]
	if c == nil {
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"SIMPLE_COUNTER_NOT_FOUND","message":"Simple counter not found"}}`)
		return
	}
	if r.Method == http.MethodPut {
		s.writes++
		var body struct {
			Value float64 `json:"value"`
			Date  string  `json:"date"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Date == "" {
			body.Date = "2026-11-09"
		}
		c.CountOnDay[body.Date] = body.Value
	}
	ok(c)
}

// historyPlugin answers counter.history, or refuses it like an older host.
type historyPlugin struct {
	err   error
	calls int
}

func (p *historyPlugin) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	p.calls++
	if p.err != nil {
		return domain.Response{}, p.err
	}
	return domain.Response{Result: map[string]any{"counters": []any{}, "via": "plugin"}}, nil
}

func TestHabitHistoryPrefersThePlugin(t *testing.T) {
	s, url := newCounterServer(t)
	p := &historyPlugin{}
	r := NewWith(restClient(t, url), func() (domain.Bridge, error) { return p, nil })
	resp, err := call(r, "counter.history", map[string]any{})
	if err != nil || resp.Result["via"] != "plugin" || len(s.paths) != 0 {
		t.Fatalf("result %#v err %v paths %v", resp.Result, err, s.paths)
	}
}

func TestHabitHistoryFallsBackToRESTForAnOlderPlugin(t *testing.T) {
	for name, plugin := range map[string]func() (domain.Bridge, error){
		"no getAllSimpleCounters": func() (domain.Bridge, error) {
			return &historyPlugin{err: domain.TypedError{Code: "UNSUPPORTED_ACTION", Message: "no"}}, nil
		},
		"plugin bridge cannot start": func() (domain.Bridge, error) { return nil, errors.New("no data dir") },
	} {
		_, url := newCounterServer(t)
		r := NewWith(restClient(t, url), plugin)
		resp, err := call(r, "counter.history", map[string]any{"startDate": "2026-11-08", "endDate": "2026-11-08"})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		counters := resp.Result["counters"].([]any)
		water, reading := counters[0].(map[string]any), counters[1].(map[string]any)
		if water["unit"] != "count" || reading["unit"] != "ms" || resp.Result["via"] != "localRest" {
			t.Fatalf("%s: %#v", name, resp.Result)
		}
		if !reflect.DeepEqual(water["days"], []any{map[string]any{"date": "2026-11-08", "value": float64(8)}}) {
			t.Fatalf("%s: days %#v", name, water["days"])
		}
	}
}

func TestHabitHistoryOtherPluginErrorsDoNotFallBack(t *testing.T) {
	s, url := newCounterServer(t)
	p := &historyPlugin{err: domain.TypedError{Code: "TIMEOUT", Message: "slow", Retryable: true}}
	r := NewWith(restClient(t, url), func() (domain.Bridge, error) { return p, nil })
	if _, err := call(r, "counter.history", map[string]any{}); code(t, err) != "TIMEOUT" || len(s.paths) != 0 {
		t.Fatalf("err %v paths %v", err, s.paths)
	}
}

func TestHabitHistoryForOneCounterAndBadInput(t *testing.T) {
	_, url := newCounterServer(t)
	r := NewWith(restClient(t, url), func() (domain.Bridge, error) { return nil, errors.New("down") })
	resp, err := call(r, "counter.history", map[string]any{"counterId": "fx-counter-reading"})
	if err != nil || len(resp.Result["counters"].([]any)) != 1 {
		t.Fatalf("one counter: %#v %v", resp.Result, err)
	}
	if _, err := call(r, "counter.history", map[string]any{"counterId": "fx-missing"}); code(t, err) != "SIMPLE_COUNTER_NOT_FOUND" {
		t.Fatalf("missing: %v", err)
	}
	if _, err := call(r, "counter.history", map[string]any{"startDate": "2026-02-30"}); code(t, err) != "INVALID_REQUEST" {
		t.Fatalf("bad date: %v", err)
	}
}

func TestSetHabitValueForDayIsIdempotentAndKeepsOtherDays(t *testing.T) {
	s, url := newCounterServer(t)
	r := NewWith(restClient(t, url), unavailablePlugin(t))
	for i := 0; i < 2; i++ {
		resp, err := call(r, "counter.setDay", map[string]any{"counterId": "fx-counter-water", "date": "2026-11-08", "value": float64(5)})
		if err != nil || resp.Result["dayValue"] != float64(5) {
			t.Fatalf("set: %#v %v", resp.Result, err)
		}
	}
	water := s.counters["fx-counter-water"].CountOnDay
	if water["2026-11-08"] != 5 || water["2026-11-07"] != 6 || water["2026-11-09"] != 2 {
		t.Fatalf("days %#v", water)
	}
	resp, err := call(r, "counter.setDay", map[string]any{"counter_id": "fx-counter-reading", "value": float64(600000)})
	if err != nil || resp.Result["dateSource"] != "app" || s.counters["fx-counter-reading"].CountOnDay["2026-11-09"] != 600000 {
		t.Fatalf("default day: %#v %v", resp.Result, err)
	}
}

func TestSetHabitValueRefusesBadInputBeforeWriting(t *testing.T) {
	for _, payload := range []map[string]any{
		{"counterId": "fx-counter-water", "value": float64(-1)},
		{"counterId": "fx-counter-water", "value": 1.5},
		{"counterId": "fx-counter-water"},
		{"counterId": "fx-counter-water", "value": float64(1), "date": "2026-02-30"},
		{"value": float64(1)},
	} {
		s, url := newCounterServer(t)
		r := NewWith(restClient(t, url), unavailablePlugin(t))
		if _, err := call(r, "counter.setDay", payload); code(t, err) != "INVALID_REQUEST" || s.writes != 0 {
			t.Errorf("%v: err %v writes %d", payload, err, s.writes)
		}
	}
	if _, err := call(NewWith(nil, unavailablePlugin(t)), "counter.setDay", map[string]any{"counterId": "x", "value": float64(1)}); code(t, err) != "UNSUPPORTED_ACTION" {
		t.Fatalf("no REST: %v", err)
	}
}
