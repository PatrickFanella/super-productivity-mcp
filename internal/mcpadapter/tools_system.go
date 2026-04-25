package mcpadapter

import "context"

func (s *Server) registerSystemTools() {
	s.tools["show_notification"] = func(ctx context.Context, args map[string]any) (map[string]any, error) {
		return s.svc.ShowNotification(ctx, args)
	}
	s.tools["bridge_health"] = func(ctx context.Context, _ map[string]any) (map[string]any, error) {
		h, err := s.svc.Health(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{"ok": h.OK, "message": h.Message}, nil
	}
	s.tools["bridge_capabilities"] = func(ctx context.Context, _ map[string]any) (map[string]any, error) {
		cap, err := s.svc.Capabilities(ctx)
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"supportedActions": cap.SupportedActions,
			"pluginVersion":    cap.PluginVersion,
			"spVersion":        cap.SPVersion,
		}, nil
	}
}
