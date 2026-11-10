package main

import (
	"context"
	"os"

	"github.com/PatrickFanella/super-productivity-mcp/internal/bridge"
	"github.com/PatrickFanella/super-productivity-mcp/internal/catalog"
	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/logging"
	"github.com/PatrickFanella/super-productivity-mcp/internal/mcpadapter"
)

func main() {
	cfg := config.Load()
	logger := logging.New(cfg.LogLevel)

	cat, err := catalog.Load()
	if err != nil {
		logger.Error("failed to load tool catalog", "error", err)
		os.Exit(1)
	}

	router := bridge.New(cfg)
	if err := router.RESTError(); err != nil {
		// Archive and other REST-mapped tools report this error; nothing falls
		// back to plugin IPC, because the user asked for REST.
		logger.Warn("Local REST settings are unusable", "error", err)
	}
	if len(cfg.InvalidScopes) > 0 {
		logger.Warn("ignoring unknown SP_MCP_SCOPES entries", "invalid", cfg.InvalidScopes, "granted", cfg.Scopes)
	}
	server := mcpadapter.NewWithOptions(logger, router, cat, mcpadapter.Options{
		Scopes:           cfg.Scopes,
		MaxResponseBytes: cfg.MaxResponseBytes,
	})
	if err := server.Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		logger.Error("server exited", "error", err)
		os.Exit(1)
	}
}
