package quickadd

import (
	"context"
	"errors"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

const (
	TaskCreateAction = "task.create"
	TaskTitleField   = "title"
)

// BridgeTaskCreator is the quick-add Adapter from a validated title into the
// plugin bridge action contract. The quick-add workflow owns title collection
// and notifications; the Bridge owns only action delivery.
type BridgeTaskCreator struct {
	Bridge domain.Bridge
}

func (c BridgeTaskCreator) CreateTask(ctx context.Context, title string) error {
	if c.Bridge == nil {
		return errors.New("bridge is required")
	}
	_, err := c.Bridge.Call(ctx, domain.Request{
		Action:  TaskCreateAction,
		Payload: map[string]any{TaskTitleField: title},
	})
	return err
}
