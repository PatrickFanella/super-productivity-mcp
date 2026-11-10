// Package bridge builds the domain.Bridge both command entrypoints use and
// routes each catalog action to one adapter: Super Productivity's Local REST
// API for the actions mapped in restRoutes, plugin IPC for the rest.
//
// The route is chosen from configuration alone, before anything is sent, and
// a failed REST call is returned as is: it is never replayed through plugin
// IPC, because the first attempt may already have changed data.
package bridge

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
	"github.com/PatrickFanella/super-productivity-mcp/internal/pluginipc"
)

// restRoute delivers one catalog action through Local REST.
type restRoute func(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error)

// route maps an action to Local REST. needsREST marks actions with no
// supported plugin path on stock v20: without REST they fail before
// anything is sent instead of reaching the plugin.
//
// needsDay marks actions whose optional date defaults to the app's logical
// day; the router reads it from the plugin before sending.
type route struct {
	rest      restRoute
	needsREST bool
	needsDay  bool
}

// restRoutes are the actions that use Local REST when it is configured.
var restRoutes = map[string]route{
	"task.archive": {rest: archiveTask},
	"task.restore": {rest: restoreTask},

	"task.start":   {rest: startTask},
	"task.stop":    {rest: stopTask},
	"task.current": {rest: currentTask},

	"note.list": {rest: listNotes},
	"note.get":  {rest: getNote},

	"note.create": {rest: createNote, needsREST: true},
	"note.update": {rest: updateNote, needsREST: true},
	"note.delete": {rest: deleteNote, needsREST: true},

	"focus.state":    {rest: focusState, needsREST: true},
	"counter.setDay": {rest: setHabitDay, needsREST: true},

	"task.addTime":       {rest: addTime, needsREST: true, needsDay: true},
	"task.setTimeForDay": {rest: setTimeForDay, needsREST: true, needsDay: true},

	"task.listRecurrences": {rest: listRecurrences},
	"task.getRecurrence":   {rest: getRecurrence},

	"task.setRecurrence":    {rest: setRecurrence, needsREST: true},
	"task.updateRecurrence": {rest: updateRecurrence, needsREST: true},
	"task.deleteRecurrence": {rest: deleteRecurrence, needsREST: true},
}

// legacyRecurrenceActions go to the plugin's repeat-config dispatch when
// SP_MCP_RECURRENCE_ROUTE=plugin selects it. Stock v20 refuses those
// dispatches; only a patched app that allows them should select it.
var legacyRecurrenceActions = map[string]bool{
	"task.setRecurrence":    true,
	"task.updateRecurrence": true,
	"task.deleteRecurrence": true,
}

// Router implements domain.Bridge over Local REST and plugin IPC.
type Router struct {
	rest    *localrest.Client
	restErr error // set when REST was configured but is unusable
	// legacyRecurrence sends recurrence writes to the plugin's dispatch.
	legacyRecurrence bool

	newPlugin func() (domain.Bridge, error)
	mu        sync.Mutex
	plugin    domain.Bridge
}

var _ domain.Bridge = (*Router)(nil)

// New builds the router from configuration. It never fails: an unusable
// Local REST setting is reported by RESTError and by every REST-mapped call,
// and plugin IPC is set up on first use.
func New(cfg config.Config) *Router {
	r := &Router{
		newPlugin:        func() (domain.Bridge, error) { return pluginipc.NewClient(cfg) },
		legacyRecurrence: cfg.RecurrenceRoute == config.RecurrenceRoutePlugin,
	}
	if strings.TrimSpace(cfg.LocalRESTURL) != "" {
		r.rest, r.restErr = localrest.New(localrest.Config{
			BaseURL:     cfg.LocalRESTURL,
			Token:       cfg.LocalRESTToken,
			AllowRemote: cfg.LocalRESTAllowRemote,
			Timeout:     cfg.LocalRESTTimeout,
		})
	}
	return r
}

// NewWith builds a router from explicit adapters. rest may be nil (REST not
// configured); newPlugin is called at most once successfully.
func NewWith(rest *localrest.Client, newPlugin func() (domain.Bridge, error)) *Router {
	return &Router{rest: rest, newPlugin: newPlugin}
}

// RESTError reports why configured Local REST settings cannot be used, or nil.
func (r *Router) RESTError() error { return r.restErr }

// Call delivers req through the adapter its action is routed to.
func (r *Router) Call(ctx context.Context, req domain.Request) (domain.Response, error) {
	// create_task with repeat attaches the recurrence through REST after the
	// plugin creates the task; without REST it needs the legacy plugin route.
	if req.Action == "task.create" && req.Payload["repeat"] != nil && !r.legacyRecurrence {
		if r.restErr != nil {
			return domain.Response{}, r.restErr
		}
		if r.rest == nil {
			return domain.Response{}, domain.TypedError{
				Code:    "UNSUPPORTED_ACTION",
				Message: "repeat needs Local REST (SP_LOCAL_REST_URL and SP_LOCAL_REST_TOKEN) on stock Super Productivity v20; create the task without repeat, or use SP_MCP_RECURRENCE_ROUTE=plugin on a patched build. Nothing was created.",
			}
		}
		return r.createWithRepeat(ctx, req)
	}
	if req.Action == "counter.history" {
		return r.habitHistory(ctx, req)
	}
	// A deadline edit goes, whole, through the app's deadline-aware REST path.
	if req.Action == "task.update" && hasDeadline(req.Payload) {
		return r.updateWithDeadline(ctx, req)
	}
	// Status and capabilities describe both adapters, so the router answers
	// them itself with bounded probes. bridge.health stays plugin-only.
	switch req.Action {
	case "bridge.status":
		return domain.Response{Result: r.status(ctx)}, nil
	case "bridge.capabilities":
		return domain.Response{Result: r.capabilities(ctx)}, nil
	}
	if rt, ok := restRoutes[req.Action]; ok && !(r.legacyRecurrence && legacyRecurrenceActions[req.Action]) {
		if r.restErr != nil {
			return domain.Response{}, r.restErr
		}
		if r.rest != nil {
			payload := req.Payload
			if rt.needsDay && stringArg(payload, "date") == "" {
				today, err := r.logicalToday(ctx)
				if err != nil {
					return domain.Response{}, err
				}
				payload = cloneWith(payload, map[string]any{"date": today, dateSourceKey: "app"})
			}
			result, err := rt.rest(ctx, r.rest, payload)
			if err != nil {
				return domain.Response{}, err
			}
			return domain.Response{Result: result}, nil
		}
		if rt.needsREST {
			msg := "This needs Super Productivity's Local REST API: set SP_LOCAL_REST_URL (stock v20: http://127.0.0.1:3876) and SP_LOCAL_REST_TOKEN. Nothing was changed."
			if legacyRecurrenceActions[req.Action] {
				msg += " Only on an app build that allows plugin repeat-config actions, SP_MCP_RECURRENCE_ROUTE=plugin selects the legacy plugin path instead."
			}
			return domain.Response{}, domain.TypedError{Code: "UNSUPPORTED_ACTION", Message: msg}
		}
	}
	plugin, err := r.pluginBridge()
	if err != nil {
		return domain.Response{}, err
	}
	return plugin.Call(ctx, req)
}

// pluginBridge creates the plugin IPC client on first use, so an action
// routed to REST never waits on, or fails because of, the plugin's data
// directories.
func (r *Router) pluginBridge() (domain.Bridge, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.plugin != nil {
		return r.plugin, nil
	}
	plugin, err := r.newPlugin()
	if err != nil {
		return nil, domain.TypedError{Code: "BRIDGE_INIT_FAILED", Message: "could not prepare the plugin bridge data directories: " + err.Error()}
	}
	r.plugin = plugin
	return plugin, nil
}

// stringArg returns the first non-empty string among the given payload keys.
func stringArg(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if s, ok := payload[key].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

func archiveTask(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, domain.TypedError{Code: "INVALID_REQUEST", Message: "taskId is required"}
	}
	path, err := localrest.SegmentPath("tasks", taskID, "archive")
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: "POST", Path: path, Mutation: true})
	if err != nil {
		return nil, err
	}
	var out struct {
		Archived bool `json:"archived"`
	}
	if json.Unmarshal(data, &out) != nil || !out.Archived {
		return nil, domain.TypedError{
			Code:    localrest.CodeOutcomeUnknown,
			Message: "Super Productivity answered the archive request without confirming it. Check the task with get_tasks source:\"archived\" before retrying.",
		}
	}
	return map[string]any{"archived": true, "via": "localRest"}, nil
}

func restoreTask(ctx context.Context, rest *localrest.Client, payload map[string]any) (map[string]any, error) {
	taskID := stringArg(payload, "taskId", "task_id")
	if taskID == "" {
		return nil, domain.TypedError{Code: "INVALID_REQUEST", Message: "taskId is required"}
	}
	path, err := localrest.SegmentPath("tasks", taskID, "restore")
	if err != nil {
		return nil, err
	}
	data, err := rest.Do(ctx, localrest.Request{Method: "POST", Path: path, Mutation: true})
	if err != nil {
		return nil, err
	}
	// The app answers with the restored task once it has left the archive.
	var task struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(data, &task) != nil || task.ID != taskID {
		return nil, domain.TypedError{
			Code:    localrest.CodeOutcomeUnknown,
			Message: "Super Productivity answered the restore request without returning the task. Check it with get_tasks source:\"all\" before retrying.",
		}
	}
	return map[string]any{"restored": true, "via": "localRest", "taskId": taskID}, nil
}

// cloneWith returns a copy of payload with extra keys set.
func cloneWith(payload map[string]any, extra map[string]any) map[string]any {
	out := make(map[string]any, len(payload)+len(extra))
	for k, v := range payload {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}
