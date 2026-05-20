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
// the plugin bridge implementation. Callers own catalog lookup, validation, and
// user-facing reply shaping; Bridge owns only delivery of a resolved action and
// payload to the current adapter. Keep this interface small until the suite has
// a second production adapter: one adapter is a hypothetical seam, two adapters
// are a real seam.
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
