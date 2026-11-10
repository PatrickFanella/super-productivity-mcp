package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// restRecurrenceWritableFields are the repeat-config fields stock v20 accepts
// on POST and PATCH /task-repeat-cfgs (taskId is create-only). Every other
// field, such as startTime, remindAt, notes, subTaskTemplates,
// repeatFromCompletionDate, waitForCompletion or repeatUntilDay, can be read
// but not written through a supported route. The plugin bridge mirrors this
// list in plugin/bridge/actions/task-recurrence.js.
var restRecurrenceWritableFields = []string{
	"quickSetting", "startDate", "repeatCycle", "repeatEvery",
	"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
	"isPaused", "skipOverdue",
}

// writableFields reports, per adapter, which repeat-config fields a write can
// change. Stock v20 refuses the plugin's repeat-config dispatches, so the
// plugin list is empty.
//
// Results hold JSON-shaped values ([]any, not []string) because the MCP
// adapter validates them against the catalog's output schema.
func writableFields() map[string]any {
	local := make([]any, len(restRecurrenceWritableFields))
	for i, f := range restRecurrenceWritableFields {
		local[i] = f
	}
	return map[string]any{"localRest": local, "plugin": []any{}}
}

func listRecurrences(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	req := localrest.Request{Method: http.MethodGet, Path: "/task-repeat-cfgs"}
	if projectID := stringArg(payload, "projectId", "project_id"); projectID != "" {
		req.Query = url.Values{"projectId": {projectID}}
	}
	data, err := rest.Do(ctx, req)
	if err != nil {
		return nil, err
	}
	var cfgs []map[string]any
	if err := json.Unmarshal(data, &cfgs); err != nil {
		return nil, malformedRead("repeat configs")
	}
	fields := fieldsArg(payload)
	out := make([]any, 0, len(cfgs))
	for _, cfg := range cfgs {
		out = append(out, project(cfg, fields))
	}
	return map[string]any{"repeatCfgs": out, "via": "localRest", "writableFields": writableFields()}, nil
}

func getRecurrence(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	cfgID := stringArg(payload, "repeatCfgId", "repeat_cfg_id")
	taskID := stringArg(payload, "taskId", "task_id")
	if cfgID == "" && taskID == "" {
		return nil, domain.TypedError{Code: "INVALID_REQUEST", Message: "repeatCfgId or taskId is required"}
	}
	result := map[string]any{"via": "localRest", "writableFields": writableFields()}
	if cfgID == "" {
		// Resolve from a fresh task read: a task's repeatCfgId can change.
		path, err := localrest.SegmentPath("tasks", taskID)
		if err != nil {
			return nil, err
		}
		data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
		if err != nil {
			return nil, err
		}
		var task struct {
			RepeatCfgID string `json:"repeatCfgId"`
		}
		if err := json.Unmarshal(data, &task); err != nil {
			return nil, malformedRead("task")
		}
		if task.RepeatCfgID == "" {
			return nil, domain.TypedError{Code: "TASK_NOT_RECURRING", Message: "Task " + taskID + " has no repeatCfgId"}
		}
		cfgID = task.RepeatCfgID
		result["taskId"] = taskID
	}
	path, err := localrest.SegmentPath("task-repeat-cfgs", cfgID)
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return nil, err
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil || cfg == nil {
		return nil, malformedRead("repeat config")
	}
	result["repeatCfg"] = project(cfg, fieldsArg(payload))
	return result, nil
}

func malformedRead(what string) error {
	return domain.TypedError{Code: localrest.CodeMalformedResponse, Message: "Local REST returned an unreadable " + what}
}

// fieldsArg returns the requested field projection, or nil for all fields.
func fieldsArg(payload map[string]any) []string {
	raw, ok := payload["fields"].([]any)
	if !ok || len(raw) == 0 {
		return nil
	}
	fields := make([]string, 0, len(raw))
	for _, f := range raw {
		if s, ok := f.(string); ok {
			fields = append(fields, s)
		}
	}
	return fields
}

// project keeps the requested fields; id is always kept so a result can be
// used for a later edit.
func project(cfg map[string]any, fields []string) map[string]any {
	if fields == nil {
		return cfg
	}
	out := map[string]any{}
	if id, ok := cfg["id"]; ok {
		out["id"] = id
	}
	for _, f := range fields {
		if v, ok := cfg[f]; ok {
			out[f] = v
		}
	}
	return out
}
