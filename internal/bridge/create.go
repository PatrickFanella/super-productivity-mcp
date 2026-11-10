package bridge

import (
	"context"
	"errors"
	"net/http"
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
	dueDate := stringArg(req.Payload, "dueDate", "due_date")
	body, err := compactRepeatBody(repeat, func() (string, error) {
		if dueDate != "" {
			return dueDate, nil
		}
		return r.logicalToday(ctx)
	})
	if err != nil {
		return domain.Response{}, err
	}
	if dueDate != "" {
		body["startDate"] = dueDate
	}
	// Check the attach route before creating anything.
	if _, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: "/status"}); err != nil {
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
	body["taskId"] = taskID
	data, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/task-repeat-cfgs", Body: body, Mutation: true})
	if err == nil {
		if _, id, _ := decodeCfg(data); id != "" {
			result["repeatCfgId"] = id
			return domain.Response{Result: result}, nil
		}
		err = unconfirmed("recurrence attach")
	}
	var te domain.TypedError
	if !errors.As(err, &te) {
		te = domain.TypedError{Code: "RECURRENCE_FAILED", Message: err.Error()}
	}
	// The task exists: report the failure next to its id so nobody retries
	// the creation.
	result["recurrenceError"] = map[string]any{"code": te.Code, "message": te.Message}
	return domain.Response{Result: result}, nil
}
