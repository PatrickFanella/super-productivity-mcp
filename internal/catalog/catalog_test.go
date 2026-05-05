package catalog

import (
	"errors"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

func TestLoadCatalog(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.ProtocolVersion != domain.ProtocolVersion {
		t.Fatalf("protocolVersion %q != domain.ProtocolVersion %q", c.ProtocolVersion, domain.ProtocolVersion)
	}
	if len(c.MCPTools()) != len(c.Tools) {
		// All tools currently MCP-exposed; fail loud if that changes silently.
		t.Fatalf("expected every tool to be MCP-exposed, got %d/%d", len(c.MCPTools()), len(c.Tools))
	}

	// Spot-check a few canonical mappings.
	mustMap := map[string]string{
		"create_task":         "task.create",
		"get_tasks":           "task.list",
		"add_time_to_task":    "task.addTime",
		"reorder_task":        "task.reorder",
		"bridge_health":       "bridge.health",
		"bridge_capabilities": "bridge.capabilities",
	}
	for mcp, action := range mustMap {
		tool := c.LookupMCP(mcp)
		if tool == nil {
			t.Fatalf("missing mcp tool %q", mcp)
		}
		if tool.Action != action {
			t.Fatalf("%s: action=%q want %q", mcp, tool.Action, action)
		}
		if c.LookupAction(action) != tool {
			t.Fatalf("LookupAction(%q) did not round-trip", action)
		}
	}
}

func TestValidateRequired(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	tool := c.LookupMCP("get_task")
	if tool == nil {
		t.Fatalf("get_task missing")
	}

	// Missing required `taskId` → INVALID_ARGS.
	err = tool.Validate(map[string]any{})
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %v", err)
	}
	if te.Code != "INVALID_ARGS" {
		t.Fatalf("got code %q", te.Code)
	}

	// Valid args pass.
	if err := tool.Validate(map[string]any{"taskId": "abc"}); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}

	// Lenient additionalProperties: extras allowed (LLMs send stray fields).
	if err := tool.Validate(map[string]any{"taskId": "abc", "stray": true}); err != nil {
		t.Fatalf("expected lenient validation, got %v", err)
	}
}

func TestValidateTypeMismatch(t *testing.T) {
	c, _ := Load()
	tool := c.LookupMCP("add_time_to_task")
	// timeMs must be integer.
	err := tool.Validate(map[string]any{"taskId": "x", "timeMs": "not-a-number"})
	var te domain.TypedError
	if !errors.As(err, &te) || te.Code != "INVALID_ARGS" {
		t.Fatalf("expected INVALID_ARGS, got %v", err)
	}
}
