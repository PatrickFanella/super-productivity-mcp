package bridge

import (
	"errors"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// TestRealResultsMatchOutputSchemas runs each REST-routed handler against its
// fake upstream and validates the result against the catalog, because the
// MCP adapter rejects a result that does not match its output schema.
func TestRealResultsMatchOutputSchemas(t *testing.T) {
	fastProbes(t)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	check := func(r *Router, action string, payload map[string]any) {
		t.Helper()
		resp, err := call(r, action, payload)
		if err != nil {
			t.Errorf("%s: %v", action, err)
			return
		}
		tool := cat.LookupAction(action)
		if tool == nil {
			t.Errorf("%s: not in catalog", action)
			return
		}
		if err := tool.ValidateOutput(resp.Result); err != nil {
			t.Errorf("%s: %v", action, err)
		}
	}

	_, repeat := newRepeatServer(t)
	check(repeat, "task.listRecurrences", map[string]any{})
	check(repeat, "task.getRecurrence", map[string]any{"taskId": "fx-recurring"})
	check(repeat, "task.updateRecurrence", map[string]any{"taskId": "fx-paused", "changes": map[string]any{"isPaused": false}})
	check(repeat, "task.setRecurrence", map[string]any{"taskId": "fx-day-today", "recurrence": map[string]any{"repeatCycle": "DAILY"}})
	check(repeat, "task.deleteRecurrence", map[string]any{"taskId": "fx-recurring"})

	_, tracking := newTrackingServer(t)
	check(tracking, "task.start", map[string]any{"taskId": "fx-parent"})
	check(tracking, "task.current", map[string]any{})
	check(tracking, "task.stop", map[string]any{})

	_, timeRouter := newTimeServer(t, unavailablePlugin(t))
	check(timeRouter, "task.addTime", map[string]any{"taskId": "fx-child-1", "timeMs": float64(minute), "date": "2026-11-06"})
	check(timeRouter, "task.setTimeForDay", map[string]any{"taskId": "fx-child-1", "timeMs": float64(0), "date": "2026-11-06"})

	_, patch := newPatchRouter(t)
	check(patch, "task.update", map[string]any{"taskId": "fx-deadline-day", "deadlineDay": "2026-11-12"})

	_, focus := serveFocus(t, fixtureBody(t, "focusPausedOvertime"))
	check(focus, "focus.state", map[string]any{})

	_, counterURL := newCounterServer(t)
	counters := NewWith(restClient(t, counterURL), func() (domain.Bridge, error) { return nil, errors.New("down") })
	check(counters, "counter.history", map[string]any{})
	check(counters, "counter.setDay", map[string]any{"counterId": "fx-counter-water", "value": float64(3), "date": "2026-11-08"})

	_, notes := newNoteStore(t)
	check(notes, "note.list", map[string]any{})
	check(notes, "note.get", map[string]any{"noteId": "fx-note-today"})
	check(notes, "note.create", map[string]any{"content": "Fixture", "isPinnedToToday": true})
	check(notes, "note.update", map[string]any{"noteId": "fx-note-project", "content": "Fixture edited"})
	check(notes, "note.delete", map[string]any{"noteId": "fx-note-today"})

	statusRouter := NewWith(restClient(t, restOK(t).URL), pluginFactory(&readyPlugin{}))
	check(statusRouter, "bridge.capabilities", map[string]any{})
}
