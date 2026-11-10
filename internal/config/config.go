package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// AllScopes is the default grant: every tool, with notes. It matches the
// server's behaviour before scopes existed.
var AllScopes = []string{"read", "notes", "create", "write"}

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
	// Scopes limits which tools are listed and callable (SP_MCP_SCOPES,
	// comma-separated read,notes,create,write). Unknown names are reported
	// in InvalidScopes and ignored.
	Scopes        []string
	InvalidScopes []string
	// MaxResponseBytes caps a tool result's JSON size; 0 disables the cap
	// (SP_MCP_MAX_RESPONSE_BYTES).
	MaxResponseBytes int

	// Local REST settings. An empty URL leaves every action on plugin IPC.
	// LocalRESTURL comes from SP_LOCAL_REST_URL, or SUPER_PRODUCTIVITY_REST_URL
	// when that is unset; stock v20 serves http://127.0.0.1:3876.
	LocalRESTURL   string
	LocalRESTToken string // SP_LOCAL_REST_TOKEN
	// LocalRESTAllowRemote permits a non-loopback host (SP_LOCAL_REST_ALLOW_REMOTE).
	LocalRESTAllowRemote bool
	// LocalRESTTimeout bounds one request (SP_LOCAL_REST_TIMEOUT); 0 = default.
	LocalRESTTimeout time.Duration

	// RecurrenceRoute is SP_MCP_RECURRENCE_ROUTE. RecurrenceRoutePlugin sends
	// recurrence writes to the plugin's repeat-config dispatch, which only a
	// patched app allows; anything else uses Local REST.
	RecurrenceRoute string
}

// RecurrenceRoutePlugin selects the legacy plugin path for recurrence writes.
const RecurrenceRoutePlugin = "plugin"

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
	scopes, invalidScopes := parseScopes(os.Getenv("SP_MCP_SCOPES"))
	maxResponseBytes := 0
	if raw := os.Getenv("SP_MCP_MAX_RESPONSE_BYTES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			maxResponseBytes = n
		}
	}
	restURL := strings.TrimSpace(os.Getenv("SP_LOCAL_REST_URL"))
	if restURL == "" {
		restURL = strings.TrimSpace(os.Getenv("SUPER_PRODUCTIVITY_REST_URL"))
	}
	var restTimeout time.Duration
	if raw := os.Getenv("SP_LOCAL_REST_TIMEOUT"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			restTimeout = d
		}
	}
	allowRemote, _ := strconv.ParseBool(strings.TrimSpace(os.Getenv("SP_LOCAL_REST_ALLOW_REMOTE")))
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

		Scopes:           scopes,
		InvalidScopes:    invalidScopes,
		MaxResponseBytes: maxResponseBytes,

		LocalRESTURL:         restURL,
		LocalRESTToken:       strings.TrimSpace(os.Getenv("SP_LOCAL_REST_TOKEN")),
		LocalRESTAllowRemote: allowRemote,
		LocalRESTTimeout:     restTimeout,

		RecurrenceRoute: strings.ToLower(strings.TrimSpace(os.Getenv("SP_MCP_RECURRENCE_ROUTE"))),
	}
}

// parseScopes reads a comma-separated scope list. An unset or blank value
// grants every scope. "all" is shorthand for every scope.
func parseScopes(raw string) (scopes, invalid []string) {
	if strings.TrimSpace(raw) == "" {
		return append([]string(nil), AllScopes...), nil
	}
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		name := strings.ToLower(strings.TrimSpace(part))
		if name == "" {
			continue
		}
		if name == "all" {
			for _, s := range AllScopes {
				seen[s] = true
			}
			continue
		}
		known := false
		for _, s := range AllScopes {
			if s == name {
				known = true
			}
		}
		if !known {
			invalid = append(invalid, name)
			continue
		}
		seen[name] = true
	}
	for _, s := range AllScopes {
		if seen[s] {
			scopes = append(scopes, s)
		}
	}
	return scopes, invalid
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
