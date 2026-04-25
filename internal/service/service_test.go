package service

import (
	"context"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type stubBridge struct {
	lastAction string
}

func (s *stubBridge) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	s.lastAction = req.Action
	return domain.Response{Result: map[string]any{"ok": true}}, nil
}

func (s *stubBridge) Health(_ context.Context) (domain.HealthStatus, error) {
	return domain.HealthStatus{OK: true, Message: "ok"}, nil
}

func (s *stubBridge) Capabilities(_ context.Context) (domain.Capabilities, error) {
	return domain.Capabilities{SupportedActions: []string{"task.list"}}, nil
}

func TestListTasksCallsCanonicalAction(t *testing.T) {
	b := &stubBridge{}
	svc := New(b)
	if _, err := svc.ListTasks(context.Background(), map[string]any{"includeDone": true}); err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if b.lastAction != "task.list" {
		t.Fatalf("got action %q", b.lastAction)
	}
}
