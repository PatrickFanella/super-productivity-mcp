package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// create_task with a compact repeat argument is one coordinated operation on
// stock v20: validate the repeat, check Local REST, create the task once
// through the plugin without repeat, then attach the recurrence with
// POST /task-repeat-cfgs. The task's time (set by the plugin) becomes the
// recurrence time. If attaching fails, the created task id is returned with
// recurrenceError; creation is never retried.

var compactWeekdays = map[string]string{"mon": "monday", "tue": "tuesday", "wed": "wednesday", "thu": "thursday", "fri": "friday", "sat": "saturday", "sun": "sunday"}

// presetFor is the quickSetting for a compact cycle repeating every period.
var presetFor = map[string]string{"daily": "DAILY", "weekly": "WEEKLY_CURRENT_WEEKDAY", "monthly": "MONTHLY_CURRENT_DATE", "yearly": "YEARLY_CURRENT_DATE"}

// compactRepeatBody turns {cycle, every?, weekdays?} into a REST repeat
// body. startDay is the first day (YYYY-MM-DD), used for the default weekday
// of a weekly repeat every N > 1 weeks; it may be "" when not needed.
func compactRepeatBody(repeat map[string]any, startDay func() (string, error)) (map[string]any, error) {
	for key := range repeat {
		if key != "cycle" && key != "every" && key != "weekdays" {
			return nil, invalid("Unknown argument: repeat." + key)
		}
	}
	cycle, _ := repeat["cycle"].(string)
	preset, ok := presetFor[cycle]
	if !ok {
		return nil, invalid("repeat.cycle must be one of daily, weekly, monthly, yearly")
	}
	every := 1.0
	if raw, present := repeat["every"]; present {
		n, isNum := raw.(float64)
		if !isNum || n != float64(int(n)) || n < 1 || n > 99 {
			return nil, invalid("repeat.every must be a whole number from 1 to 99")
		}
		every = n
	}
	var days []string
	if raw, present := repeat["weekdays"]; present {
		if cycle != "weekly" {
			return nil, invalid("repeat.weekdays needs cycle weekly")
		}
		list, isList := raw.([]any)
		seen := map[string]bool{}
		for _, d := range list {
			s, _ := d.(string)
			if compactWeekdays[s] == "" || seen[s] {
				return nil, invalid("repeat.weekdays must be distinct days out of mon, tue, wed, thu, fri, sat, sun")
			}
			seen[s] = true
			days = append(days, compactWeekdays[s])
		}
		if !isList || len(days) == 0 {
			return nil, invalid("repeat.weekdays must be distinct days out of mon, tue, wed, thu, fri, sat, sun")
		}
	}
	if every == 1 && days == nil {
		// A preset follows the start date, as the app's repeat dialog does.
		return map[string]any{"quickSetting": preset}, nil
	}
	body := map[string]any{"quickSetting": "CUSTOM", "repeatCycle": strings.ToUpper(cycle), "repeatEvery": every}
	if cycle == "weekly" {
		if days == nil {
			day, err := startDay()
			if err != nil {
				return nil, err
			}
			t, _ := time.Parse("2006-01-02", day)
			days = []string{strings.ToLower(t.Weekday().String())}
		}
		for _, d := range weekdays {
			body[d] = false
		}
		for _, d := range days {
			body[d] = true
		}
	}
	return body, nil
}

func (r *Router) createWithRepeat(ctx context.Context, req domain.Request) (domain.Response, error) {
	repeat, ok := req.Payload["repeat"].(map[string]any)
	if !ok {
		return domain.Response{}, invalid("repeat must be an object")
	}
	if stringArg(req.Payload, "parentId", "parent_id") != "" {
		// The app refuses to make a subtask repeat; refuse before creating it.
		return domain.Response{}, invalid("A subtask cannot repeat; create a top-level task with repeat, or drop parentId")
	}
	// Validate now. A placeholder start day is enough: the real one is only
	// needed for a weekly repeat every N weeks without weekdays.
	if _, err := compactRepeatBody(repeat, func() (string, error) { return "2000-01-03", nil }); err != nil {
		return domain.Response{}, err
	}
	dueDate := stringArg(req.Payload, "dueDate", "due_date")
	hasTime := stringArg(req.Payload, "dueTime", "due_time") != ""
	// Check the attach route itself before creating anything. A project id
	// that matches nothing keeps the answer empty.
	probe := localrest.Request{Method: http.MethodGet, Path: "/task-repeat-cfgs", Query: url.Values{"projectId": {"mcp-route-probe"}}}
	if _, err := r.rest.Do(ctx, probe); err != nil {
		return domain.Response{}, err
	}
	plugin, err := r.pluginBridge()
	if err != nil {
		return domain.Response{}, err
	}
	createPayload := cloneWith(req.Payload, nil)
	delete(createPayload, "repeat")
	created, err := plugin.Call(ctx, domain.Request{Action: "task.create", Payload: createPayload})
	if err != nil {
		return domain.Response{}, err
	}
	taskID, _ := created.Result["taskId"].(string)
	if taskID == "" {
		return created, nil
	}
	result := cloneWith(created.Result, nil)
	fail := func(err error) (domain.Response, error) {
		var te domain.TypedError
		if !errors.As(err, &te) {
			te = domain.TypedError{Code: "RECURRENCE_FAILED", Message: err.Error()}
		}
		// The task exists: report the failure next to its id so nobody
		// retries the creation.
		result["recurrenceError"] = map[string]any{"code": te.Code, "message": te.Message}
		return domain.Response{Result: result}, nil
	}
	body, err := compactRepeatBody(repeat, func() (string, error) {
		if dueDate != "" {
			return dueDate, nil
		}
		// The app starts the recurrence on the task's day, which short syntax
		// such as @fri may have set; read it back.
		if day, err := r.taskDay(ctx, taskID); err != nil || day != "" {
			return day, err
		}
		return r.logicalToday(ctx)
	})
	if err != nil {
		return fail(err)
	}
	// With a time, the app derives the start from the task's own day; a
	// startDate earlier than its logical today would be refused.
	if dueDate != "" && !hasTime {
		body["startDate"] = dueDate
	}
	body["taskId"] = taskID
	data, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/task-repeat-cfgs", Body: body, Mutation: true})
	if err != nil {
		return fail(err)
	}
	if _, id, _ := decodeCfg(data); id != "" {
		result["repeatCfgId"] = id
		return domain.Response{Result: result}, nil
	}
	return fail(unconfirmed("recurrence attach"))
}

// taskDay is the day a task is filed under: its dueDay, or the local day of
// its dueWithTime; "" when it has neither.
func (r *Router) taskDay(ctx context.Context, taskID string) (string, error) {
	path, err := localrest.SegmentPath("tasks", taskID)
	if err != nil {
		return "", err
	}
	data, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return "", err
	}
	var task struct {
		DueDay      string  `json:"dueDay"`
		DueWithTime float64 `json:"dueWithTime"`
	}
	if err := json.Unmarshal(data, &task); err != nil {
		return "", malformedRead("task")
	}
	if validDate(task.DueDay) {
		return task.DueDay, nil
	}
	if task.DueWithTime > 0 {
		return time.UnixMilli(int64(task.DueWithTime)).Format("2006-01-02"), nil
	}
	return "", nil
}
