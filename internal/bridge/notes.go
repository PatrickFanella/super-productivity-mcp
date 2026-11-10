package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

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
