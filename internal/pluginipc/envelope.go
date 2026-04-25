package pluginipc

import "github.com/PatrickFanella/super-productivity-mcp/internal/domain"

type Envelope struct {
	ProtocolVersion string             `json:"protocolVersion"`
	ID              string             `json:"id"`
	Type            string             `json:"type"`
	Action          string             `json:"action,omitempty"`
	Event           string             `json:"event,omitempty"`
	Status          string             `json:"status,omitempty"`
	SentAt          string             `json:"sentAt,omitempty"`
	Payload         map[string]any     `json:"payload,omitempty"`
	Result          map[string]any     `json:"result,omitempty"`
	Error           *domain.TypedError `json:"error,omitempty"`
	Meta            map[string]any     `json:"meta,omitempty"`
}
