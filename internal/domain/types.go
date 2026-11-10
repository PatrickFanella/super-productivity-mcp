package domain

import "context"

const ProtocolVersion = "2.0"

type Request struct {
	Action  string
	Payload map[string]any
}

type Response struct {
	Result map[string]any
}

// Bridge is the narrow action-dispatch seam between catalog-aware callers and
// the adapters that deliver actions: plugin IPC and Local REST, chosen per
// action by internal/bridge. Callers own catalog lookup, validation, and
// user-facing reply shaping; Bridge owns only delivery of a resolved action and
// payload. Keep it a single Call method; routing belongs in internal/bridge.
type Bridge interface {
	Call(ctx context.Context, req Request) (Response, error)
}

type TypedError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Retryable bool           `json:"retryable"`
	Details   map[string]any `json:"details,omitempty"`
}

func (e TypedError) Error() string { return e.Message }
