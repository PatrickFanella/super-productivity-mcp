package mcpadapter

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/PatrickFanella/super-productivity-mcp/internal/service"
)

type Server struct {
	logger *slog.Logger
	svc    *service.Services
	tools  map[string]func(context.Context, map[string]any) (map[string]any, error)
}

func New(logger *slog.Logger, svc *service.Services) *Server {
	s := &Server{logger: logger, svc: svc, tools: map[string]func(context.Context, map[string]any) (map[string]any, error){}}
	s.registerTaskTools()
	s.registerProjectTools()
	s.registerTagTools()
	s.registerSystemTools()
	return s
}

type StdioRequest struct {
	Tool string         `json:"tool"`
	Args map[string]any `json:"args"`
}

type StdioResponse struct {
	OK    bool               `json:"ok"`
	Data  map[string]any     `json:"data,omitempty"`
	Error *domain.TypedError `json:"error,omitempty"`
}

func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	enc := json.NewEncoder(out)
	for scanner.Scan() {
		var req StdioRequest
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			_ = enc.Encode(StdioResponse{OK: false, Error: &domain.TypedError{Code: "BAD_REQUEST", Message: err.Error(), Retryable: false}})
			continue
		}
		h, ok := s.tools[req.Tool]
		if !ok {
			_ = enc.Encode(StdioResponse{OK: false, Error: &domain.TypedError{Code: "UNKNOWN_TOOL", Message: fmt.Sprintf("unknown tool %q", req.Tool), Retryable: false}})
			continue
		}
		result, err := h(ctx, req.Args)
		if err != nil {
			te := domain.TypedError{Code: "INTERNAL", Message: err.Error(), Retryable: false}
			_ = enc.Encode(StdioResponse{OK: false, Error: &te})
			continue
		}
		_ = enc.Encode(StdioResponse{OK: true, Data: result})
	}
	return scanner.Err()
}
