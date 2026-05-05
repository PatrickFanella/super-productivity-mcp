// Package catalog is the single source of truth for MCP tools and their
// underlying plugin IPC actions. The on-disk JSON file is embedded into the
// Go binary; the same file is copied into the JS plugin and the skill snapshot
// at build time (see `make sync-catalogs`).
package catalog

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
	"github.com/santhosh-tekuri/jsonschema/v5"
)

//go:embed tools.json
var rawCatalog []byte

// Tool is one entry in the catalog: an MCP tool name (the LLM-facing surface),
// a plugin IPC action string (the bridge-facing surface), a description, and
// a JSON Schema describing the tool's arguments.
type Tool struct {
	MCPName     string         `json:"mcpName"`
	Action      string         `json:"action"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Internal    bool           `json:"internal,omitempty"`

	// schema is the compiled validator; populated on Load.
	schema *jsonschema.Schema
}

// Catalog is the loaded, validated tool catalog.
type Catalog struct {
	ProtocolVersion string  `json:"protocolVersion"`
	Tools           []*Tool `json:"tools"`

	byMCP    map[string]*Tool
	byAction map[string]*Tool
}

// Load parses the embedded catalog, asserts that its protocolVersion matches
// the running binary's domain.ProtocolVersion, and compiles every tool's
// inputSchema for validation. Any error means the binary is unrunnable.
func Load() (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(rawCatalog, &c); err != nil {
		return nil, fmt.Errorf("catalog: parse: %w", err)
	}
	if c.ProtocolVersion != domain.ProtocolVersion {
		return nil, fmt.Errorf("catalog: protocolVersion %q does not match domain.ProtocolVersion %q",
			c.ProtocolVersion, domain.ProtocolVersion)
	}
	c.byMCP = make(map[string]*Tool, len(c.Tools))
	c.byAction = make(map[string]*Tool, len(c.Tools))
	compiler := jsonschema.NewCompiler()
	for _, t := range c.Tools {
		if t.Action == "" {
			return nil, fmt.Errorf("catalog: tool with empty action")
		}
		if _, dup := c.byAction[t.Action]; dup {
			return nil, fmt.Errorf("catalog: duplicate action %q", t.Action)
		}
		if t.MCPName != "" {
			if _, dup := c.byMCP[t.MCPName]; dup {
				return nil, fmt.Errorf("catalog: duplicate mcpName %q", t.MCPName)
			}
			c.byMCP[t.MCPName] = t
		}
		c.byAction[t.Action] = t

		// Compile the schema. Use the action as the resource id so error
		// messages name the tool that failed.
		schemaJSON, err := json.Marshal(t.InputSchema)
		if err != nil {
			return nil, fmt.Errorf("catalog: marshal schema for %q: %w", t.Action, err)
		}
		resourceID := "catalog://" + t.Action + ".json"
		if err := compiler.AddResource(resourceID, bytes.NewReader(schemaJSON)); err != nil {
			return nil, fmt.Errorf("catalog: add schema for %q: %w", t.Action, err)
		}
		compiled, err := compiler.Compile(resourceID)
		if err != nil {
			return nil, fmt.Errorf("catalog: compile schema for %q: %w", t.Action, err)
		}
		t.schema = compiled
	}
	return &c, nil
}

// LookupMCP returns the tool registered under the given MCP tool name, or nil.
func (c *Catalog) LookupMCP(name string) *Tool {
	return c.byMCP[name]
}

// LookupAction returns the tool registered under the given IPC action, or nil.
func (c *Catalog) LookupAction(action string) *Tool {
	return c.byAction[action]
}

// MCPTools returns the tools that are exposed via MCP (i.e. mcpName != "").
func (c *Catalog) MCPTools() []*Tool {
	out := make([]*Tool, 0, len(c.Tools))
	for _, t := range c.Tools {
		if t.MCPName == "" || t.Internal {
			continue
		}
		out = append(out, t)
	}
	return out
}

// Actions returns every action string in the catalog, in declaration order.
// This is what `bridge.capabilities` advertises.
func (c *Catalog) Actions() []string {
	out := make([]string, len(c.Tools))
	for i, t := range c.Tools {
		out[i] = t.Action
	}
	return out
}

// Validate checks args against the tool's JSON Schema. Returns a typed
// INVALID_ARGS error on failure.
func (t *Tool) Validate(args map[string]any) error {
	if t.schema == nil {
		return nil
	}
	// jsonschema validates against decoded JSON values, which is what
	// args already is.
	if err := t.schema.Validate(args); err != nil {
		return domain.TypedError{
			Code:      "INVALID_ARGS",
			Message:   fmt.Sprintf("invalid arguments for %s: %s", t.MCPName, err),
			Retryable: false,
			Details:   map[string]any{"action": t.Action},
		}
	}
	return nil
}

// jsonReader is a tiny helper to feed bytes into the schema compiler.
func jsonReader(b []byte) *bytesReader { return &bytesReader{b: b} }

type bytesReader struct {
	b   []byte
	pos int
}

func (r *bytesReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.b) {
		return 0, errEOF
	}
	n := copy(p, r.b[r.pos:])
	r.pos += n
	return n, nil
}

var errEOF = fmt.Errorf("EOF")