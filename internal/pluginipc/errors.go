package pluginipc

import "github.com/PatrickFanella/super-productivity-mcp/internal/domain"

var (
	ErrTimeout = domain.TypedError{Code: "TIMEOUT", Message: "bridge response timeout", Retryable: true}
)
