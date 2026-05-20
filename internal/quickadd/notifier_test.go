package quickadd

import (
	"context"
	"reflect"
	"testing"
)

func TestCommandNotifierSendsSuccessAndFailure(t *testing.T) {
	var calls [][]string
	n := CommandNotifier{Run: func(_ context.Context, name string, args []string) (CommandResult, error) {
		calls = append(calls, append([]string{name}, args...))
		return CommandResult{}, nil
	}}

	n.Success("Write docs")
	n.Failure("bridge down")

	want := [][]string{
		{"notify-send", "Super Productivity", "Task added: Write docs"},
		{"notify-send", "Super Productivity quick add failed", "bridge down"},
	}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("unexpected notify calls:\n got: %#v\nwant: %#v", calls, want)
	}
}
