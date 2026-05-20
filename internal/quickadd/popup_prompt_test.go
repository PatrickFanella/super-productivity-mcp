package quickadd

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestResolvePopupDirUsesExplicitDirectory(t *testing.T) {
	dir := writePopupDir(t)

	got, err := ResolvePopupDir(dir)

	if err != nil {
		t.Fatalf("ResolvePopupDir returned error: %v", err)
	}
	if got != dir {
		t.Fatalf("expected %q, got %q", dir, got)
	}
}

func TestResolvePopupDirRejectsInvalidExplicitDirectory(t *testing.T) {
	_, err := ResolvePopupDir(t.TempDir())

	if err == nil || !strings.Contains(err.Error(), "does not contain popup.js") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPopupPromptRunsGJSWithPopupAndTheme(t *testing.T) {
	dir := writePopupDir(t)
	customCSS := filepath.Join(t.TempDir(), "style.css")
	if err := os.WriteFile(customCSS, []byte(":root { --spqa-accent: #abcdef; }"), 0o644); err != nil {
		t.Fatal(err)
	}

	var gotName string
	var gotArgs []string
	prompt, err := NewPopupPrompt(PopupPromptOptions{
		PopupDir:     dir,
		ThemeCSSPath: customCSS,
		Placeholder:  "Capture task",
		Run: func(_ context.Context, name string, args []string) (CommandResult, error) {
			gotName = name
			gotArgs = append([]string(nil), args...)
			idx := indexOf(args, "--theme-css")
			if idx < 0 || idx+1 >= len(args) {
				t.Fatalf("expected --theme-css arg, got %#v", args)
			}
			b, err := os.ReadFile(args[idx+1])
			if err != nil {
				t.Fatalf("expected theme file to be readable: %v", err)
			}
			if !strings.Contains(string(b), "--spqa-accent: #abcdef") {
				t.Fatalf("expected custom theme css, got:\n%s", string(b))
			}
			return CommandResult{Stdout: "  Popup task\n"}, nil
		},
	})
	if err != nil {
		t.Fatalf("NewPopupPrompt returned error: %v", err)
	}

	title, err := prompt.Prompt(context.Background(), PromptOptions{})

	if err != nil {
		t.Fatalf("Prompt returned error: %v", err)
	}
	if title != "Popup task" {
		t.Fatalf("unexpected title %q", title)
	}
	if gotName != "gjs" {
		t.Fatalf("expected gjs, got %q", gotName)
	}
	wantPrefix := []string{filepath.Join(dir, "popup.js"), "--placeholder", "Capture task"}
	if !reflect.DeepEqual(gotArgs[:3], wantPrefix) {
		t.Fatalf("unexpected args prefix: got %#v want %#v", gotArgs[:3], wantPrefix)
	}
}

func writePopupDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "popup.js"), []byte("#!/usr/bin/env gjs\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func indexOf(args []string, value string) int {
	for i, arg := range args {
		if arg == value {
			return i
		}
	}
	return -1
}
