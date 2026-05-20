package pluginipc

import (
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

const (
	envelopeTypeRequest  = "request"
	envelopeTypeResponse = "response"

	responseStatusOK    = "ok"
	responseStatusError = "error"

	requestMetaClient = "sp-mcp"

	eventRequestSent       = "request.sent"
	eventRequestCanceled   = "request.canceled"
	eventRequestTimeout    = "request.timeout"
	eventRequestStalled    = "request.stalled"
	eventRequestDeadletter = "request.deadletter"
	eventResponseOK        = "response.ok"
	eventResponseError     = "response.error"

	errorCodeTimeout       = "TIMEOUT"
	errorCodePluginStalled = "PLUGIN_STALLED"
	errorCodeDeadletter    = "DEADLETTER"
	errorCodeCanceled      = "CANCELED"
)

func newRequestEnvelope(id string, req domain.Request, sentAt time.Time) Envelope {
	return Envelope{
		ProtocolVersion: domain.ProtocolVersion,
		ID:              id,
		Type:            envelopeTypeRequest,
		Action:          req.Action,
		SentAt:          sentAt.UTC().Format(time.RFC3339),
		Payload:         req.Payload,
		Meta:            map[string]any{"client": requestMetaClient},
	}
}
