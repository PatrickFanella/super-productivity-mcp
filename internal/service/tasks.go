package service

import "context"

func (s *Services) CreateTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.create", in)
}

func (s *Services) ListTasks(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.list", in)
}

func (s *Services) GetTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.get", in)
}

func (s *Services) UpdateTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.update", in)
}

func (s *Services) CompleteTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.complete", in)
}

func (s *Services) UncompleteTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.uncomplete", in)
}

func (s *Services) ArchiveTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.archive", in)
}

func (s *Services) AddTime(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.addTime", in)
}

func (s *Services) ReorderTask(ctx context.Context, in map[string]any) (map[string]any, error) {
	return s.call(ctx, "task.reorder", in)
}
