package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

type Config struct {
	DataDir      string
	InboxDir     string
	ProcDir      string
	OutboxDir    string
	EventsDir    string
	DeadDir      string
	Timeout      time.Duration
	PollInterval time.Duration
	Retries      int
	LogLevel     string
}

func Load() Config {
	base := os.Getenv("SP_MCP_DATA_DIR")
	if base == "" {
		base = defaultDataDir()
	}
	timeout := 30 * time.Second
	if raw := os.Getenv("SP_MCP_TIMEOUT"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil {
			timeout = d
		}
	}
	pollInterval := 200 * time.Millisecond
	if raw := os.Getenv("SP_MCP_POLL_INTERVAL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			pollInterval = d
		}
	}
	retries := 0
	if raw := os.Getenv("SP_MCP_RETRIES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			retries = n
		}
	}
	level := os.Getenv("SP_MCP_LOG_LEVEL")
	if level == "" {
		level = "info"
	}

	return Config{
		DataDir:      base,
		InboxDir:     filepath.Join(base, "inbox"),
		ProcDir:      filepath.Join(base, "processing"),
		OutboxDir:    filepath.Join(base, "outbox"),
		EventsDir:    filepath.Join(base, "events"),
		DeadDir:      filepath.Join(base, "deadletter"),
		Timeout:      timeout,
		PollInterval: pollInterval,
		Retries:      retries,
		LogLevel:     level,
	}
}

func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "super-productivity-mcp")
		}
		return filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming", "super-productivity-mcp")
	}
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, _ := os.UserHomeDir()
		base = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(base, "super-productivity-mcp")
}
