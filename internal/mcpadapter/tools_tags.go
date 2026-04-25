package mcpadapter

import "context"

func (s *Server) registerTagTools() {
	s.tools["get_tags"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ListTags(ctx, args)
	}
	s.tools["create_tag"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.CreateTag(ctx, args)
	}
	s.tools["update_tag"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.UpdateTag(ctx, args)
	}
}
