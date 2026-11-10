package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// Recurrence writes on stock v20 go through /task-repeat-cfgs, which accepts
// only restRecurrenceWritableFields. Every request is validated in full
// before anything is sent: an unsupported field fails with UNSUPPORTED_FIELD
// and is never dropped silently.

var recurrenceKeyAliases = map[string]string{
	"repeat_cycle":                 "repeatCycle",
	"repeat_every":                 "repeatEvery",
	"quick_setting":                "quickSetting",
	"start_time":                   "startTime",
	"start_date":                   "startDate",
	"is_paused":                    "isPaused",
	"wait_for_completion":          "waitForCompletion",
	"skip_overdue":                 "skipOverdue",
	"repeat_from_completion_date":  "repeatFromCompletionDate",
	"default_estimate":             "defaultEstimate",
	"tag_ids":                      "tagIds",
	"project_id":                   "projectId",
	"should_inherit_subtasks":      "shouldInheritSubtasks",
	"disable_auto_update_subtasks": "disableAutoUpdateSubtasks",
	"sub_task_templates":           "subTaskTemplates",
}

var weekdays = []string{"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

// presetCycles is the cycle each preset quickSetting implies.
var presetCycles = map[string]string{
	"DAILY":                  "DAILY",
	"MONDAY_TO_FRIDAY":       "WEEKLY",
	"WEEKLY_CURRENT_WEEKDAY": "WEEKLY",
	"MONTHLY_CURRENT_DATE":   "MONTHLY",
	"MONTHLY_FIRST_DAY":      "MONTHLY",
	"MONTHLY_LAST_DAY":       "MONTHLY",
	"MONTHLY_NTH_WEEKDAY":    "MONTHLY",
	"YEARLY_CURRENT_DATE":    "YEARLY",
}

func invalid(msg string) error {
	return domain.TypedError{Code: "INVALID_REQUEST", Message: msg}
}

// canonicalRecurrence maps snake_case aliases to camelCase and refuses a
// field given twice with different values.
func canonicalRecurrence(in map[string]any) (map[string]any, error) {
	out := map[string]any{}
	for key, value := range in {
		name := key
		if alias, ok := recurrenceKeyAliases[key]; ok {
			name = alias
		}
		if prev, dup := out[name]; dup {
			a, _ := json.Marshal(prev)
			b, _ := json.Marshal(value)
			if string(a) != string(b) {
				return nil, invalid("recurrence field " + name + " is given twice with different values")
			}
		}
		out[name] = value
	}
	return out, nil
}

func unsupportedFields(fields map[string]any) error {
	allowed := map[string]bool{}
	for _, f := range restRecurrenceWritableFields {
		allowed[f] = true
	}
	var bad []string
	for key := range fields {
		if !allowed[key] {
			bad = append(bad, key)
		}
	}
	if len(bad) == 0 {
		return nil
	}
	sort.Strings(bad)
	return domain.TypedError{
		Code:    "UNSUPPORTED_FIELD",
		Message: "Stock Super Productivity v20 cannot write " + strings.Join(bad, ", ") + " on a repeat config. Nothing was changed. Writable fields: " + strings.Join(restRecurrenceWritableFields, ", ") + ".",
		Details: map[string]any{"fields": anyStrings(bad)},
	}
}

func anyStrings(in []string) []any {
	out := make([]any, len(in))
	for i, s := range in {
		out[i] = s
	}
	return out
}

// scheduleBody turns tool fields into a REST body. creating selects the
// create defaults; on update, current is the config being edited and must be
// set when fields change the schedule without naming quickSetting. The app changes a schedule as a whole and
// needs quickSetting with any schedule field; repeatCycle, repeatEvery and
// weekdays are only accepted with quickSetting CUSTOM.
func scheduleBody(fields map[string]any, current map[string]any, creating bool) (map[string]any, error) {
	if err := unsupportedFields(fields); err != nil {
		return nil, err
	}
	body := map[string]any{}
	for k, v := range fields {
		body[k] = v
	}
	customKeys := []string{}
	for _, k := range append([]string{"repeatCycle", "repeatEvery"}, weekdays...) {
		if _, ok := body[k]; ok {
			customKeys = append(customKeys, k)
		}
	}
	_, hasStart := body["startDate"]
	qs, hasQS := body["quickSetting"].(string)
	if !hasQS && (creating || len(customKeys) > 0 || hasStart) {
		switch {
		case creating:
			// The suite's long-standing default: daily every day, otherwise custom.
			cycle, _ := body["repeatCycle"].(string)
			if (cycle == "" || cycle == "DAILY") && everyIsOne(body) && !hasWeekday(body) {
				qs = "DAILY"
			} else {
				qs = "CUSTOM"
			}
		case current == nil:
			return nil, invalid("quickSetting is required when changing the schedule")
		case len(customKeys) > 0:
			if cur, _ := current["quickSetting"].(string); cur != "CUSTOM" {
				return nil, invalid("repeatCycle, repeatEvery and weekdays need quickSetting \"CUSTOM\"; the current schedule uses " + cur)
			}
			qs = "CUSTOM"
		default:
			// Only startDate changes: re-apply the current preset to it.
			qs, _ = current["quickSetting"].(string)
			if qs == "" {
				return nil, invalid("quickSetting is required when changing the schedule")
			}
		}
		body["quickSetting"] = qs
	}
	if qs != "" && qs != "CUSTOM" && len(customKeys) > 0 {
		// Accept fields that only restate the preset, such as the required
		// repeatCycle "DAILY" with quickSetting "DAILY"; refuse anything else.
		cycle, _ := body["repeatCycle"].(string)
		if (cycle == "" || cycle == presetCycles[qs]) && everyIsOne(body) && !hasWeekday(body) {
			delete(body, "repeatCycle")
			delete(body, "repeatEvery")
		} else {
			return nil, invalid(strings.Join(customKeys, ", ") + " can only be set with quickSetting \"CUSTOM\"")
		}
	}
	return body, nil
}

func everyIsOne(body map[string]any) bool {
	v, ok := body["repeatEvery"]
	if !ok {
		return true
	}
	n, isNum := v.(float64)
	return isNum && n == 1
}

func hasWeekday(body map[string]any) bool {
	for _, d := range weekdays {
		if _, ok := body[d]; ok {
			return true
		}
	}
	return false
}

func objectArg(payload map[string]any, keys ...string) (map[string]any, bool) {
	for _, k := range keys {
		if m, ok := payload[k].(map[string]any); ok {
			return m, true
		}
	}
	return nil, false
}

func decodeCfg(data json.RawMessage) (map[string]any, string, error) {
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil || cfg == nil {
		return nil, "", nil
	}
	id, _ := cfg["id"].(string)
	return cfg, id, nil
}

// resolveRepeatCfgID reads the task fresh and returns its repeatCfgId.
func resolveRepeatCfgID(ctx context.Context, rest *localrest.Client, taskID string) (string, error) {
	path, err := localrest.SegmentPath("tasks", taskID)
	if err != nil {
		return "", err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return "", err
	}
	var task struct {
		RepeatCfgID string `json:"repeatCfgId"`
	}
	if err := json.Unmarshal(data, &task); err != nil {
		return "", malformedRead("task")
	}
	if task.RepeatCfgID == "" {
		return "", domain.TypedError{Code: "TASK_NOT_RECURRING", Message: "Task " + taskID + " has no repeatCfgId"}
	}
	return task.RepeatCfgID, nil
}

func unconfirmed(what string) error {
	return domain.TypedError{
		Code:    localrest.CodeOutcomeUnknown,
		Message: "Super Productivity answered the " + what + " without returning the repeat config. Check it with get_task_recurrence before retrying.",
	}
}

func setRecurrence(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, invalid("taskId is required")
	}
	raw, ok := objectArg(payload, "recurrence")
	if !ok {
		return nil, invalid("recurrence is required")
	}
	fields, err := canonicalRecurrence(raw)
	if err != nil {
		return nil, err
	}
	body, err := scheduleBody(fields, nil, true)
	if err != nil {
		return nil, err
	}
	body["taskId"] = taskID
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/task-repeat-cfgs", Body: body, Mutation: true})
	if err != nil {
		return nil, err
	}
	cfg, id, _ := decodeCfg(data)
	if id == "" {
		return nil, unconfirmed("create request")
	}
	return map[string]any{"repeatCfgId": id, "created": true, "repeatCfg": cfg, "via": "localRest"}, nil
}

func updateRecurrence(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, invalid("taskId is required")
	}
	for _, k := range []string{"isAskToUpdateAllTaskInstances", "is_ask_to_update_all_task_instances"} {
		if payload[k] == true {
			return nil, domain.TypedError{Code: "UNSUPPORTED_FIELD", Message: "isAskToUpdateAllTaskInstances needs the legacy plugin route; Local REST updates the newest unfinished instance only. Nothing was changed."}
		}
	}
	raw, ok := objectArg(payload, "changes")
	if !ok {
		return nil, invalid("changes is required")
	}
	fields, err := canonicalRecurrence(raw)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return nil, domain.TypedError{Code: "NO_UPDATE_FIELDS", Message: "No recurrence changes provided"}
	}
	if err := unsupportedFields(fields); err != nil {
		return nil, err
	}
	cfgID, err := resolveRepeatCfgID(ctx, rest, taskID)
	if err != nil {
		return nil, err
	}
	cfgPath, err := localrest.SegmentPath("task-repeat-cfgs", cfgID)
	if err != nil {
		return nil, err
	}
	var current map[string]any
	if _, hasQS := fields["quickSetting"]; !hasQS && touchesSchedule(fields) {
		data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: cfgPath})
		if err != nil {
			return nil, err
		}
		if current, _, _ = decodeCfg(data); current == nil {
			return nil, malformedRead("repeat config")
		}
	}
	body, err := scheduleBody(fields, current, false)
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPatch, Path: cfgPath, Body: body, Mutation: true})
	if err != nil {
		return nil, err
	}
	cfg, id, _ := decodeCfg(data)
	if id != cfgID {
		return nil, unconfirmed("update request")
	}
	return map[string]any{"repeatCfgId": id, "updated": true, "repeatCfg": cfg, "via": "localRest"}, nil
}

func touchesSchedule(fields map[string]any) bool {
	for _, k := range append([]string{"startDate", "repeatCycle", "repeatEvery"}, weekdays...) {
		if _, ok := fields[k]; ok {
			return true
		}
	}
	return false
}

func deleteRecurrence(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, invalid("taskId is required")
	}
	cfgID, err := resolveRepeatCfgID(ctx, rest, taskID)
	if err != nil {
		return nil, err
	}
	path, err := localrest.SegmentPath("task-repeat-cfgs", cfgID)
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodDelete, Path: path, Mutation: true})
	if err != nil {
		return nil, err
	}
	var out struct {
		Deleted bool   `json:"deleted"`
		ID      string `json:"id"`
	}
	if json.Unmarshal(data, &out) != nil || !out.Deleted || out.ID != cfgID {
		return nil, unconfirmed("delete request")
	}
	// The app keeps the config's tasks; they stop repeating.
	return map[string]any{"repeatCfgId": cfgID, "deleted": true, "via": "localRest"}, nil
}
