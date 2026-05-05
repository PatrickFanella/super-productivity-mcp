package version

import "github.com/PatrickFanella/super-productivity-mcp/internal/domain"

var (
	BinaryVersion = "0.1.0"
	Commit        = "dev"
	BuildDate     = "unknown"
)

// MCPProtocolVersion is the MCP wire protocol date this server speaks.
// Bumped only when the JSON-RPC surface changes shape.
const MCPProtocolVersion = "2024-11-05"

// EnvelopeProtocolVersion is the plugin IPC envelope schema version.
// Re-exported from internal/domain so callers don't have to import two
// packages just to read versions.
const EnvelopeProtocolVersion = domain.ProtocolVersion
