package quickadd

import (
	"context"
	"errors"
	"testing"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

type fakePrompt struct {
	text  string
	err   error
	calls int
}

func (f *fakePrompt) Prompt(context.Context, PromptOptions) (string, error) {
	f.calls++
	return f.text, f.err
}

type fakeCreator struct {
	reqs []domain.Request
	err  error
}

func (f *fakeCreator) CreateTask(_ context.Context, title string) error {
	f.reqs = append(f.reqs, domain.Request{Action: "task.create", Payload: map[string]any{"title": title}})
	return f.err
}

type fakeNotifier struct {
	success []string
	failure []string
}

func (f *fakeNotifier) Success(title string) { f.success = append(f.success, title) }
func (f *fakeNotifier) Failure(msg string)   { f.failure = append(f.failure, msg) }

func TestRunDoesNothingForBlankDirectTitle(t *testing.T) {
	creator := &fakeCreator{}
	notifier := &fakeNotifier{}

	res, err := Run(context.Background(), Options{Title: "  ", Prompt: &fakePrompt{text: "ignored"}, Creator: creator, Notifier: notifier})

	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if res.Created {
		t.Fatalf("expected no task creation")
	}
	if len(creator.reqs) != 0 {
		t.Fatalf("expected no create requests, got %d", len(creator.reqs))
	}
	if len(notifier.success) != 0 || len(notifier.failure) != 0 {
		t.Fatalf("expected no notifications, got success=%v failure=%v", notifier.success, notifier.failure)
	}
}

func TestRunCreatesTaskFromDirectTitle(t *testing.T) {
	creator := &fakeCreator{}
	notifier := &fakeNotifier{}

	res, err := Run(context.Background(), Options{Title: "  Write docs @today #work 30m  ", Creator: creator, Notifier: notifier})

	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if !res.Created || res.Title != "Write docs @today #work 30m" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if len(creator.reqs) != 1 {
		t.Fatalf("expected one create request, got %d", len(creator.reqs))
	}
	if creator.reqs[0].Action != "task.create" || creator.reqs[0].Payload["title"] != "Write docs @today #work 30m" {
		t.Fatalf("unexpected request: %+v", creator.reqs[0])
	}
	if len(notifier.success) != 1 || notifier.success[0] != "Write docs @today #work 30m" {
		t.Fatalf("expected success notification, got %+v", notifier.success)
	}
}

func TestRunDryRunSkipsTaskCreation(t *testing.T) {
	creator := &fakeCreator{}
	notifier := &fakeNotifier{}

	res, err := Run(context.Background(), Options{Title: "Plan release", DryRun: true, Creator: creator, Notifier: notifier})

	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if res.Created || !res.DryRun || res.Title != "Plan release" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if len(creator.reqs) != 0 {
		t.Fatalf("expected no create requests, got %d", len(creator.reqs))
	}
	if len(notifier.success) != 0 || len(notifier.failure) != 0 {
		t.Fatalf("expected no notifications in dry-run, got success=%v failure=%v", notifier.success, notifier.failure)
	}
}

func TestRunPromptsWhenTitleMissing(t *testing.T) {
	prompt := &fakePrompt{text: "Inbox item"}
	creator := &fakeCreator{}

	res, err := Run(context.Background(), Options{Prompt: prompt, Creator: creator})

	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if prompt.calls != 1 {
		t.Fatalf("expected prompt once, got %d", prompt.calls)
	}
	if !res.Created || res.Title != "Inbox item" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRunNotifiesFailure(t *testing.T) {
	creator := &fakeCreator{err: errors.New("bridge down")}
	notifier := &fakeNotifier{}

	_, err := Run(context.Background(), Options{Title: "Broken", Creator: creator, Notifier: notifier})

	if err == nil {
		t.Fatalf("expected error")
	}
	if len(notifier.failure) != 1 || notifier.failure[0] != "bridge down" {
		t.Fatalf("expected failure notification, got %+v", notifier.failure)
	}
}

func TestRunRequiresCreatorWhenCreating(t *testing.T) {
	_, err := Run(context.Background(), Options{Title: "Needs creator"})

	if err == nil || err.Error() != "task creator is required" {
		t.Fatalf("expected missing creator error, got %v", err)
	}
}
