package service

import "context"

func (s *Services) ShowNotification(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "notification.show", in)
}
