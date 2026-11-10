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

// Time logging through Local REST: POST /tasks/:id/time adds to one day's
// record (and the totals), PUT sets the day's record. Both are checked here
// first: a valid date, a whole-millisecond duration of at most 24 hours, a
// leaf task (a parent's time is the sum of its subtasks') and, for adding,
// a day total of at most 24 hours. The app checks again and refuses future
// dates.

const maxDayMs = 24 * 60 * 60 * 1000

// dateSourceKey marks a date the router filled from the app's logical day.
const dateSourceKey = "_dateSource"

type timedTask struct {
	ID             string             `json:"id"`
	SubTaskIDs     []string           `json:"subTaskIds"`
	TimeSpent      float64            `json:"timeSpent"`
	TimeSpentOnDay map[string]float64 `json:"timeSpentOnDay"`
}

func validDate(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

func timeArgs(payload map[string]any, allowZero bool) (taskID, date string, ms float64, err error) {
	taskID = stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return "", "", 0, invalid("taskId is required")
	}
	date = stringArg(payload, "date")
	if !validDate(date) {
		return "", "", 0, invalid("date must be a valid YYYY-MM-DD date")
	}
	raw, ok := payload["timeMs"].(float64)
	min := 1.0
	if allowZero {
		min = 0
	}
	if !ok || raw != math.Trunc(raw) || raw < min || raw > maxDayMs {
		if allowZero {
			return "", "", 0, invalid("timeMs must be a whole number of milliseconds from 0 to 86400000 (24 hours)")
		}
		return "", "", 0, invalid("timeMs must be a whole number of milliseconds from 1 to 86400000 (24 hours)")
	}
	return taskID, date, raw, nil
}

func readTimedTask(ctx context.Context, rest *localrest.Client, id string) (timedTask, string, error) {
	path, err := localrest.SegmentPath("tasks", id)
	if err != nil {
		return timedTask{}, "", err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return timedTask{}, "", err
	}
	var t timedTask
	if err := json.Unmarshal(data, &t); err != nil || t.ID == "" {
		return timedTask{}, "", malformedRead("task")
	}
	if len(t.SubTaskIDs) > 0 {
		return timedTask{}, "", invalid("Task " + id + " has subtasks; its time is the sum of theirs, so log time on a subtask")
	}
	return t, path, nil
}

func timeResult(data json.RawMessage, taskID, date string, payload map[string]any) (map[string]any, error) {
	var t timedTask
	if err := json.Unmarshal(data, &t); err != nil || t.ID != taskID {
		return nil, domain.TypedError{
			Code:    localrest.CodeOutcomeUnknown,
			Message: "Super Productivity answered without returning the task, so the logged time is unconfirmed. Check the task's timeSpentOnDay before retrying.",
		}
	}
	source := "caller"
	if s, ok := payload[dateSourceKey].(string); ok {
		source = s
	}
	return map[string]any{
		"taskId":     taskID,
		"date":       date,
		"dateSource": source,
		"dayTimeMs":  t.TimeSpentOnDay[date],
		"timeSpent":  t.TimeSpent,
		"via":        "localRest",
	}, nil
}

func addTime(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID, date, ms, err := timeArgs(payload, false)
	if err != nil {
		return nil, err
	}
	task, path, err := readTimedTask(ctx, rest, taskID)
	if err != nil {
		return nil, err
	}
	if task.TimeSpentOnDay[date]+ms > maxDayMs {
		return nil, invalid("That would put more than 24 hours on " + date + " for this task")
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: path + "/time", Body: map[string]any{"date": date, "duration": ms}, Mutation: true})
	if err != nil {
		return nil, err
	}
	return timeResult(data, taskID, date, payload)
}

func setTimeForDay(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID, date, ms, err := timeArgs(payload, true)
	if err != nil {
		return nil, err
	}
	_, path, err := readTimedTask(ctx, rest, taskID)
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPut, Path: path + "/time", Body: map[string]any{"date": date, "duration": ms}, Mutation: true})
	if err != nil {
		return nil, err
	}
	return timeResult(data, taskID, date, payload)
}

// logicalToday asks the plugin for the app's logical day. A host-clock
// fallback is a guess, so it is refused rather than used.
func (r *Router) logicalToday(ctx context.Context) (string, error) {
	unavailable := func(why string) error {
		return domain.TypedError{
			Code:    "DAY_CONTEXT_UNAVAILABLE",
			Message: "The app's current day could not be read (" + why + "), so the day to log time on is unknown. Pass date as YYYY-MM-DD. Nothing was changed.",
		}
	}
	plugin, err := r.pluginBridge()
	if err != nil {
		return "", unavailable("plugin bridge unavailable")
	}
	resp, err := plugin.Call(ctx, domain.Request{Action: "task.dayContext", Payload: map[string]any{}})
	if err != nil {
		return "", unavailable("plugin bridge did not answer")
	}
	today, _ := resp.Result["todayStr"].(string)
	if resp.Result["source"] != "app" || !validDate(today) {
		return "", unavailable("this app version does not report its logical day")
	}
	return today, nil
}
