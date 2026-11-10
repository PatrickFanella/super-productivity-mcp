package bridge

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// update_task with a deadline field goes, as a whole, to Local REST
// PATCH /tasks/:id: the app's deadline-aware path, which also re-applies the
// deadline dialog's Today planning. The whole update is validated first and
// sent as one request, never split across adapters.

var deadlineFields = []string{"deadlineDay", "deadlineWithTime", "deadlineRemindAt"}

// patchFields are the update_task fields PATCH /tasks/:id accepts.
var patchFields = []string{"title", "notes", "projectId", "tagIds", "dueDay", "dueWithTime", "deadlineDay", "deadlineWithTime", "deadlineRemindAt"}

func hasDeadline(payload map[string]any) bool {
	for _, f := range deadlineFields {
		if _, ok := payload[f]; ok {
			return true
		}
	}
	return false
}

// timestampOrNull checks a positive whole millisecond timestamp or null.
func timestampOrNull(v any) bool {
	if v == nil {
		return true
	}
	n, ok := v.(float64)
	return ok && n > 0 && n == math.Trunc(n)
}

func deadlinePatch(payload map[string]any) (map[string]any, error) {
	body := map[string]any{}
	for _, f := range patchFields {
		if v, ok := payload[f]; ok {
			body[f] = v
		}
	}
	// plannedAt is an alias of dueWithTime; different values are refused.
	if v, ok := payload["plannedAt"]; ok {
		if cur, both := body["dueWithTime"]; both && !equalJSON(cur, v) {
			return nil, invalid("plannedAt is an alias of dueWithTime; pass one of them, or the same value in both")
		}
		body["dueWithTime"] = v
	}
	if d, ok := body["deadlineDay"]; ok && d != nil {
		if s, isStr := d.(string); !isStr || !validDate(s) {
			return nil, invalid("deadlineDay must be a valid YYYY-MM-DD date or null")
		}
	}
	for _, f := range []string{"deadlineWithTime", "deadlineRemindAt", "dueWithTime"} {
		if v, ok := body[f]; ok && !timestampOrNull(v) {
			return nil, invalid(f + " must be a positive millisecond timestamp or null")
		}
	}
	if body["deadlineDay"] != nil && body["deadlineWithTime"] != nil {
		return nil, invalid("deadlineDay and deadlineWithTime are mutually exclusive; set one and null the other")
	}
	if d, ok := body["dueDay"]; ok && d != nil {
		s, isStr := d.(string)
		if !isStr || !validDate(s) {
			return nil, invalid("dueDay must be a valid YYYY-MM-DD date or null")
		}
		if t, timed := body["dueWithTime"].(float64); timed && time.UnixMilli(int64(t)).Format("2006-01-02") != s {
			return nil, invalid("dueDay does not match the day of dueWithTime; a timed task is filed by its time")
		}
	}
	// Same schedule rules as the plugin path: a timed task is filed by its
	// time, so setting a time clears dueDay.
	if _, timed := body["dueWithTime"].(float64); timed {
		body["dueDay"] = nil
	}
	if _, ok := body["title"]; ok {
		// Titles are stored literally, never parsed as short syntax.
		body["isIgnoreShortSyntax"] = true
	}
	return body, nil
}

func equalJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func (r *Router) updateWithDeadline(ctx context.Context, req domain.Request) (domain.Response, error) {
	if r.restErr != nil {
		return domain.Response{}, r.restErr
	}
	taskID := stringArg(req.Payload, "taskId")
	if taskID == "" {
		return domain.Response{}, invalid("taskId is required")
	}
	body, err := deadlinePatch(req.Payload)
	if err != nil {
		return domain.Response{}, err
	}
	if r.rest == nil {
		return domain.Response{}, domain.TypedError{
			Code:    "UNSUPPORTED_ACTION",
			Message: "Deadlines need Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN): the app's deadline path also re-plans Today, which a plain plugin update would skip. Nothing was changed.",
		}
	}
	path, err := localrest.SegmentPath("tasks", taskID)
	if err != nil {
		return domain.Response{}, err
	}
	// A dueDay alone on a task that has a time is refused, as on the plugin
	// path: it would leave both a day and a time.
	if day, ok := body["dueDay"]; ok && day != nil {
		if _, setsTime := body["dueWithTime"]; !setsTime {
			current, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
			if err != nil {
				return domain.Response{}, err
			}
			var task struct {
				DueWithTime float64 `json:"dueWithTime"`
			}
			if json.Unmarshal(current, &task) != nil {
				return domain.Response{}, malformedRead("task")
			}
			if task.DueWithTime > 0 {
				return domain.Response{}, invalid("This task has a time. To make it day-only, pass dueWithTime:null together with dueDay; to move it, pass a new dueWithTime.")
			}
		}
	}
	data, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodPatch, Path: path, Body: body, Mutation: true})
	if err != nil {
		return domain.Response{}, err
	}
	var task map[string]any
	if json.Unmarshal(data, &task) != nil || task["id"] != taskID {
		return domain.Response{}, domain.TypedError{Code: localrest.CodeOutcomeUnknown, Message: "Super Productivity answered the update without returning the task. Check it with get_task before retrying."}
	}
	result := map[string]any{"updated": true, "via": "localRest"}
	// Report the schedule and deadline as the app now stores them, since a
	// deadline today can move dueDay and clear dueWithTime.
	for _, f := range []string{"dueDay", "dueWithTime", "remindAt", "deadlineDay", "deadlineWithTime", "deadlineRemindAt"} {
		result[f] = task[f]
	}
	return domain.Response{Result: result}, nil
}
