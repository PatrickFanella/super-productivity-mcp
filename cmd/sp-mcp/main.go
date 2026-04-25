package main

import (
	"context"
	"os"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/logging"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
	"github.com/PatrickFanella/super-productivity-mcp/internal/pluginipc"
	"github.com/PatrickFanella/super-productivity-mcp/internal/service"
)

func main() {
	cfg := config.Load()
	logger := logging.New(cfg.LogLevel)
	bridge, err := pluginipc.NewClient(cfg)
	if err != nil {
		logger.Error("failed to init bridge", "error", err)
		os.Exit(1)
	}
	svc := service.New(bridge)
	server := mcpadapter.New(logger, svc)
	if err := server.Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
