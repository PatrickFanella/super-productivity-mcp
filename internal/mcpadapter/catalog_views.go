package mcpadapter

// toolListEntry is the shape MCP clients expect from tools/list.
type toolListEntry struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	InputSchema  map[string]any `json:"inputSchema"`
	OutputSchema map[string]any `json:"outputSchema,omitempty"`
}

type resourceListEntry struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MimeType    string `json:"mimeType"`
}

func (s *Server) toolList() []toolListEntry {
	tools := s.catalog.MCPTools()
	out := make([]toolListEntry, len(tools))
	for i, t := range tools {
		out[i] = toolListEntry{Name: t.MCPName, Description: t.Description, InputSchema: t.InputSchema, OutputSchema: t.OutputSchema}
	}
	return out
}

func (s *Server) resourceList() []resourceListEntry {
	resources := s.catalog.MCPResources()
	out := make([]resourceListEntry, len(resources))
	for i, res := range resources {
		out[i] = resourceListEntry{URI: res.URI, Name: res.Name, Description: res.Description, MimeType: res.MimeType}
	}
	return out
}
