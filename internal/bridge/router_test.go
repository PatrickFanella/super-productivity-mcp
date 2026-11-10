package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

// fakePlugin records calls; it stands in for plugin IPC.
type fakePlugin struct {
	calls  []domain.Request
	result map[string]any
}

func (f *fakePlugin) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	f.calls = append(f.calls, req)
	return domain.Response{Result: f.result}, nil
}

// unavailablePlugin fails the test if plugin IPC is ever touched.
func unavailablePlugin(t *testing.T) func() (domain.Bridge, error) {
	return func() (domain.Bridge, error) {
		t.Helper()
		t.Errorf("plugin IPC was initialized for a REST-routed action")
		return nil, errors.New("plugin unavailable")
	}
}

type restServer struct {
	*httptest.Server
	requests atomic.Int32
}

func newRESTServer(t *testing.T, status int, body string) *restServer {
	t.Helper()
	s := &restServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.requests.Add(1)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(s.Close)
	return s
}

func restClient(t *testing.T, url string) *localrest.Client {
	t.Helper()
	c, err := localrest.New(localrest.Config{BaseURL: url, Token: "fixture-token", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func code(t *testing.T, err error) string {
	t.Helper()
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	return te.Code
}

func archive(id string) domain.Request {
	return domain.Request{Action: "task.archive", Payload: map[string]any{"taskId": id}}
}

func TestArchiveUsesRESTWithoutPluginIPC(t *testing.T) {
	srv := newRESTServer(t, 200, `{"ok":true,"data":{"id":"fx-day-overdue","archived":true}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	resp, err := r.Call(context.Background(), archive("fx-day-overdue"))
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if resp.Result["archived"] != true || resp.Result["via"] != "localRest" {
		t.Fatalf("result %#v", resp.Result)
	}
	if srv.requests.Load() != 1 {
		t.Fatalf("expected one REST request, got %d", srv.requests.Load())
	}
}

func TestArchiveAcceptsSnakeCaseTaskID(t *testing.T) {
	srv := newRESTServer(t, 200, `{"ok":true,"data":{"id":"x","archived":true}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	if _, err := r.Call(context.Background(), domain.Request{Action: "task.archive", Payload: map[string]any{"task_id": "x"}}); err != nil {
		t.Fatalf("Call: %v", err)
	}
}

func TestRESTFailuresNeverFallBackToPlugin(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"invalid envelope", 200, `<html>`, localrest.CodeOutcomeUnknown},
		{"unconfirmed archive", 200, `{"ok":true,"data":{"id":"x"}}`, localrest.CodeOutcomeUnknown},
		{"renderer timeout", 504, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"Renderer request timed out"}}`, localrest.CodeOutcomeUnknown},
		{"unauthorized", 401, `{"ok":false,"error":{"code":"UNAUTHORIZED","message":"no"}}`, localrest.CodeUnauthorized},
		{"unknown task", 404, `{"ok":false,"error":{"code":"TASK_NOT_FOUND","message":"Task not found"}}`, "TASK_NOT_FOUND"},
		{"unsupported route", 404, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`, localrest.CodeUnsupportedRoute},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := newRESTServer(t, c.status, c.body)
			r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
			req := archive("x")
			req.Payload["allowDoneFallback"] = true
			_, err := r.Call(context.Background(), req)
			if got := code(t, err); got != c.want {
				t.Fatalf("code = %s, want %s", got, c.want)
			}
		})
	}
}

func TestRefusedConnectionDoesNotFallBack(t *testing.T) {
	srv := newRESTServer(t, 200, `{}`)
	url := srv.URL
	srv.Close()
	r := NewWith(restClient(t, url), unavailablePlugin(t))
	if got := code(t, mustErr(r.Call(context.Background(), archive("x")))); got != localrest.CodeUnavailable {
		t.Fatalf("code = %s", got)
	}
}

func mustErr(_ domain.Response, err error) error { return err }

func TestArchiveRequiresTaskIDBeforeSending(t *testing.T) {
	srv := newRESTServer(t, 200, `{"ok":true,"data":{"archived":true}}`)
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	for _, payload := range []map[string]any{{}, {"taskId": ".."}, {"taskId": "."}} {
		if got := code(t, mustErr(r.Call(context.Background(), domain.Request{Action: "task.archive", Payload: payload}))); got != "INVALID_REQUEST" {
			t.Fatalf("payload %v: code = %s", payload, got)
		}
	}
	if srv.requests.Load() != 0 {
		t.Fatalf("request sent without a task id")
	}
}

func TestArchiveUsesPluginWhenRESTIsNotConfigured(t *testing.T) {
	plugin := &fakePlugin{result: map[string]any{"archived": false}}
	r := NewWith(nil, func() (domain.Bridge, error) { return plugin, nil })
	req := archive("x")
	req.Payload["allowDoneFallback"] = true
	if _, err := r.Call(context.Background(), req); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if len(plugin.calls) != 1 || plugin.calls[0].Payload["allowDoneFallback"] != true {
		t.Fatalf("plugin calls %#v", plugin.calls)
	}
}

func TestUnmappedActionsUsePluginWhenRESTIsConfigured(t *testing.T) {
	srv := newRESTServer(t, 200, `{"ok":true,"data":null}`)
	plugin := &fakePlugin{result: map[string]any{"tasks": []any{}}}
	r := NewWith(restClient(t, srv.URL), func() (domain.Bridge, error) { return plugin, nil })
	if _, err := r.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{}}); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if len(plugin.calls) != 1 || srv.requests.Load() != 0 {
		t.Fatalf("plugin=%d rest=%d", len(plugin.calls), srv.requests.Load())
	}
}

func TestMisconfiguredRESTFailsMappedActionsOnly(t *testing.T) {
	plugin := &fakePlugin{result: map[string]any{}}
	r := New(config.Config{LocalRESTURL: "http://sp.example.com:3876"})
	r.newPlugin = func() (domain.Bridge, error) { return plugin, nil }
	if r.RESTError() == nil {
		t.Fatalf("expected a REST configuration error")
	}
	if got := code(t, mustErr(r.Call(context.Background(), archive("x")))); got != localrest.CodeMisconfigured {
		t.Fatalf("code = %s", got)
	}
	if _, err := r.Call(context.Background(), domain.Request{Action: "task.list"}); err != nil {
		t.Fatalf("unmapped action: %v", err)
	}
	if len(plugin.calls) != 1 {
		t.Fatalf("archive reached the plugin: %#v", plugin.calls)
	}
}

func TestNewReadsRESTSettings(t *testing.T) {
	if r := New(config.Config{}); r.rest != nil || r.restErr != nil {
		t.Fatalf("REST configured from empty settings")
	}
	if r := New(config.Config{LocalRESTURL: "http://127.0.0.1:3876", LocalRESTToken: "t"}); r.rest == nil || r.restErr != nil {
		t.Fatalf("REST not configured: %v", r.restErr)
	}
}

func TestPluginIsInitializedLazilyAndRetried(t *testing.T) {
	attempts := 0
	plugin := &fakePlugin{result: map[string]any{}}
	r := NewWith(nil, func() (domain.Bridge, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("disk full")
		}
		return plugin, nil
	})
	if attempts != 0 {
		t.Fatalf("plugin initialized at construction")
	}
	if got := code(t, mustErr(r.Call(context.Background(), domain.Request{Action: "task.list"}))); got != "BRIDGE_INIT_FAILED" {
		t.Fatalf("code = %s", got)
	}
	for i := 0; i < 2; i++ {
		if _, err := r.Call(context.Background(), domain.Request{Action: "task.list"}); err != nil {
			t.Fatalf("Call: %v", err)
		}
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d", attempts)
	}
}

// TestMCPScopesApplyBeforeREST drives archive_task through the MCP server:
// a grant without write must be refused before any REST request is sent.
func TestMCPScopesApplyBeforeREST(t *testing.T) {
	srv := newRESTServer(t, 200, `{"ok":true,"data":{"id":"x","archived":true}}`)
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	call := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"archive_task","arguments":{"taskId":"x"}}}` + "\n"

	readOnly := mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"read"}})
	if reply := serveOne(t, readOnly, call); !strings.Contains(reply, "NOT_PERMITTED") {
		t.Fatalf("read-only grant reply: %s", reply)
	}
	if srv.requests.Load() != 0 {
		t.Fatalf("REST request sent despite missing scope")
	}

	full := mcpadapter.New(logger, r, cat)
	if reply := serveOne(t, full, call); !strings.Contains(reply, `\"via\":\"localRest\"`) {
		t.Fatalf("full grant reply: %s", reply)
	}
	if srv.requests.Load() != 1 {
		t.Fatalf("expected one REST request, got %d", srv.requests.Load())
	}
}

func serveOne(t *testing.T, s *mcpadapter.Server, line string) string {
	t.Helper()
	var out bytes.Buffer
	if err := s.Serve(context.Background(), strings.NewReader(line), &out); err != nil {
		t.Fatal(err)
	}
	var reply map[string]any
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatalf("reply %q: %v", out.String(), err)
	}
	return out.String()
}

// archiveStore is a stateful fake of the app's archive and restore routes.
type archiveStore struct {
	mu       sync.Mutex
	active   map[string]bool
	archived map[string]bool
}

func (s *archiveStore) handler(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 3 || parts[0] != "tasks" || r.Method != http.MethodPost {
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`)
		return
	}
	id := parts[1]
	switch {
	case parts[2] == "archive" && s.active[id]:
		delete(s.active, id)
		s.archived[id] = true
		_, _ = io.WriteString(w, `{"ok":true,"data":{"id":"`+id+`","archived":true}}`)
	case parts[2] == "restore" && s.archived[id]:
		delete(s.archived, id)
		s.active[id] = true
		_, _ = io.WriteString(w, `{"ok":true,"data":{"id":"`+id+`","title":"Fixture task","isDone":true}}`)
	default:
		w.WriteHeader(404)
		_, _ = io.WriteString(w, `{"ok":false,"error":{"code":"TASK_NOT_FOUND","message":"Task not found"}}`)
	}
}

func TestArchiveThenRestoreMovesTheTaskBack(t *testing.T) {
	store := &archiveStore{active: map[string]bool{"fx-day-overdue": true}, archived: map[string]bool{}}
	srv := httptest.NewServer(http.HandlerFunc(store.handler))
	defer srv.Close()
	r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))

	if _, err := r.Call(context.Background(), archive("fx-day-overdue")); err != nil {
		t.Fatalf("archive: %v", err)
	}
	if !store.archived["fx-day-overdue"] || store.active["fx-day-overdue"] {
		t.Fatalf("after archive: %+v", store)
	}
	resp, err := r.Call(context.Background(), domain.Request{Action: "task.restore", Payload: map[string]any{"task_id": "fx-day-overdue"}})
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if resp.Result["restored"] != true || resp.Result["via"] != "localRest" || resp.Result["taskId"] != "fx-day-overdue" {
		t.Fatalf("restore result %#v", resp.Result)
	}
	if store.archived["fx-day-overdue"] || !store.active["fx-day-overdue"] {
		t.Fatalf("after restore: %+v", store)
	}
	// Restoring again finds nothing in the archive and changes nothing.
	_, err = r.Call(context.Background(), domain.Request{Action: "task.restore", Payload: map[string]any{"taskId": "fx-day-overdue"}})
	if got := code(t, err); got != "TASK_NOT_FOUND" {
		t.Fatalf("second restore code = %s", got)
	}
}

func TestRestoreFailuresStayExplicit(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"other task returned", 200, `{"ok":true,"data":{"id":"other"}}`, localrest.CodeOutcomeUnknown},
		{"null data", 200, `{"ok":true,"data":null}`, localrest.CodeOutcomeUnknown},
		{"renderer timeout", 504, `{"ok":false,"error":{"code":"RENDERER_TIMEOUT","message":"Renderer request timed out"}}`, localrest.CodeOutcomeUnknown},
		{"route missing", 404, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`, localrest.CodeUnsupportedRoute},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := newRESTServer(t, c.status, c.body)
			r := NewWith(restClient(t, srv.URL), unavailablePlugin(t))
			_, err := r.Call(context.Background(), domain.Request{Action: "task.restore", Payload: map[string]any{"taskId": "x"}})
			if got := code(t, err); got != c.want {
				t.Fatalf("code = %s, want %s", got, c.want)
			}
		})
	}
}

func TestRestoreAndCurrentWithoutRESTFailAtOnce(t *testing.T) {
	// The plugin has no restore or current-task read, so the router answers
	// UNSUPPORTED_ACTION itself instead of waiting on the plugin.
	r := NewWith(nil, unavailablePlugin(t))
	for _, action := range []string{"task.restore", "task.current"} {
		_, err := r.Call(context.Background(), domain.Request{Action: action, Payload: map[string]any{"taskId": "x"}})
		if got := code(t, err); got != "UNSUPPORTED_ACTION" {
			t.Fatalf("%s: code = %s", action, got)
		}
	}
}
