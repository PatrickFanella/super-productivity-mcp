package pluginipc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// pickReady returns the first inbox entry that is a finished envelope (a
// `.json` file that is not the in-flight `.json.tmp.<ns>` from atomic rename).
func pickReady(entries []os.DirEntry) string {
	for _, e := range entries {
		n := e.Name()
		if strings.HasSuffix(n, ".json") && !strings.Contains(n, ".tmp.") {
			return n
		}
	}
	return ""
}

func newTestConfig(t *testing.T, timeout time.Duration) config.Config {
	t.Helper()
	tmp := t.TempDir()
	return config.Config{
		InboxDir:     filepath.Join(tmp, "inbox"),
		ProcDir:      filepath.Join(tmp, "processing"),
		OutboxDir:    filepath.Join(tmp, "outbox"),
		EventsDir:    filepath.Join(tmp, "events"),
		DeadDir:      filepath.Join(tmp, "deadletter"),
		Timeout:      timeout,
		PollInterval: 20 * time.Millisecond,
	}
}

// fakePlugin tails the inbox in a goroutine and produces a response, deadletter,
// or simulates a stall depending on mode.
type fakePluginMode int

const (
	modeOK fakePluginMode = iota
	modeError
	modeDeadletter
	modeStall
)

func runFakePlugin(t *testing.T, cfg config.Config, mode fakePluginMode) {
	t.Helper()
	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			entries, _ := os.ReadDir(cfg.InboxDir)
			name := pickReady(entries)
			if name == "" {
				time.Sleep(10 * time.Millisecond)
				continue
			}
			id := name[:len(name)-len(filepath.Ext(name))]
			src := filepath.Join(cfg.InboxDir, name)

			if mode == modeStall {
				return // never consume the inbox file
			}

			// Move to processing to simulate a real consumer.
			_ = os.Rename(src, filepath.Join(cfg.ProcDir, name))

			switch mode {
			case modeOK:
				resp := Envelope{
					ProtocolVersion: domain.ProtocolVersion,
					ID:              id,
					Type:            "response",
					Status:          "ok",
					Result:          map[string]any{"hello": "world"},
				}
				_ = (FS{}).WriteJSONAtomic(filepath.Join(cfg.OutboxDir, id+".json"), resp)
			case modeError:
				resp := Envelope{
					ProtocolVersion: domain.ProtocolVersion,
					ID:              id,
					Type:            "response",
					Status:          "error",
					Error:           &domain.TypedError{Code: "TASK_NOT_FOUND", Message: "missing", Retryable: false},
				}
				_ = (FS{}).WriteJSONAtomic(filepath.Join(cfg.OutboxDir, id+".json"), resp)
			case modeDeadletter:
				bad := Envelope{ProtocolVersion: domain.ProtocolVersion, ID: id, Type: "request"}
				_ = (FS{}).WriteJSONAtomic(filepath.Join(cfg.DeadDir, id+".json"), bad)
			}
			_ = os.Remove(filepath.Join(cfg.ProcDir, name))
			return
		}
	}()
}

func TestClientOK(t *testing.T) {
	cfg := newTestConfig(t, 1*time.Second)
	c, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	runFakePlugin(t, cfg, modeOK)
	resp, err := c.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{}})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if resp.Result["hello"] != "world" {
		t.Fatalf("unexpected result: %#v", resp.Result)
	}
}

func TestClientErrorEnvelope(t *testing.T) {
	cfg := newTestConfig(t, 1*time.Second)
	c, _ := NewClient(cfg)
	runFakePlugin(t, cfg, modeError)
	_, err := c.Call(context.Background(), domain.Request{Action: "task.get", Payload: map[string]any{"taskId": "x"}})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "TASK_NOT_FOUND" {
		t.Fatalf("got code %q", te.Code)
	}
}

func TestClientDeadletter(t *testing.T) {
	cfg := newTestConfig(t, 1*time.Second)
	c, _ := NewClient(cfg)
	runFakePlugin(t, cfg, modeDeadletter)
	_, err := c.Call(context.Background(), domain.Request{Action: "broken", Payload: map[string]any{}})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "DEADLETTER" {
		t.Fatalf("got code %q", te.Code)
	}
}

func TestClientPluginStalled(t *testing.T) {
	cfg := newTestConfig(t, 200*time.Millisecond)
	c, _ := NewClient(cfg)
	runFakePlugin(t, cfg, modeStall)
	_, err := c.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{}})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "PLUGIN_STALLED" {
		t.Fatalf("got code %q", te.Code)
	}
}

func TestClientTimeoutWhenNoResponse(t *testing.T) {
	// Plugin consumes inbox but never replies → TIMEOUT (not STALLED).
	cfg := newTestConfig(t, 200*time.Millisecond)
	c, _ := NewClient(cfg)
	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			entries, _ := os.ReadDir(cfg.InboxDir)
			name := pickReady(entries)
			if name == "" {
				time.Sleep(10 * time.Millisecond)
				continue
			}
			_ = os.Rename(filepath.Join(cfg.InboxDir, name),
				filepath.Join(cfg.ProcDir, name))
			return
		}
	}()
	_, err := c.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{}})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "TIMEOUT" {
		t.Fatalf("got code %q", te.Code)
	}
}

func TestClientCanceled(t *testing.T) {
	cfg := newTestConfig(t, 5*time.Second)
	c, _ := NewClient(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	_, err := c.Call(ctx, domain.Request{Action: "task.list", Payload: map[string]any{}})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "CANCELED" {
		t.Fatalf("got code %q", te.Code)
	}
}
