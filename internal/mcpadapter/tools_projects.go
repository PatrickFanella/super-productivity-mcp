package mcpadapter

import "context"

func (s *Server) registerProjectTools() {
	s.tools["get_projects"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ListProjects(ctx, args)
	}
	s.tools["create_project"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.CreateProject(ctx, args)
	}
	s.tools["update_project"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.UpdateProject(ctx, args)
	}
}
