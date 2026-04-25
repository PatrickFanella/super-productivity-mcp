package pluginipc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type Client struct {
	cfg config.Config
	fs  FS
}

func NewClient(cfg config.Config) (*Client, error) {
	fs := FS{}
	if err := fs.EnsureDirs(cfg.InboxDir, cfg.ProcDir, cfg.OutboxDir, cfg.EventsDir, cfg.DeadDir); err != nil {
		return nil, err
	}
	return &Client{cfg: cfg, fs: fs}, nil
}

func (c *Client) Call(ctx context.Context, req domain.Request) (domain.Response, error) {
	id := "req_" + randomID()
	now := time.Now().UTC().Format(time.RFC3339)
	env := Envelope{
		ProtocolVersion: domain.ProtocolVersion,
		ID:              id,
		Type:            "request",
		Action:          req.Action,
		SentAt:          now,
		Payload:         req.Payload,
		Meta: map[string]any{
			"client": "sp-mcp",
		},
	}

	if err := c.fs.WriteJSONAtomic(filepath.Join(c.cfg.InboxDir, id+".json"), env); err != nil {
		return domain.Response{}, err
	}

	deadline := time.Now().Add(c.cfg.Timeout)
	for {
		if ctx.Err() != nil {
			return domain.Response{}, ctx.Err()
		}
		if time.Now().After(deadline) {
			return domain.Response{}, ErrTimeout
		}
		responsePath := filepath.Join(c.cfg.OutboxDir, id+".json")
		if _, err := os.Stat(responsePath); err == nil {
			var resp Envelope
			if err := c.fs.ReadJSON(responsePath, &resp); err != nil {
				return domain.Response{}, err
			}
			_ = os.Remove(responsePath)
			if resp.Error != nil {
				return domain.Response{}, *resp.Error
			}
			return domain.Response{Result: resp.Result}, nil
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (c *Client) Health(ctx context.Context) (domain.HealthStatus, error) {
	resp, err := c.Call(ctx, domain.Request{Action: "bridge.health", Payload: map[string]any{}})
	if err != nil {
		return domain.HealthStatus{}, err
	}
	msg, _ := resp.Result["message"].(string)
	ok, _ := resp.Result["ok"].(bool)
	return domain.HealthStatus{OK: ok, Message: msg}, nil
}

func (c *Client) Capabilities(ctx context.Context) (domain.Capabilities, error) {
	resp, err := c.Call(ctx, domain.Request{Action: "bridge.capabilities", Payload: map[string]any{}})
	if err != nil {
		return domain.Capabilities{}, err
	}
	cap := domain.Capabilities{}
	if v, ok := resp.Result["pluginVersion"].(string); ok {
		cap.PluginVersion = v
	}
	if v, ok := resp.Result["spVersion"].(string); ok {
		cap.SPVersion = v
	}
	if list, ok := resp.Result["supportedActions"].([]any); ok {
		for _, item := range list {
			if s, ok := item.(string); ok {
				cap.SupportedActions = append(cap.SupportedActions, s)
			}
		}
	}
	return cap, nil
}

func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("fallback_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func AsTypedError(err error, fallbackCode string) domain.TypedError {
	var te domain.TypedError
	if errors.As(err, &te) {
		return te
	}
	return domain.TypedError{Code: fallbackCode, Message: err.Error(), Retryable: false}
}
