package bridge

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
)

// probeTimeout bounds each adapter probe in get_status and
// bridge_capabilities, so a stalled plugin cannot stall either answer.
var probeTimeout = 3 * time.Second

// adapterState is what a probe found. It never carries task data.
type adapterState struct {
	Configured bool
	Ready      bool
	Error      *domain.TypedError
	Result     map[string]any // the plugin's own status or capabilities
}

func (s adapterState) view() map[string]any {
	out := map[string]any{"configured": s.Configured, "ready": s.Ready}
	if s.Error != nil {
		out["error"] = map[string]any{"code": s.Error.Code, "message": s.Error.Message}
	}
	return out
}

func asTyped(err error) *domain.TypedError {
	var te domain.TypedError
	if errors.As(err, &te) {
		return &te
	}
	return &domain.TypedError{Code: "BRIDGE_ERROR", Message: err.Error()}
}

func (r *Router) probePlugin(ctx context.Context, action string) adapterState {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	plugin, err := r.pluginBridge()
	if err != nil {
		return adapterState{Configured: true, Error: asTyped(err)}
	}
	resp, err := plugin.Call(ctx, domain.Request{Action: action, Payload: map[string]any{}})
	if err != nil {
		return adapterState{Configured: true, Error: asTyped(err)}
	}
	ready := true
	if v, ok := resp.Result["isReady"].(bool); ok {
		ready = v
	}
	return adapterState{Configured: true, Ready: ready, Result: resp.Result}
}

func (r *Router) probeREST(ctx context.Context) adapterState {
	if r.restErr != nil {
		return adapterState{Configured: true, Error: asTyped(r.restErr)}
	}
	if r.rest == nil {
		return adapterState{}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	// /status needs the token, so a wrong token shows up here; its task
	// data is discarded.
	if _, err := r.rest.Do(ctx, localrest.Request{Method: http.MethodGet, Path: "/status"}); err != nil {
		return adapterState{Configured: true, Error: asTyped(err)}
	}
	return adapterState{Configured: true, Ready: true}
}

// probeBoth runs the plugin and REST probes at the same time.
func (r *Router) probeBoth(ctx context.Context, pluginAction string) (plugin, rest adapterState) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); plugin = r.probePlugin(ctx, pluginAction) }()
	go func() { defer wg.Done(); rest = r.probeREST(ctx) }()
	wg.Wait()
	return plugin, rest
}

// status answers get_status: each adapter's readiness, and isReady only when
// every configured adapter answered. It returns no task data.
func (r *Router) status(ctx context.Context) map[string]any {
	plugin, rest := r.probeBoth(ctx, "bridge.status")
	out := map[string]any{
		"plugin":    plugin.view(),
		"localRest": rest.view(),
	}
	if plugin.Result != nil {
		for _, k := range []string{"pluginVersion", "protocolVersion"} {
			if v, ok := plugin.Result[k]; ok {
				out[k] = v
			}
		}
	}
	switch {
	case plugin.Ready && (rest.Ready || !rest.Configured):
		out["readiness"] = "ready"
	case plugin.Ready || rest.Ready:
		out["readiness"] = "partial"
	default:
		out["readiness"] = "unavailable"
	}
	out["isReady"] = out["readiness"] == "ready"
	return out
}

// operationLimits are short notes on what an operation cannot do.
var operationLimits = map[string][]string{
	"task.create":           {"repeat needs Local REST: the task is created first, then the recurrence attached; a failed attach is reported as recurrenceError next to taskId."},
	"task.update":           {"Deadline fields need Local REST and send the whole update there; a deadline today can move dueDay to today and clear dueWithTime and the reminder."},
	"focus.state":           {"Read-only: Local REST offers no focus timer controls."},
	"counter.setDay":        {"Needs Local REST; stopwatch values are milliseconds."},
	"task.archive":          {"Only top-level tasks; subtasks go with their parent.", "Without Local REST it only marks the task done, and only with allowDoneFallback:true."},
	"task.restore":          {"Needs Local REST; there is no plugin fallback."},
	"task.setRecurrence":    {"Local REST writes only quickSetting, startDate, repeatCycle, repeatEvery, weekdays, isPaused and skipOverdue; other fields fail with UNSUPPORTED_FIELD."},
	"task.updateRecurrence": {"Local REST writes only quickSetting, startDate, repeatCycle, repeatEvery, weekdays, isPaused and skipOverdue; isAskToUpdateAllTaskInstances needs the legacy plugin route."},
	"task.deleteRecurrence": {"The config's tasks are kept; they stop repeating."},
	"task.start":            {"With Local REST, taking tracking over from another device needs takeover:true."},
	"task.current":          {"Needs Local REST: the plugin API cannot read the tracked task."},
	"task.addTime":          {"Leaf tasks only, at most 24 h per day; without date the app's logical day is used."},
	"task.setTimeForDay":    {"Leaf tasks only, at most 24 h; without date the app's logical day is used."},
}

// routeOf reports where Call would send action, from configuration alone.
func (r *Router) routeOf(action string) (adapter string, reason string) {
	rt, mapped := restRoutes[action]
	if mapped && !(r.legacyRecurrence && legacyRecurrenceActions[action]) {
		if r.restErr != nil {
			return "", "Local REST settings are unusable"
		}
		if r.rest != nil {
			return "localRest", ""
		}
		if rt.needsREST {
			return "", "needs Local REST"
		}
	}
	return "plugin", ""
}

// capabilities answers bridge_capabilities: supportedActions stays the
// registered catalog surface; operations says, per action, which adapter it
// uses and whether that adapter answered.
func (r *Router) capabilities(ctx context.Context) map[string]any {
	plugin, rest := r.probeBoth(ctx, "bridge.capabilities")
	cat, _ := catalog.Load()
	actions := []string{}
	if cat != nil {
		for _, t := range cat.Tools {
			actions = append(actions, t.Action)
		}
	}
	sort.Strings(actions)
	supported := make([]any, len(actions))
	for i, a := range actions {
		supported[i] = a
	}
	ready := map[string]bool{"plugin": plugin.Ready, "localRest": rest.Ready}
	operations := map[string]any{}
	for _, action := range actions {
		adapter, reason := r.routeOf(action)
		op := map[string]any{"available": adapter != "" && ready[adapter]}
		if adapter != "" {
			op["adapter"] = adapter
			if !ready[adapter] {
				op["reason"] = adapter + " did not answer"
			}
		} else {
			op["adapter"] = nil
			op["reason"] = reason
		}
		if limits, ok := operationLimits[action]; ok {
			l := make([]any, len(limits))
			for i, s := range limits {
				l[i] = s
			}
			op["limitations"] = l
		}
		operations[action] = op
	}
	out := map[string]any{
		"supportedActions": supported,
		"protocolVersion":  domain.ProtocolVersion,
		"adapters":         map[string]any{"plugin": plugin.view(), "localRest": rest.view()},
		"operations":       operations,
	}
	if v, ok := plugin.Result["pluginVersion"]; ok {
		out["pluginVersion"] = v
	}
	return out
}
