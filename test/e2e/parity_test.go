package e2e

import (
	"context"
	"os"
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
