package pluginipc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// Client implements domain.Bridge over the filesystem IPC v2 protocol.
// It is safe for concurrent use; each Call gets its own request lifecycle.
type Client struct {
	cfg config.Config
	fs  FS
}

// NewClient ensures all data dirs exist and returns a ready bridge client.
func NewClient(cfg config.Config) (*Client, error) {
	fs := FS{}
	if err := fs.EnsureDirs(cfg.InboxDir, cfg.ProcDir, cfg.OutboxDir, cfg.EventsDir, cfg.DeadDir); err != nil {
		return nil, err
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 200 * time.Millisecond
	}
	return &Client{cfg: cfg, fs: fs}, nil
}

// Call writes a request envelope to the inbox and waits for the plugin to
// produce a response in the outbox (or a deadletter, or hit timeout, or
// stall, or be canceled). All five outcomes map to typed errors except OK.
func (c *Client) Call(ctx context.Context, req domain.Request) (domain.Response, error) {
	id := "req_" + randomID()
	env := Envelope{
		ProtocolVersion: domain.ProtocolVersion,
		ID:              id,
		Type:            "request",
		Action:          req.Action,
		SentAt:          time.Now().UTC().Format(time.RFC3339),
		Payload:         req.Payload,
		Meta:            map[string]any{"client": "sp-mcp"},
	}
	lc := newRequestLifecycle(c.cfg, c.fs, env)
	return lc.run(ctx)
}

// randomID returns 16 hex chars; falls back to nanosecond stamp if /dev/urandom
// is unavailable (the lifecycle still works because IDs only need to be unique
// across in-flight requests on this machine).
func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("fallback_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// AsTypedError unwraps a TypedError or wraps a plain error with fallbackCode.
// Used by callers that want to surface a structured error to MCP regardless
// of the underlying cause.
func AsTypedError(err error, fallbackCode string) domain.TypedError {
	var te domain.TypedError
	if errors.As(err, &te) {
		return te
	}
	return domain.TypedError{Code: fallbackCode, Message: err.Error(), Retryable: false}
}
