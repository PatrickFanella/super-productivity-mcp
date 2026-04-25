package service

import "context"

func (s *Services) ListProjects(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "project.list", in)
}

func (s *Services) CreateProject(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "project.create", in)
}

func (s *Services) UpdateProject(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "project.update", in)
}
