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

func TestNewRequestEnvelopeUsesIPCContract(t *testing.T) {
	sentAt := time.Date(2026, 5, 19, 10, 30, 0, 0, time.FixedZone("offset", 2*60*60))
	req := domain.Request{Action: "task.create", Payload: map[string]any{"title": "hello"}}

	env := newRequestEnvelope("req_contract", req, sentAt)

	if env.ProtocolVersion != domain.ProtocolVersion {
		t.Fatalf("protocol version = %q", env.ProtocolVersion)
	}
	if env.ID != "req_contract" || env.Type != envelopeTypeRequest || env.Action != "task.create" {
		t.Fatalf("unexpected envelope identity: %#v", env)
	}
	if env.SentAt != "2026-05-19T08:30:00Z" {
		t.Fatalf("sentAt = %q", env.SentAt)
	}
	if env.Payload["title"] != "hello" {
		t.Fatalf("payload = %#v", env.Payload)
	}
	if env.Meta["client"] != requestMetaClient {
		t.Fatalf("meta = %#v", env.Meta)
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
					Type:            envelopeTypeResponse,
					Status:          responseStatusOK,
					Result:          map[string]any{"hello": "world"},
				}
				_ = (FS{}).WriteJSONAtomic(filepath.Join(cfg.OutboxDir, id+".json"), resp)
			case modeError:
				resp := Envelope{
					ProtocolVersion: domain.ProtocolVersion,
					ID:              id,
					Type:            envelopeTypeResponse,
					Status:          responseStatusError,
					Error:           &domain.TypedError{Code: "TASK_NOT_FOUND", Message: "missing", Retryable: false},
				}
				_ = (FS{}).WriteJSONAtomic(filepath.Join(cfg.OutboxDir, id+".json"), resp)
			case modeDeadletter:
				bad := Envelope{ProtocolVersion: domain.ProtocolVersion, ID: id, Type: envelopeTypeRequest}
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
	assertEventKinds(t, cfg, eventRequestSent, eventResponseOK)
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
	assertEventKinds(t, cfg, eventRequestSent, eventResponseError)
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
	if te.Code != errorCodeDeadletter {
		t.Fatalf("got code %q", te.Code)
	}
}

func assertEventKinds(t *testing.T, cfg config.Config, expected ...string) {
	t.Helper()
	entries, err := os.ReadDir(cfg.EventsDir)
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	kinds := map[string]bool{}
	for _, entry := range entries {
		var event map[string]any
		if err := (FS{}).ReadJSON(filepath.Join(cfg.EventsDir, entry.Name()), &event); err != nil {
			t.Fatalf("read event %s: %v", entry.Name(), err)
		}
		if kind, _ := event["kind"].(string); kind != "" {
			kinds[kind] = true
		}
	}
	for _, kind := range expected {
		if !kinds[kind] {
			t.Fatalf("missing event kind %q in %#v", kind, kinds)
		}
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
	if te.Code != errorCodePluginStalled {
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
	if te.Code != errorCodeTimeout {
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
	if te.Code != errorCodeCanceled {
		t.Fatalf("got code %q", te.Code)
	}
}
