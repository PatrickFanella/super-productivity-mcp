package bridge

import (
	"context"
	"reflect"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

func call(r *Router, action string, payload map[string]any) (domain.Response, error) {
	return r.Call(context.Background(), domain.Request{Action: action, Payload: payload})
}

func lastBody(s *repeatServer) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bodies[len(s.bodies)-1]
}

func TestSetRecurrenceMapsToStockV20Schedules(t *testing.T) {
	cases := []struct {
		name       string
		recurrence map[string]any
		want       map[string]any
	}{
		{"daily", map[string]any{"repeatCycle": "DAILY"},
			map[string]any{"taskId": "fx-day-today", "quickSetting": "DAILY"}},
		{"custom weekly", map[string]any{"repeat_cycle": "WEEKLY", "repeatEvery": float64(2), "tuesday": true, "thursday": true, "skipOverdue": false},
			map[string]any{"taskId": "fx-day-today", "quickSetting": "CUSTOM", "repeatCycle": "WEEKLY", "repeatEvery": float64(2), "tuesday": true, "thursday": true, "skipOverdue": false}},
		{"nth weekday monthly", map[string]any{"repeatCycle": "MONTHLY", "quickSetting": "MONTHLY_NTH_WEEKDAY", "startDate": "2026-11-09"},
			map[string]any{"taskId": "fx-day-today", "quickSetting": "MONTHLY_NTH_WEEKDAY", "startDate": "2026-11-09"}},
		{"weekdays preset", map[string]any{"repeatCycle": "WEEKLY", "quickSetting": "MONDAY_TO_FRIDAY", "isPaused": true},
			map[string]any{"taskId": "fx-day-today", "quickSetting": "MONDAY_TO_FRIDAY", "isPaused": true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, r := newRepeatServer(t)
			resp, err := call(r, "task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": c.recurrence})
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(lastBody(s), c.want) {
				t.Fatalf("body %#v, want %#v", lastBody(s), c.want)
			}
			if resp.Result["repeatCfgId"] != "fx-created-cfg" || resp.Result["created"] != true {
				t.Fatalf("result %#v", resp.Result)
			}
			// Fresh readback through the task.
			got, err := call(r, "task.getRecurrence", map[string]any{"taskId": "fx-day-today"})
			if err != nil || got.Result["repeatCfg"].(map[string]any)["quickSetting"] != c.want["quickSetting"] {
				t.Fatalf("readback %#v %v", got.Result, err)
			}
		})
	}
}

func TestUnsupportedRecurrenceInputMakesNoRequest(t *testing.T) {
	cases := []struct {
		action  string
		payload map[string]any
		code    string
	}{
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY", "startTime": "09:00"}}, "UNSUPPORTED_FIELD"},
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "WEEKLY", "wait_for_completion": true}}, "UNSUPPORTED_FIELD"},
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY", "subTaskTemplates": []any{map[string]any{"title": "x"}}}}, "UNSUPPORTED_FIELD"},
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY", "repeatFromCompletionDate": true}}, "UNSUPPORTED_FIELD"},
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY", "quickSetting": "DAILY", "repeatEvery": float64(2)}}, "INVALID_REQUEST"},
		{"task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY", "isPaused": true, "is_paused": false}}, "INVALID_REQUEST"},
		{"task.updateRecurrence", map[string]any{"taskId": "fx-recurring", "changes": map[string]any{"notes": "x"}}, "UNSUPPORTED_FIELD"},
		{"task.updateRecurrence", map[string]any{"taskId": "fx-recurring", "changes": map[string]any{"defaultEstimate": float64(60000)}}, "UNSUPPORTED_FIELD"},
		{"task.updateRecurrence", map[string]any{"taskId": "fx-recurring", "changes": map[string]any{"isPaused": true}, "isAskToUpdateAllTaskInstances": true}, "UNSUPPORTED_FIELD"},
		{"task.updateRecurrence", map[string]any{"taskId": "fx-recurring", "changes": map[string]any{}}, "NO_UPDATE_FIELDS"},
	}
	for _, c := range cases {
		s, r := newRepeatServer(t)
		_, err := call(r, c.action, c.payload)
		if got := code(t, err); got != c.code {
			t.Errorf("%v: code = %s, want %s", c.payload, got, c.code)
		}
		if len(s.paths) != 0 {
			t.Errorf("%v: %d requests sent; validation must come first", c.payload, len(s.paths))
		}
	}
}

func TestUpdateRecurrencePauseResumeAndStartDate(t *testing.T) {
	s, r := newRepeatServer(t)
	if _, err := call(r, "task.updateRecurrence", map[string]any{"taskId": "fx-paused", "changes": map[string]any{"isPaused": false}}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(lastBody(s), map[string]any{"isPaused": false}) {
		t.Fatalf("resume body %#v", lastBody(s))
	}
	if _, err := call(r, "task.updateRecurrence", map[string]any{"task_id": "fx-paused", "changes": map[string]any{"is_paused": true}}); err != nil {
		t.Fatal(err)
	}
	got, _ := call(r, "task.getRecurrence", map[string]any{"repeatCfgId": "fx-repeat-paused"})
	if got.Result["repeatCfg"].(map[string]any)["isPaused"] != true {
		t.Fatalf("pause readback %#v", got.Result)
	}
	// A new start date re-applies the config's own preset.
	resp, err := call(r, "task.updateRecurrence", map[string]any{"taskId": "fx-recurring", "changes": map[string]any{"startDate": "2026-11-17"}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(lastBody(s), map[string]any{"startDate": "2026-11-17", "quickSetting": "CUSTOM"}) {
		t.Fatalf("start date body %#v", lastBody(s))
	}
	if resp.Result["updated"] != true || resp.Result["repeatCfg"].(map[string]any)["startDate"] != "2026-11-17" {
		t.Fatalf("result %#v", resp.Result)
	}
}

func TestUpdateRecurrenceRefusesCustomFieldsOnAPresetWithoutWriting(t *testing.T) {
	s, r := newRepeatServer(t)
	_, err := call(r, "task.updateRecurrence", map[string]any{"taskId": "fx-daily", "changes": map[string]any{"repeatEvery": float64(3)}})
	if got := code(t, err); got != "INVALID_REQUEST" {
		t.Fatalf("code = %s", got)
	}
	if s.writes != 0 {
		t.Fatalf("%d writes", s.writes)
	}
}

func TestDeleteRecurrenceKeepsTasks(t *testing.T) {
	s, r := newRepeatServer(t)
	resp, err := call(r, "task.deleteRecurrence", map[string]any{"taskId": "fx-recurring"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resp.Result, map[string]any{"repeatCfgId": "fx-repeat-weekly-custom", "deleted": true, "via": "localRest"}) {
		t.Fatalf("result %#v", resp.Result)
	}
	if _, kept := s.tasks["fx-recurring"]; !kept {
		t.Fatalf("task removed")
	}
	_, err = call(r, "task.getRecurrence", map[string]any{"taskId": "fx-recurring"})
	if got := code(t, err); got != "TASK_NOT_RECURRING" {
		t.Fatalf("after delete: %s", got)
	}
}

func TestRecurrenceWriteFailuresAfterSendingAreNotRetried(t *testing.T) {
	for status, want := range map[int]string{
		400: "INVALID_REQUEST",
		504: localrest.CodeOutcomeUnknown,
	} {
		body := `{"ok":false,"error":{"code":"INVALID_INPUT","message":"startDate must not be before 2026-11-09"}}`
		if status == 504 {
			body = `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"Renderer request timed out"}}`
		}
		srv := newRESTServer(t, status, body)
		r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
		_, err := call(r, "task.setRecurrence", map[string]any{"taskId": "x", "recurrence": map[string]any{"repeatCycle": "DAILY"}})
		if got := code(t, err); got != want {
			t.Errorf("status %d: code = %s, want %s", status, got, want)
		}
		if srv.requests.Load() != 1 {
			t.Errorf("status %d: %d requests", status, srv.requests.Load())
		}
	}
}

func TestRecurrenceWritesWithoutRESTDoNotReachThePlugin(t *testing.T) {
	r := NewWith(nil, unavailablePlugin(t))
	for _, action := range []string{"task.setRecurrence", "task.updateRecurrence", "task.deleteRecurrence"} {
		_, err := call(r, action, map[string]any{"taskId": "x"})
		if got := code(t, err); got != "UNSUPPORTED_ACTION" {
			t.Errorf("%s: code = %s", action, got)
		}
	}
}

func TestLegacyRecurrenceRouteUsesThePluginEvenWithREST(t *testing.T) {
	srv := newRESTServer(t, 200, `{}`)
	plugin := &fakePlugin{result: map[string]any{"repeatCfgId": "x", "created": true}}
	r := New(config.Config{LocalRESTURL: srv.URL, RecurrenceRoute: config.RecurrenceRoutePlugin})
	r.newPlugin = func() (domain.Bridge, error) { return plugin, nil }
	payload := map[string]any{"taskId": "x", "recurrence": map[string]any{"repeatCycle": "DAILY", "startTime": "09:00"}}
	if _, err := call(r, "task.setRecurrence", payload); err != nil {
		t.Fatal(err)
	}
	if len(plugin.calls) != 1 || srv.requests.Load() != 0 {
		t.Fatalf("plugin=%d rest=%d", len(plugin.calls), srv.requests.Load())
	}
	// Reads still use REST.
	_, _ = call(r, "task.listRecurrences", map[string]any{})
	if srv.requests.Load() != 1 {
		t.Fatalf("recurrence read did not use REST")
	}
}
