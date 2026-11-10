package bridge

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

// stalledPlugin never answers until its context ends, like a plugin that
// stopped polling its inbox.
type stalledPlugin struct{}

func (stalledPlugin) Call(ctx context.Context, _ domain.Request) (domain.Response, error) {
	<-ctx.Done()
	return domain.Response{}, domain.TypedError{Code: "PLUGIN_STALLED", Message: "plugin did not consume request before timeout", Retryable: true}
}

// readyPlugin answers status and capabilities like the plugin bridge.
type readyPlugin struct{ calls []string }

func (p *readyPlugin) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	p.calls = append(p.calls, req.Action)
	switch req.Action {
	case "bridge.status":
		return domain.Response{Result: map[string]any{"isReady": true, "pluginVersion": "0.1.0", "protocolVersion": "2.0"}}, nil
	case "bridge.capabilities":
		return domain.Response{Result: map[string]any{"supportedActions": []any{"task.list"}, "pluginVersion": "0.1.0"}}, nil
	}
	return domain.Response{Result: map[string]any{"ok": true}}, nil
}

func fastProbes(t *testing.T) {
	t.Helper()
	old := probeTimeout
	probeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { probeTimeout = old })
}

func restOK(t *testing.T) *restServer {
	return newRESTServer(t, 200, `{"ok":true,"data":{"currentTask":{"id":"x","title":"Fixture secret title"},"trackingOnOtherDevice":null}}`)
}

func pluginFactory(p domain.Bridge) func() (domain.Bridge, error) {
	return func() (domain.Bridge, error) { return p, nil }
}

func TestStatusAcrossAdapterCombinations(t *testing.T) {
	fastProbes(t)
	down := func() (domain.Bridge, error) { return nil, errors.New("no data dir") }
	cases := []struct {
		name      string
		rest      bool
		plugin    func() (domain.Bridge, error)
		readiness string
	}{
		{"both", true, pluginFactory(&readyPlugin{}), "ready"},
		{"plugin only", false, pluginFactory(&readyPlugin{}), "ready"},
		{"REST only", true, down, "partial"},
		{"REST with stalled plugin", true, pluginFactory(stalledPlugin{}), "partial"},
		{"neither", false, down, "unavailable"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var r *Router
			if c.rest {
				r = NewWith(restClient(t, restOK(t).URL), c.plugin)
			} else {
				r = NewWith(nil, c.plugin)
			}
			start := time.Now()
			resp, err := call(r, "bridge.status", map[string]any{})
			if err != nil {
				t.Fatal(err)
			}
			if time.Since(start) > time.Second {
				t.Fatalf("status took %s", time.Since(start))
			}
			got := resp.Result
			if got["readiness"] != c.readiness || got["isReady"] != (c.readiness == "ready") {
				t.Fatalf("result %#v", got)
			}
			if rest := got["localRest"].(map[string]any); rest["configured"] != c.rest {
				t.Fatalf("localRest %#v", rest)
			}
			if strings.Contains(stringify(got), "Fixture secret title") {
				t.Fatalf("status leaked task data: %#v", got)
			}
		})
	}
}

func TestStatusReportsBadTokenSeparately(t *testing.T) {
	fastProbes(t)
	srv := newRESTServer(t, 401, `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"no"}}`)
	r := NewWith(restClient(t, srv.URL), pluginFactory(&readyPlugin{}))
	resp, _ := call(r, "bridge.status", map[string]any{})
	rest := resp.Result["localRest"].(map[string]any)
	if resp.Result["readiness"] != "partial" || rest["ready"] != false || rest["error"].(map[string]any)["code"] != "LOCAL_REST_UNAUTHORIZED" {
		t.Fatalf("result %#v", resp.Result)
	}
}

func TestCapabilitiesReportPerOperationAvailability(t *testing.T) {
	fastProbes(t)
	r := NewWith(restClient(t, restOK(t).URL), pluginFactory(stalledPlugin{}))
	resp, err := call(r, "bridge.capabilities", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	ops := resp.Result["operations"].(map[string]any)
	archive := ops["task.archive"].(map[string]any)
	list := ops["task.list"].(map[string]any)
	if archive["adapter"] != "localRest" || archive["available"] != true || len(archive["limitations"].([]any)) == 0 {
		t.Fatalf("archive %#v", archive)
	}
	if list["adapter"] != "plugin" || list["available"] != false || list["reason"] != "plugin did not answer" {
		t.Fatalf("list %#v", list)
	}
	supported := resp.Result["supportedActions"].([]any)
	if len(supported) < 50 {
		t.Fatalf("supportedActions should stay the registered catalog surface, got %d", len(supported))
	}

	noREST := NewWith(nil, pluginFactory(&readyPlugin{}))
	resp, _ = call(noREST, "bridge.capabilities", map[string]any{})
	restore := resp.Result["operations"].(map[string]any)["task.restore"].(map[string]any)
	current := resp.Result["operations"].(map[string]any)["task.current"].(map[string]any)
	if restore["adapter"] != "plugin" || current["limitations"] == nil {
		t.Fatalf("restore %#v current %#v", restore, current)
	}
	addTime := resp.Result["operations"].(map[string]any)["task.addTime"].(map[string]any)
	if addTime["available"] != false || addTime["reason"] != "needs Local REST" {
		t.Fatalf("addTime %#v", addTime)
	}
}

func TestStalledPluginDoesNotStallRESTOperations(t *testing.T) {
	fastProbes(t)
	srv := newRESTServer(t, 200, `{"ok":true,"data":{"id":"x","archived":true}}`)
	r := NewWith(restClient(t, srv.URL), pluginFactory(stalledPlugin{}))
	done := make(chan error, 1)
	go func() {
		_, err := call(r, "task.archive", map[string]any{"taskId": "x"})
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatalf("REST archive waited on the plugin")
	}
}

func TestStatusThroughMCPKeepsGrantAndScopeChecks(t *testing.T) {
	fastProbes(t)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	r := NewWith(restClient(t, restOK(t).URL), func() (domain.Bridge, error) { return nil, errors.New("down") })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"create"}})
	reply := serveOne(t, s, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{}}}`+"\n")
	for _, want := range []string{`\"isReady\":false`, `\"readiness\":\"partial\"`, `\"grantedScopes\":[\"create\"]`} {
		if !strings.Contains(reply, want) {
			t.Fatalf("reply lacks %s: %s", want, reply)
		}
	}
	// Resources still need the read scope before any adapter is asked.
	reply = serveOne(t, s, `{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"sp://tasks/active"}}`+"\n")
	if !strings.Contains(reply, "NOT_PERMITTED") {
		t.Fatalf("resource read: %s", reply)
	}
}

func stringify(v any) string {
	var b strings.Builder
	var walk func(any)
	walk = func(x any) {
		switch t := x.(type) {
		case map[string]any:
			for k, v := range t {
				b.WriteString(k)
				walk(v)
			}
		case []any:
			for _, v := range t {
				walk(v)
			}
		case string:
			b.WriteString(t)
		}
	}
	walk(v)
	return b.String()
}
