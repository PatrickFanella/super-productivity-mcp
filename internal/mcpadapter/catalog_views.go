package mcpadapter

// toolListEntry is the shape MCP clients expect from tools/list.
type toolListEntry struct {
	Name         string         `json:"name"`
	Title        string         `json:"title,omitempty"`
	Description  string         `json:"description"`
	InputSchema  map[string]any `json:"inputSchema"`
	OutputSchema map[string]any `json:"outputSchema,omitempty"`
	Annotations  map[string]any `json:"annotations,omitempty"`
}

type resourceListEntry struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MimeType    string `json:"mimeType"`
}

// toolList returns the tools the grant allows, followed by each one's
// aliases as separate entries.
func (s *Server) toolList() []toolListEntry {
	out := []toolListEntry{}
	for _, t := range s.catalog.MCPTools() {
		if !s.allowed(t) {
			continue
		}
		var annotations map[string]any
		if len(t.Annotations) > 0 || t.Title != "" {
			annotations = map[string]any{}
			if t.Title != "" {
				annotations["title"] = t.Title
			}
			for k, v := range t.Annotations {
				annotations[k] = v
			}
		}
		entry := toolListEntry{
			Name:         t.MCPName,
			Title:        t.Title,
			Description:  t.Description,
			InputSchema:  t.InputSchema,
			OutputSchema: t.OutputSchema,
			Annotations:  annotations,
		}
		out = append(out, entry)
		for _, alias := range t.Aliases {
			aliasEntry := entry
			aliasEntry.Name = alias
			aliasEntry.Description = t.Description + " (Alias of " + t.MCPName + ".)"
			out = append(out, aliasEntry)
		}
	}
	return out
}

// resourceList returns the resources; they all need the read scope.
func (s *Server) resourceList() []resourceListEntry {
	out := []resourceListEntry{}
	if !s.scopes["read"] {
		return out
	}
	for _, res := range s.catalog.MCPResources() {
		out = append(out, resourceListEntry{URI: res.URI, Name: res.Name, Description: res.Description, MimeType: res.MimeType})
	}
	return out
}
