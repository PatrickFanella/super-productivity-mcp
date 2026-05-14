package quickadd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveThemeCSSUsesCustomCSSFile(t *testing.T) {
	dir := t.TempDir()
	custom := filepath.Join(dir, "custom.css")
	if err := os.WriteFile(custom, []byte(":root { --spqa-accent: #abcdef; }"), 0o644); err != nil {
		t.Fatal(err)
	}

	css, err := ResolveThemeCSS(ThemeOptions{CustomCSSPath: custom})

	if err != nil {
		t.Fatalf("ResolveThemeCSS returned error: %v", err)
	}
	if !strings.Contains(css, ".spqa-panel") || !strings.Contains(css, "--spqa-accent: #abcdef;") {
		t.Fatalf("unexpected css: %q", css)
	}
}

func TestResolveThemeCSSMapsOmarchyColorsToml(t *testing.T) {
	dir := t.TempDir()
	colors := filepath.Join(dir, "colors.toml")
	if err := os.WriteFile(colors, []byte(strings.Join([]string{
		`background = "#101010"`,
		`foreground = "#eeeeee"`,
		`accent = "#00ff00"`,
		`color14 = "#555555"`,
		`color1 = "#ff0000"`,
	}, "\n")), 0o644); err != nil {
		t.Fatal(err)
	}

	css, err := ResolveThemeCSS(ThemeOptions{OmarchyThemeDir: dir})

	if err != nil {
		t.Fatalf("ResolveThemeCSS returned error: %v", err)
	}
	for _, want := range []string{
		"--spqa-bg: #101010;",
		"--spqa-panel: #101010;",
		"--spqa-fg: #eeeeee;",
		"--spqa-accent: #00ff00;",
		"--spqa-muted: #555555;",
		"--spqa-error: #ff0000;",
	} {
		if !strings.Contains(css, want) {
			t.Fatalf("expected css to contain %q, got:\n%s", want, css)
		}
	}
}

func TestResolveThemeCSSFallsBackWhenNoThemeFound(t *testing.T) {
	css, err := ResolveThemeCSS(ThemeOptions{OmarchyThemeDir: filepath.Join(t.TempDir(), "missing")})

	if err != nil {
		t.Fatalf("ResolveThemeCSS returned error: %v", err)
	}
	if !strings.Contains(css, "--spqa-bg:") || !strings.Contains(css, ".spqa-window") {
		t.Fatalf("expected fallback theme css, got:\n%s", css)
	}
}
