package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

func domainError(code, msg string) error { return domain.TypedError{Code: code, Message: msg} }

// Standalone notes (project notes and notes pinned to Today) through Local
// REST GET /notes and /notes/:id. The MCP adapter only lets these reads run
// with both the read and notes scopes.

// noteView keeps the fields the note tools promise: placement metadata is
// always explicit, never omitted.
func noteView(n map[string]any) map[string]any {
	out := map[string]any{
		"id":              n["id"],
		"content":         n["content"],
		"projectId":       n["projectId"],
		"isPinnedToToday": n["isPinnedToToday"] == true,
	}
	for _, k := range []string{"created", "modified"} {
		if v, ok := n[k]; ok {
			out[k] = v
		}
	}
	return out
}

func listNotes(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	req := localrest.Request{Method: http.MethodGet, Path: "/notes"}
	if projectID := stringArg(payload, "projectId", "project_id"); projectID != "" {
		req.Query = url.Values{"projectId": {projectID}}
	}
	data, err := rest.Do(ctx, req)
	if err != nil {
		return nil, err
	}
	var notes []map[string]any
	if err := json.Unmarshal(data, &notes); err != nil {
		return nil, malformedRead("notes")
	}
	pinnedOnly := payload["pinnedToToday"] == true
	out := []any{}
	for _, n := range notes {
		if pinnedOnly && n["isPinnedToToday"] != true {
			continue
		}
		out = append(out, noteView(n))
	}
	return map[string]any{"notes": out, "via": "localRest"}, nil
}

func getNote(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	id := stringArg(payload, "noteId", "note_id", "id")
	if id == "" {
		return nil, invalid("noteId is required")
	}
	path, err := localrest.SegmentPath("notes", id)
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return nil, err
	}
	var n map[string]any
	if err := json.Unmarshal(data, &n); err != nil || n["id"] != id {
		return nil, malformedRead("note")
	}
	return map[string]any{"note": noteView(n), "via": "localRest"}, nil
}

// Note writes through POST, PATCH and DELETE /notes. Placement follows stock
// v20: a note needs a project or a Today pin, a note without a project stays
// pinned, and a move to another project is a request of its own. Results
// carry ids and placement, never the note body.

func noteWriteResult(data []byte, wantID string) (map[string]any, error) {
	var n map[string]any
	if json.Unmarshal(data, &n) != nil || n == nil {
		return nil, unconfirmedNote()
	}
	id, _ := n["id"].(string)
	if id == "" || (wantID != "" && id != wantID) {
		return nil, unconfirmedNote()
	}
	return map[string]any{"noteId": id, "projectId": n["projectId"], "isPinnedToToday": n["isPinnedToToday"] == true, "via": "localRest"}, nil
}

func unconfirmedNote() error {
	return domainError(localrest.CodeOutcomeUnknown, "Super Productivity answered without returning the note. Check it with get_notes before retrying.")
}

func createNote(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	content, ok := payload["content"].(string)
	if !ok || strings.TrimSpace(content) == "" {
		return nil, invalid("content must be a non-empty string")
	}
	body := map[string]any{"content": content}
	projectID, hasProject := payload["projectId"]
	if hasProject && projectID != nil {
		if s, isStr := projectID.(string); !isStr || s == "" {
			return nil, invalid("projectId must be a project id or null")
		}
		body["projectId"] = projectID
	}
	pinned := false
	if v, has := payload["isPinnedToToday"]; has {
		b, isBool := v.(bool)
		if !isBool {
			return nil, invalid("isPinnedToToday must be a boolean")
		}
		pinned = b
		body["isPinnedToToday"] = b
	}
	if body["projectId"] == nil && !pinned {
		return nil, invalid("A note needs a projectId or isPinnedToToday: true")
	}
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodPost, Path: "/notes", Body: body, Mutation: true})
	if err != nil {
		return nil, err
	}
	out, err := noteWriteResult(data, "")
	if err != nil {
		return nil, err
	}
	out["created"] = true
	return out, nil
}

func updateNote(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	id := stringArg(payload, "noteId", "note_id")
	if id == "" {
		return nil, invalid("noteId is required")
	}
	body := map[string]any{}
	if v, has := payload["content"]; has {
		if _, isStr := v.(string); !isStr {
			return nil, invalid("content must be a string")
		}
		body["content"] = v
	}
	if v, has := payload["isPinnedToToday"]; has {
		if _, isBool := v.(bool); !isBool {
			return nil, invalid("isPinnedToToday must be a boolean")
		}
		body["isPinnedToToday"] = v
	}
	if v, has := payload["projectId"]; has {
		if s, isStr := v.(string); !isStr || s == "" {
			return nil, invalid("projectId must be a project id; a note's project cannot be removed")
		}
		body["projectId"] = v
	}
	if len(body) == 0 {
		return nil, domainError("NO_UPDATE_FIELDS", "No note changes provided")
	}
	path, err := localrest.SegmentPath("notes", id)
	if err != nil {
		return nil, err
	}
	// Read the note fresh: whether projectId is a move, and whether the
	// result keeps the note visible, depend on its current placement.
	data, err := rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: path})
	if err != nil {
		return nil, err
	}
	var current map[string]any
	if json.Unmarshal(data, &current) != nil || current["id"] != id {
		return nil, malformedRead("note")
	}
	isMove := body["projectId"] != nil && body["projectId"] != current["projectId"]
	_, editsContent := body["content"]
	_, editsPin := body["isPinnedToToday"]
	if isMove && (editsContent || editsPin) {
		return nil, invalid("Move a note to another project on its own request, without content or isPinnedToToday")
	}
	finalProject := current["projectId"]
	if isMove {
		finalProject = body["projectId"]
	}
	finalPinned := current["isPinnedToToday"] == true
	if editsPin {
		finalPinned = body["isPinnedToToday"] == true
	}
	if finalProject == nil && !finalPinned {
		return nil, invalid("A note without a project must stay pinned to Today")
	}
	data, err = rest.Do(ctx, localrest.Request{Method: http.MethodPatch, Path: path, Body: body, Mutation: true})
	if err != nil {
		return nil, err
	}
	out, err := noteWriteResult(data, id)
	if err != nil {
		return nil, err
	}
	out["updated"] = true
	out["moved"] = isMove
	return out, nil
}

func deleteNote(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	id := stringArg(payload, "noteId", "note_id")
	if id == "" {
		return nil, invalid("noteId is required")
	}
	path, err := localrest.SegmentPath("notes", id)
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
	if json.Unmarshal(data, &out) != nil || !out.Deleted || out.ID != id {
		return nil, unconfirmedNote()
	}
	return map[string]any{"noteId": id, "deleted": true, "via": "localRest"}, nil
}
