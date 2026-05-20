package quickadd

import (
	"context"
	"errors"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type fakeBridge struct {
	reqs []domain.Request
	err  error
}

func (f *fakeBridge) Call(_ context.Context, req domain.Request) (domain.Response, error) {
	f.reqs = append(f.reqs, req)
	return domain.Response{}, f.err
}

func TestBridgeTaskCreatorUsesTaskCreateContract(t *testing.T) {
	bridge := &fakeBridge{}
	creator := BridgeTaskCreator{Bridge: bridge}

	if err := creator.CreateTask(context.Background(), "Write docs @today"); err != nil {
		t.Fatalf("CreateTask returned error: %v", err)
	}
	if len(bridge.reqs) != 1 {
		t.Fatalf("expected one bridge request, got %d", len(bridge.reqs))
	}
	req := bridge.reqs[0]
	if req.Action != TaskCreateAction {
		t.Fatalf("expected action %q, got %q", TaskCreateAction, req.Action)
	}
	if req.Payload[TaskTitleField] != "Write docs @today" {
		t.Fatalf("unexpected payload: %+v", req.Payload)
	}
}

func TestBridgeTaskCreatorRequiresBridge(t *testing.T) {
	err := BridgeTaskCreator{}.CreateTask(context.Background(), "Missing bridge")

	if err == nil || err.Error() != "bridge is required" {
		t.Fatalf("expected missing bridge error, got %v", err)
	}
}

func TestBridgeTaskCreatorReturnsBridgeError(t *testing.T) {
	want := errors.New("bridge down")
	err := BridgeTaskCreator{Bridge: &fakeBridge{err: want}}.CreateTask(context.Background(), "Broken")

	if !errors.Is(err, want) {
		t.Fatalf("expected bridge error, got %v", err)
	}
}
