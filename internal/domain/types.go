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
