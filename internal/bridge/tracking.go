package bridge

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// Time tracking through Local REST: GET /status for the current task and
// another device's live session, POST /task-control/current to start and
// POST /task-control/stop to stop.

type restTask struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	IsDone     bool     `json:"isDone"`
	ProjectID  *string  `json:"projectId"`
	ParentID   *string  `json:"parentId"`
	TagIDs     []string `json:"tagIds"`
	DueDay     *string  `json:"dueDay"`
	SubTaskIDs []string `json:"subTaskIds"`
}

type restStatus struct {
	CurrentTask           *restTask      `json:"currentTask"`
	TrackingOnOtherDevice map[string]any `json:"trackingOnOtherDevice"`
}

// summary is the get_current_task shape. A missing task is an untyped nil,
// so the result holds JSON null rather than a typed nil map.
func (t *restTask) summary() any {
	if t == nil {
		return nil
	}
	tagIDs := make([]any, len(t.TagIDs))
	for i, id := range t.TagIDs {
		tagIDs[i] = id
	}
	return map[string]any{
		"id":        t.ID,
		"title":     t.Title,
		"isDone":    t.IsDone,
		"projectId": strOrNil(t.ProjectID),
		"parentId":  strOrNil(t.ParentID),
		"tagIds":    tagIDs,
		"dueDay":    strOrNil(t.DueDay),
	}
}

func strOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func readStatus(ctx context.Context, rest *localrest.Client) (restStatus, error) {
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: "/status"})
	if err != nil {
		return restStatus{}, err
	}
	var st restStatus
	if err := json.Unmarshal(data, &st); err != nil {
		return restStatus{}, malformedRead("status")
	}
	return st, nil
}

func readTask(ctx context.Context, rest *localrest.Client, id string) (restTask, error) {
	path, err := localrest.SegmentPath("tasks", id)
	if err != nil {
		return restTask{}, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return restTask{}, err
	}
	var t restTask
	if err := json.Unmarshal(data, &t); err != nil || t.ID == "" {
		return restTask{}, malformedRead("task")
	}
	return t, nil
}

func currentTask(ctx context.Context, rest *localrest.Client, _ map[string]any) (map[string]any, error) {
	st, err := readStatus(ctx, rest)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"task":                  st.CurrentTask.summary(),
		"trackingOnOtherDevice": nilIfEmpty(st.TrackingOnOtherDevice),
		"via":                   "localRest",
	}, nil
}

func nilIfEmpty(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

// startTask checks the task the way PluginAPI.startTracking does (a done
// task, or a parent whose subtasks are all done, cannot be tracked), then
// refuses to take tracking over from another device unless the caller passed
// takeover:true. The app tracks a parent's first unfinished subtask.
func startTask(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, invalid("taskId is required")
	}
	takeover := payload["takeover"] == true
	task, err := readTask(ctx, rest, taskID)
	if err != nil {
		return nil, err
	}
	if task.IsDone {
		return nil, domain.TypedError{Code: "TASK_DONE", Message: "Cannot start completed task " + taskID + "; mark it not done first"}
	}
	if len(task.SubTaskIDs) > 0 {
		open := false
		for _, id := range task.SubTaskIDs {
			sub, err := readTask(ctx, rest, id)
			if err != nil {
				return nil, err
			}
			if !sub.IsDone {
				open = true
				break
			}
		}
		if !open {
			return nil, domain.TypedError{Code: "TASK_DONE", Message: "All subtasks of " + taskID + " are done; mark one as not done first"}
		}
	}
	st, err := readStatus(ctx, rest)
	if err != nil {
		return nil, err
	}
	if st.TrackingOnOtherDevice != nil && !takeover {
		return nil, domain.TypedError{
			Code:    "TRACKING_ON_OTHER_DEVICE",
			Message: "Another device is tracking time. Starting here would take tracking over from it; pass takeover:true to do that. Nothing was changed.",
			Details: map[string]any{"trackingOnOtherDevice": st.TrackingOnOtherDevice},
		}
	}
	if _, err := rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/task-control/current", Body: map[string]any{"taskId": taskID}, Mutation: true}); err != nil {
		return nil, err
	}
	result := map[string]any{"started": true, "via": "localRest", "takeover": st.TrackingOnOtherDevice != nil}
	// Read back which task is tracked: for a parent it is a subtask.
	if after, err := readStatus(ctx, rest); err == nil && after.CurrentTask != nil {
		result["trackedTaskId"] = after.CurrentTask.ID
	}
	return result, nil
}

func stopTask(ctx context.Context, rest *localrest.Client, _ map[string]any) (map[string]any, error) {
	st, err := readStatus(ctx, rest)
	if err != nil {
		return nil, err
	}
	if st.CurrentTask == nil {
		return map[string]any{"stopped": false, "via": "localRest"}, nil
	}
	if _, err := rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/task-control/stop", Mutation: true}); err != nil {
		return nil, err
	}
	return map[string]any{"stopped": true, "via": "localRest", "taskId": st.CurrentTask.ID}, nil
}
