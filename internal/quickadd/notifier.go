package quickadd

import "context"

type CommandNotifier struct {
	Run CommandRunner
}

func (n CommandNotifier) Success(title string) {
	n.notify("Super Productivity", "Task added: "+title)
}

func (n CommandNotifier) Failure(message string) {
	n.notify("Super Productivity quick add failed", message)
}

func (n CommandNotifier) notify(summary string, body string) {
	runner := n.Run
	if runner == nil {
		runner = ExecCommand
	}
	_, _ = runner(context.Background(), "notify-send", []string{summary, body})
}
