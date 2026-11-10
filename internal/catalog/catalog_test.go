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
	// Every tool is MCP-exposed except the deliberate internal actions; fail
	// loud if that changes silently.
	internal := map[string]bool{"task.dayContext": true}
	for _, tool := range c.Tools {
		if (tool.MCPName == "" || tool.Internal) != internal[tool.Action] {
			t.Fatalf("tool %q: internal=%v, want %v", tool.Action, tool.MCPName == "" || tool.Internal, internal[tool.Action])
		}
	}
	if len(c.MCPTools()) != len(c.Tools)-len(internal) {
		t.Fatalf("MCP tools %d, want %d", len(c.MCPTools()), len(c.Tools)-len(internal))
	}
	if len(c.MCPResources()) == 0 {
		t.Fatalf("expected MCP resources to be catalog-driven")
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
	res := c.LookupResource("sp://schedule/health")
	if res == nil || res.Action != "task.scheduleHealth" {
		t.Fatalf("schedule health resource did not load: %#v", res)
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

func TestValidateOutputSchema(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	tool := c.LookupMCP("get_tasks")
	if tool == nil {
		t.Fatalf("get_tasks missing")
	}
	if err := tool.ValidateOutput(map[string]any{"tasks": []any{map[string]any{"id": "t1"}}}); err != nil {
		t.Fatalf("valid output failed: %v", err)
	}
	var te domain.TypedError
	if err := tool.ValidateOutput(map[string]any{"results": []any{}}); !errors.As(err, &te) || te.Code != "INVALID_OUTPUT" {
		t.Fatalf("expected INVALID_OUTPUT, got %v", err)
	}
}

// TestEveryToolDeclaresAMatchingScope keeps a new tool from being callable
// under every grant: only the status tools may omit a scope, read-only tools
// need read, and tools that change data need create or write.
func TestEveryToolDeclaresAMatchingScope(t *testing.T) {
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	statusTools := map[string]bool{"get_status": true, "check_connection": true, "bridge_health": true, "debug_directories": true, "bridge_capabilities": true}
	for _, tool := range c.MCPTools() {
		switch {
		case statusTools[tool.MCPName]:
			if tool.Scope != "" || !tool.ReadOnly() {
				t.Errorf("%s: status tools are read-only and unscoped", tool.MCPName)
			}
		case tool.Scope == "":
			t.Errorf("%s: missing scope", tool.MCPName)
		case tool.ReadOnly() && tool.Scope != ScopeRead:
			t.Errorf("%s: read-only but scope %q", tool.MCPName, tool.Scope)
		case !tool.ReadOnly() && tool.Scope != ScopeCreate && tool.Scope != ScopeWrite:
			t.Errorf("%s: changes data but scope %q", tool.MCPName, tool.Scope)
		}
	}
}
