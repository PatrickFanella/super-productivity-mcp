package quickadd

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type ThemeOptions struct {
	CustomCSSPath   string
	OmarchyThemeDir string
}

func ResolveThemeCSS(opts ThemeOptions) (string, error) {
	base := fallbackThemeCSS
	if opts.OmarchyThemeDir != "" {
		colors, err := readColorsToml(filepath.Join(opts.OmarchyThemeDir, "colors.toml"))
		if err == nil {
			base = cssFromColors(colors)
		} else if !os.IsNotExist(err) {
			return "", err
		}
	}

	if opts.CustomCSSPath != "" {
		b, err := os.ReadFile(opts.CustomCSSPath)
		if err == nil {
			return base + "\n" + string(b), nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
	}
	return base, nil
}

func readColorsToml(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	colors := map[string]string{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		if strings.HasPrefix(value, "#") {
			colors[key] = value
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return colors, nil
}

func cssFromColors(colors map[string]string) string {
	get := func(key, fallback string) string {
		if v := colors[key]; v != "" {
			return v
		}
		return fallback
	}
	return fmt.Sprintf(baseThemeCSS,
		get("background", "#1c182c"),
		get("background", "#241f38"),
		get("foreground", "#88ff88"),
		get("accent", "#13ff1e"),
		get("color14", "#466b5a"),
		get("color1", "#f44336"),
	)
}

const baseThemeCSS = `:root {
  --spqa-bg: %s;
  --spqa-panel: %s;
  --spqa-fg: %s;
  --spqa-accent: %s;
  --spqa-muted: %s;
  --spqa-error: %s;
  --spqa-radius: 12px;
}

.spqa-window {
  background: transparent;
}

.spqa-panel {
  background: alpha(var(--spqa-panel), 0.96);
  color: var(--spqa-fg);
  border: 2px solid var(--spqa-accent);
  border-radius: var(--spqa-radius);
  padding: 18px;
}

.spqa-entry {
  background: var(--spqa-bg);
  color: var(--spqa-fg);
  border: 1px solid var(--spqa-muted);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 18px;
}

.spqa-hint {
  color: var(--spqa-muted);
  font-size: 12px;
}
`

var fallbackThemeCSS = fmt.Sprintf(baseThemeCSS, "#1c182c", "#241f38", "#88ff88", "#13ff1e", "#466b5a", "#f44336")
