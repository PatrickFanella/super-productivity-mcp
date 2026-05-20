package quickadd

import (
	"reflect"
	"testing"
)

func TestNewPromptProviderDefaultsToWalker(t *testing.T) {
	provider, err := NewPromptProvider(PromptProviderOptions{})
	if err != nil {
		t.Fatalf("NewPromptProvider returned error: %v", err)
	}
	prompt, ok := provider.(CommandPrompt)
	if !ok {
		t.Fatalf("expected CommandPrompt, got %T", provider)
	}
	if prompt.Name != "walker" {
		t.Fatalf("expected walker command, got %q", prompt.Name)
	}
	wantArgs := []string{"--dmenu", "--inputonly", "--placeholder", DefaultPlaceholder}
	if !reflect.DeepEqual(prompt.Args, wantArgs) {
		t.Fatalf("unexpected args: got %#v want %#v", prompt.Args, wantArgs)
	}
}

func TestNewPromptProviderRejectsUnknownPromptMode(t *testing.T) {
	_, err := NewPromptProvider(PromptProviderOptions{Mode: "unknown"})

	if err == nil || err.Error() != `unknown prompt mode "unknown"` {
		t.Fatalf("unexpected error: %v", err)
	}
}
