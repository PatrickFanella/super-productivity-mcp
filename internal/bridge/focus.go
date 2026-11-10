package bridge

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// focusState reads GET /focus: the app's read-only Focus Mode state. It adds
// one summary field, state, and never sends a timer control.
//
//	state: "inactive"      no work or break timer
//	       "session-done"  a work session just completed (timer null)
//	       "<purpose>-<status>", for example "work-running", "break-done"
func focusState(ctx context.Context, rest *localrest.Client, _ map[string]any) (map[string]any, error) {
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: "/focus"})
	if err != nil {
		return nil, err
	}
	var focus map[string]any
	if err := json.Unmarshal(data, &focus); err != nil || focus == nil {
		return nil, malformedRead("focus state")
	}
	mode, _ := focus["mode"].(string)
	if mode == "" {
		return nil, malformedRead("focus state")
	}
	state := "inactive"
	if timer, ok := focus["timer"].(map[string]any); ok {
		purpose, _ := timer["purpose"].(string)
		status, _ := timer["status"].(string)
		state = purpose + "-" + status
	} else if focus["isSessionDone"] == true {
		state = "session-done"
	}
	focus["state"] = state
	focus["via"] = "localRest"
	return focus, nil
}
