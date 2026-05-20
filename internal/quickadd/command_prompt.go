package quickadd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

var ErrCommandExit = errors.New("prompt command exited")

type CommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

type CommandRunner func(context.Context, string, []string) (CommandResult, error)

type CommandPrompt struct {
	Name string
	Args []string
	Run  CommandRunner
}

func (p CommandPrompt) CommandName() string   { return p.Name }
func (p CommandPrompt) CommandArgs() []string { return append([]string(nil), p.Args...) }

func (p CommandPrompt) Prompt(ctx context.Context, _ PromptOptions) (string, error) {
	runner := p.Run
	if runner == nil {
		runner = ExecCommand
	}
	res, err := runner(ctx, p.Name, p.Args)
	if err != nil {
		if errors.Is(err, ErrCommandExit) {
			stderr := strings.TrimSpace(res.Stderr)
			if res.ExitCode == 1 && stderr == "" {
				return "", nil
			}
			if stderr != "" {
				return "", fmt.Errorf("%s failed with exit code %d: %s", p.Name, res.ExitCode, stderr)
			}
			return "", fmt.Errorf("%s failed with exit code %d", p.Name, res.ExitCode)
		}
		return "", err
	}
	return strings.TrimSpace(res.Stdout), nil
}

func ExecCommand(ctx context.Context, name string, args []string) (CommandResult, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return CommandResult{Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: exitErr.ExitCode()}, ErrCommandExit
		}
		return CommandResult{Stdout: stdout.String(), Stderr: stderr.String()}, err
	}
	return CommandResult{Stdout: stdout.String(), Stderr: stderr.String()}, nil
}
