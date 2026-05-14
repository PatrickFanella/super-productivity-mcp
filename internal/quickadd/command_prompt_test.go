package quickadd

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestCommandPromptReturnsTrimmedStdout(t *testing.T) {
	p := CommandPrompt{
		Name: "popup",
		Args: []string{"--placeholder", "Add task..."},
		Run: func(_ context.Context, name string, args []string) (CommandResult, error) {
			if name != "popup" {
				t.Fatalf("expected popup command, got %q", name)
			}
			if !reflect.DeepEqual(args, []string{"--placeholder", "Add task..."}) {
				t.Fatalf("unexpected args: %+v", args)
			}
			return CommandResult{Stdout: "  Write popup docs @today\n"}, nil
		},
	}

	title, err := p.Prompt(context.Background(), PromptOptions{})

	if err != nil {
		t.Fatalf("Prompt returned error: %v", err)
	}
	if title != "Write popup docs @today" {
		t.Fatalf("unexpected title %q", title)
	}
}

func TestCommandPromptTreatsExitOneAsCancel(t *testing.T) {
	p := CommandPrompt{
		Name: "popup",
		Run: func(context.Context, string, []string) (CommandResult, error) {
			return CommandResult{ExitCode: 1}, ErrCommandExit
		},
	}

	title, err := p.Prompt(context.Background(), PromptOptions{})

	if err != nil {
		t.Fatalf("Prompt returned error: %v", err)
	}
	if title != "" {
		t.Fatalf("expected cancel to return empty title, got %q", title)
	}
}

func TestCommandPromptReturnsExitOneWithStderrAsFailure(t *testing.T) {
	p := CommandPrompt{
		Name: "popup",
		Run: func(context.Context, string, []string) (CommandResult, error) {
			return CommandResult{ExitCode: 1, Stderr: "cannot open display"}, ErrCommandExit
		},
	}

	_, err := p.Prompt(context.Background(), PromptOptions{})

	if err == nil || err.Error() != "popup failed with exit code 1: cannot open display" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCommandPromptReturnsNonCancelFailure(t *testing.T) {
	p := CommandPrompt{
		Name: "popup",
		Run: func(context.Context, string, []string) (CommandResult, error) {
			return CommandResult{ExitCode: 2, Stderr: "display unavailable"}, ErrCommandExit
		},
	}

	_, err := p.Prompt(context.Background(), PromptOptions{})

	if err == nil || err.Error() != "popup failed with exit code 2: display unavailable" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCommandPromptReturnsExecutionFailure(t *testing.T) {
	p := CommandPrompt{
		Name: "popup",
		Run: func(context.Context, string, []string) (CommandResult, error) {
			return CommandResult{}, errors.New("missing binary")
		},
	}

	_, err := p.Prompt(context.Background(), PromptOptions{})

	if err == nil || err.Error() != "missing binary" {
		t.Fatalf("unexpected error: %v", err)
	}
}
