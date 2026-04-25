package service

import "context"

func (s *Services) ListTags(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "tag.list", in)
}

func (s *Services) CreateTag(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "tag.create", in)
}

func (s *Services) UpdateTag(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "tag.update", in)
}
