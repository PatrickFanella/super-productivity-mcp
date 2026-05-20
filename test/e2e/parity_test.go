package e2e

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/pluginipc"
)

func TestBridgeRoundTripWithFixtureResponse(t *testing.T) {
	tmp := t.TempDir()
	cfg := config.Config{
		InboxDir:  filepath.Join(tmp, "inbox"),
		ProcDir:   filepath.Join(tmp, "processing"),
		OutboxDir: filepath.Join(tmp, "outbox"),
		EventsDir: filepath.Join(tmp, "events"),
		DeadDir:   filepath.Join(tmp, "deadletter"),
		Timeout:   2 * time.Second,
	}
	client, err := pluginipc.NewClient(cfg)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	go func() {
		for i := 0; i < 20; i++ {
			entries, _ := os.ReadDir(cfg.InboxDir)
			var name string
			for _, e := range entries {
				n := e.Name()
				if filepath.Ext(n) == ".json" && !strings.Contains(n, ".tmp.") {
					name = n
					break
				}
			}
			if name != "" {
				id := name[:len(name)-len(filepath.Ext(name))]
				resp := pluginipc.Envelope{
					ProtocolVersion: domain.ProtocolVersion,
					ID:              id,
					Type:            "response",
					Status:          "ok",
					Result:          map[string]any{"ok": true},
				}
				_ = os.Rename(filepath.Join(cfg.InboxDir, name), filepath.Join(cfg.ProcDir, name))
				_ = pluginipc.FS{}.WriteJSONAtomic(filepath.Join(cfg.OutboxDir, id+".json"), resp)
				_ = os.Remove(filepath.Join(cfg.ProcDir, name))
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	}()

	out, err := client.Call(context.Background(), domain.Request{Action: "bridge.health", Payload: map[string]any{}})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	if ok, _ := out.Result["ok"].(bool); !ok {
		t.Fatalf("expected ok=true, got %#v", out.Result)
	}
}

func TestBridgeRoundTripWithRealJSBridge(t *testing.T) {
	tmp := t.TempDir()
	cfg := config.Config{
		InboxDir:     filepath.Join(tmp, "inbox"),
		ProcDir:      filepath.Join(tmp, "processing"),
		OutboxDir:    filepath.Join(tmp, "outbox"),
		EventsDir:    filepath.Join(tmp, "events"),
		DeadDir:      filepath.Join(tmp, "deadletter"),
		Timeout:      3 * time.Second,
		PollInterval: 20 * time.Millisecond,
	}
	client, err := pluginipc.NewClient(cfg)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	readyPath := filepath.Join(tmp, "ready")
	cmd := exec.Command("node", "test/e2e/js_bridge_fixture.js")
	cmd.Dir = filepath.Join("..", "..")
	cmd.Env = append(os.Environ(),
		"SP_MCP_DATA_DIR="+tmp,
		"SP_MCP_POLL_INTERVAL_MS=20",
		"SP_MCP_FIXTURE_READY="+readyPath,
	)
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatalf("start js bridge: %v\n%s", err, output.String())
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	waitForFile(t, readyPath)

	resp, err := client.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{"includeDone": false}})
	if err != nil {
		t.Fatalf("call: %v", err)
	}
	tasks, ok := resp.Result["tasks"].([]any)
	if !ok || len(tasks) != 1 {
		t.Fatalf("expected one task, got %#v", resp.Result)
	}
	task := tasks[0].(map[string]any)
	if task["id"] != "fixture-task" {
		t.Fatalf("unexpected task %#v", task)
	}
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", path)
}
