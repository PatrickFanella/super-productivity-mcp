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

// restRoutes are the actions that use Local REST when it is configured.
var restRoutes = map[string]restRoute{
	"task.archive": archiveTask,
}

// Router implements domain.Bridge over Local REST and plugin IPC.
type Router struct {
	rest    *localrest.Client
	restErr error // set when REST was configured but is unusable

	newPlugin func() (domain.Bridge, error)
	mu        sync.Mutex
	plugin    domain.Bridge
}

var _ domain.Bridge = (*Router)(nil)

// New builds the router from configuration. It never fails: an unusable
// Local REST setting is reported by RESTError and by every REST-mapped call,
// and plugin IPC is set up on first use.
func New(cfg config.Config) *Router {
	r := &Router{newPlugin: func() (domain.Bridge, error) { return pluginipc.NewClient(cfg) }}
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
	if route, ok := restRoutes[req.Action]; ok {
		if r.restErr != nil {
			return domain.Response{}, r.restErr
		}
		if r.rest != nil {
			result, err := route(ctx, r.rest, req.Payload)
			if err != nil {
				return domain.Response{}, err
			}
			return domain.Response{Result: result}, nil
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
	data, err := rest.Do(ctx, localrest.Request{
		Method:   "POST",
		Path:     localrest.SegmentPath("tasks", taskID, "archive"),
		Mutation: true,
	})
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
