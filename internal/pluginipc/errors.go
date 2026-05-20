package pluginipc

import "github.com/PatrickFanella/super-productivity-mcp/internal/domain"

// Typed errors surfaced by the bridge lifecycle. Each maps to one of the
// terminal outcomes a request can reach: timeout, plugin never picked up
// the request, request landed in deadletter without an outbox response,
// or context cancellation.
var (
	ErrTimeout       = domain.TypedError{Code: errorCodeTimeout, Message: "bridge response timeout", Retryable: true}
	ErrPluginStalled = domain.TypedError{Code: errorCodePluginStalled, Message: "plugin did not consume request before timeout", Retryable: true}
	ErrDeadletter    = domain.TypedError{Code: errorCodeDeadletter, Message: "request landed in deadletter without outbox response", Retryable: false}
	ErrCanceled      = domain.TypedError{Code: errorCodeCanceled, Message: "request canceled by caller", Retryable: false}
)
