package bridge

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/localrest"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

func fixtureBody(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "test", "fixtures", "upstream", "v20", "rest-envelopes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Responses map[string]struct {
			Body json.RawMessage `json:"body"`
		} `json:"responses"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return string(file.Responses[name].Body)
}

// methodServer answers every request with body and records request methods.
type methodServer struct {
	mu      sync.Mutex
	methods []string
}

func serveFocus(t *testing.T, body string) (*methodServer, *Router) {
	t.Helper()
	m := &methodServer{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		m.methods = append(m.methods, r.Method+" "+r.URL.Path)
		m.mu.Unlock()
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return m, NewWith(restClient(t, srv.URL), unavailablePlugin(t))
}

func TestFocusStateCoversModesAndTimerStates(t *testing.T) {
	cases := []struct {
		fixture, mode, state string
		overtime             bool
	}{
		{"focusNone", "Pomodoro", "inactive", false},
		{"focusRunning", "Pomodoro", "work-running", false},
		{"focusPausedOvertime", "Countdown", "work-paused", true},
		{"focusBreakDone", "Pomodoro", "break-done", false},
		{"focusSessionDone", "Flowtime", "session-done", false},
	}
	for _, c := range cases {
		m, r := serveFocus(t, fixtureBody(t, c.fixture))
		resp, err := call(r, "focus.state", map[string]any{})
		if err != nil {
			t.Fatalf("%s: %v", c.fixture, err)
		}
		if resp.Result["mode"] != c.mode || resp.Result["state"] != c.state {
			t.Errorf("%s: %#v", c.fixture, resp.Result)
		}
		if timer, ok := resp.Result["timer"].(map[string]any); ok && timer["isOvertime"] != c.overtime {
			t.Errorf("%s: overtime %v", c.fixture, timer["isOvertime"])
		}
		if strings.Join(m.methods, ",") != "GET /focus" {
			t.Errorf("%s: requests %v; focus must be read-only", c.fixture, m.methods)
		}
	}
}

func TestFocusStateLimitations(t *testing.T) {
	_, err := call(NewWith(nil, unavailablePlugin(t)), "focus.state", map[string]any{})
	if got := code(t, err); got != "UNSUPPORTED_ACTION" {
		t.Fatalf("no REST: %s", got)
	}
	_, r := serveFocus(t, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`)
	if _, err := call(r, "focus.state", map[string]any{}); err == nil {
		t.Fatalf("expected an error from an app without /focus")
	}
	srv := newRESTServer(t, 404, `{"ok":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}`)
	_, err = call(NewWith(restClient(t, srv.URL), unavailablePlugin(t)), "focus.state", map[string]any{})
	if got := code(t, err); got != localrest.CodeUnsupportedRoute {
		t.Fatalf("older app: %s", got)
	}
}

func TestFocusStateThroughMCP(t *testing.T) {
	_, r := serveFocus(t, fixtureBody(t, "focusRunning"))
	cat, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	line := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_focus_state","arguments":{}}}` + "\n"
	if reply := serveOne(t, mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"write"}}), line); !strings.Contains(reply, "NOT_PERMITTED") {
		t.Fatalf("write-only grant: %s", reply)
	}
	if reply := serveOne(t, mcpadapter.NewWithOptions(logger, r, cat, mcpadapter.Options{Scopes: []string{"read"}}), line); strings.Contains(reply, `"isError":true`) || !strings.Contains(reply, `work-running`) {
		t.Fatalf("read grant: %s", reply)
	}
}
