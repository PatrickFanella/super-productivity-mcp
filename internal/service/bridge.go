package service

import (
	"context"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type Services struct {
	bridge domain.Bridge
}

func New(bridge domain.Bridge) *Services {
	return &Services{bridge: bridge}
}

func (s *Services) call(ctx context.Context, action string, payload map[string]any) (map[string]any, error) {
	resp, err := s.bridge.Call(ctx, domain.Request{Action: action, Payload: payload})
	if err != nil {
		return nil, err
	}
	return resp.Result, nil
}

func (s *Services) Health(ctx context.Context) (domain.HealthStatus, error) {
	return s.bridge.Health(ctx)
}

func (s *Services) Capabilities(ctx context.Context) (domain.Capabilities, error) {
	return s.bridge.Capabilities(ctx)
}
