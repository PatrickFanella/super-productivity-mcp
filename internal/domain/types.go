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

type HealthStatus struct {
	OK      bool
	Message string
}

type Capabilities struct {
	SupportedActions []string `json:"supportedActions"`
	PluginVersion    string   `json:"pluginVersion,omitempty"`
	SPVersion        string   `json:"spVersion,omitempty"`
}

type Bridge interface {
	Call(ctx context.Context, req Request) (Response, error)
	Health(ctx context.Context) (HealthStatus, error)
	Capabilities(ctx context.Context) (Capabilities, error)
}

type TypedError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Retryable bool           `json:"retryable"`
	Details   map[string]any `json:"details,omitempty"`
}

func (e TypedError) Error() string { return e.Message }
