package mcpadapter

import "context"

func (s *Server) registerTaskTools() {
	s.tools["create_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.CreateTask(ctx, args)
	}
	s.tools["get_tasks"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ListTasks(ctx, args)
	}
	s.tools["get_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.GetTask(ctx, args)
	}
	s.tools["update_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.UpdateTask(ctx, args)
	}
	s.tools["complete_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.CompleteTask(ctx, args)
	}
	s.tools["uncomplete_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.UncompleteTask(ctx, args)
	}
	s.tools["archive_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ArchiveTask(ctx, args)
	}
	s.tools["add_time_to_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.AddTime(ctx, args)
	}
	s.tools["reorder_task"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ReorderTask(ctx, args)
	}
}
