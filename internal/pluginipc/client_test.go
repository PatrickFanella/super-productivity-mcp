package pluginipc

import (
	"context"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

func TestClientTimeoutWhenNoResponse(t *testing.T) {
	tmp := t.TempDir()
	cfg := config.Config{
		InboxDir:  Join(tmp, "inbox"),
		ProcDir:   Join(tmp, "processing"),
		OutboxDir: Join(tmp, "outbox"),
		EventsDir: Join(tmp, "events"),
		DeadDir:   Join(tmp, "deadletter"),
		Timeout:   250 * time.Millisecond,
	}
	client, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	_, err = client.Call(context.Background(), domain.Request{Action: "task.list", Payload: map[string]any{}})
	if err == nil {
		t.Fatalf("expected timeout error")
	}
}
