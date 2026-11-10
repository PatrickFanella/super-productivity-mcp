package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"sort"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// Habit history is the app's simple counters (click counters, stopwatches,
// repeated countdown reminders) with their per-day values. Stopwatch values
// are milliseconds; the others are counts.

const maxSafeInteger = 1<<53 - 1

type simpleCounter struct {
	ID         string             `json:"id"`
	Title      string             `json:"title"`
	Type       string             `json:"type"`
	IsEnabled  bool               `json:"isEnabled"`
	IsOn       bool               `json:"isOn"`
	CountOnDay map[string]float64 `json:"countOnDay"`
}

func habitUnit(kind string) string {
	if kind == "StopWatch" {
		return "ms"
	}
	return "count"
}

func (c simpleCounter) view(start, end string) map[string]any {
	dates := make([]string, 0, len(c.CountOnDay))
	for d := range c.CountOnDay {
		if (start == "" || d >= start) && (end == "" || d <= end) {
			dates = append(dates, d)
		}
	}
	sort.Strings(dates)
	days := make([]any, len(dates))
	for i, d := range dates {
		days[i] = map[string]any{"date": d, "value": c.CountOnDay[d]}
	}
	return map[string]any{"id": c.ID, "title": c.Title, "type": c.Type, "unit": habitUnit(c.Type), "isEnabled": c.IsEnabled, "isOn": c.IsOn, "days": days}
}

func historyRange(payload map[string]any) (string, string, string, error) {
	id := stringArg(payload, "counterId", "counter_id", "id")
	start := stringArg(payload, "startDate", "start_date")
	end := stringArg(payload, "endDate", "end_date")
	for name, v := range map[string]string{"startDate": start, "endDate": end} {
		if v != "" && !validDate(v) {
			return "", "", "", invalid(name + " must be a valid YYYY-MM-DD date")
		}
	}
	if start != "" && end != "" && end < start {
		return "", "", "", invalid("endDate must not be before startDate")
	}
	return id, start, end, nil
}

func restHabitHistory(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	id, start, end, err := historyRange(payload)
	if err != nil {
		return nil, err
	}
	var counters []simpleCounter
	if id != "" {
		path, err := localrest.SegmentPath("simple-counters", id)
		if err != nil {
			return nil, err
		}
		data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
		if err != nil {
			return nil, err
		}
		var c simpleCounter
		if json.Unmarshal(data, &c) != nil || c.ID == "" {
			return nil, malformedRead("simple counter")
		}
		counters = []simpleCounter{c}
	} else {
		data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: "/simple-counters"})
		if err != nil {
			return nil, err
		}
		if json.Unmarshal(data, &counters) != nil {
			return nil, malformedRead("simple counters")
		}
	}
	out := make([]any, len(counters))
	for i, c := range counters {
		out[i] = c.view(start, end)
	}
	return map[string]any{"counters": out, "via": "localRest"}, nil
}

// habitHistory reads through the plugin's getAllSimpleCounters, and through
// Local REST when the plugin lacks that method or its bridge cannot start.
// Only this read falls back, because it changes nothing; any other plugin
// error is returned.
func (r *Router) habitHistory(ctx context.Context, req domain.Request) (domain.Response, error) {
	if _, _, _, err := historyRange(req.Payload); err != nil {
		return domain.Response{}, err
	}
	plugin, err := r.pluginBridge()
	if err == nil {
		resp, callErr := plugin.Call(ctx, req)
		var te domain.TypedError
		if callErr == nil || !errors.As(callErr, &te) || te.Code != "UNSUPPORTED_ACTION" || r.rest == nil {
			return resp, callErr
		}
	} else if r.rest == nil {
		return domain.Response{}, err
	}
	if r.restErr != nil {
		return domain.Response{}, r.restErr
	}
	result, err := restHabitHistory(ctx, r.rest, req.Payload)
	if err != nil {
		return domain.Response{}, err
	}
	return domain.Response{Result: result}, nil
}

// setHabitDay sets one day's value with PUT /simple-counters/:id/value. Other
// days are kept; repeating the call changes nothing. Without date the app
// uses its own logical today.
func setHabitDay(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	id := stringArg(payload, "counterId", "counter_id", "id")
	if id == "" {
		return nil, invalid("counterId is required")
	}
	value, ok := payload["value"].(float64)
	if !ok || value < 0 || value != math.Trunc(value) || value > maxSafeInteger {
		return nil, invalid("value must be a whole number from 0 (milliseconds for a stopwatch)")
	}
	body := map[string]any{"value": value}
	date := stringArg(payload, "date")
	if date != "" {
		if !validDate(date) {
			return nil, invalid("date must be a valid YYYY-MM-DD date")
		}
		body["date"] = date
	}
	path, err := localrest.SegmentPath("simple-counters", id, "value")
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPut, Path: path, Body: body, Mutation: true})
	if err != nil {
		return nil, err
	}
	var c simpleCounter
	if json.Unmarshal(data, &c) != nil || c.ID != id {
		return nil, domain.TypedError{Code: localrest.CodeOutcomeUnknown, Message: "Super Productivity answered without returning the counter. Check it with get_habit_history before retrying."}
	}
	out := map[string]any{"counter": c.view("", ""), "via": "localRest"}
	if date != "" {
		out["date"] = date
		out["dayValue"] = c.CountOnDay[date]
	} else {
		out["date"] = nil
		out["dateSource"] = "app"
	}
	return out, nil
}
