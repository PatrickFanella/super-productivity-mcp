package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestParseOptionsDefaultsToWalkerPrompt(t *testing.T) {
	var stderr bytes.Buffer
	opts, err := parseOptions([]string{"--title", "Write docs", "--dry-run"}, &stderr)

	if err != nil {
		t.Fatalf("parseOptions returned error: %v", err)
	}
	if opts.title != "Write docs" || !opts.dryRun || opts.prompt != "walker" {
		t.Fatalf("unexpected options: %+v", opts)
	}
}

func TestRunDryRunDoesNotRequireBridge(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := run(context.Background(), []string{"--dry-run", "--title", "Smoke quick add @today", "--no-notify"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("expected exit 0, got %d stderr=%s", code, stderr.String())
	}
	if got := strings.TrimSpace(stdout.String()); got != "dry-run: Smoke quick add @today" {
		t.Fatalf("unexpected stdout %q", got)
	}
}

func TestRemovedPopupOptionsAreRejected(t *testing.T) {
	for _, args := range [][]string{
		{"--prompt", "popup", "--dry-run", "--no-notify"},
		{"--popup-dir", "/tmp", "--dry-run"},
		{"--theme-css", "/tmp/style.css", "--dry-run"},
	} {
		t.Run(args[0], func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			if code := run(context.Background(), args, &stdout, &stderr); code == 0 {
				t.Fatal("expected removed popup option to fail")
			}
			if stderr.Len() == 0 {
				t.Fatal("expected an explanation for the unsupported option")
			}
		})
	}
}
