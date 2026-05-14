package quickadd

import (
	"context"
	"errors"
	"strings"
)

type PromptOptions struct {
	Placeholder string
}

type PromptProvider interface {
	Prompt(context.Context, PromptOptions) (string, error)
}

type TaskCreator interface {
	CreateTask(context.Context, string) error
}

type Notifier interface {
	Success(title string)
	Failure(message string)
}

type Options struct {
	Title       string
	DryRun      bool
	Placeholder string
	Prompt      PromptProvider
	Creator     TaskCreator
	Notifier    Notifier
}

type Result struct {
	Title   string
	Created bool
	DryRun  bool
}

func Run(ctx context.Context, opts Options) (Result, error) {
	title, err := titleFromOptions(ctx, opts)
	if err != nil {
		return Result{}, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return Result{}, nil
	}

	res := Result{Title: title, DryRun: opts.DryRun}
	if opts.DryRun {
		return res, nil
	}
	if opts.Creator == nil {
		return Result{}, errors.New("task creator is required")
	}

	if err := opts.Creator.CreateTask(ctx, title); err != nil {
		if opts.Notifier != nil {
			opts.Notifier.Failure(err.Error())
		}
		return Result{}, err
	}
	res.Created = true
	if opts.Notifier != nil {
		opts.Notifier.Success(title)
	}
	return res, nil
}

func titleFromOptions(ctx context.Context, opts Options) (string, error) {
	if opts.Title != "" {
		return opts.Title, nil
	}
	if opts.Prompt == nil {
		return "", nil
	}
	return opts.Prompt.Prompt(ctx, PromptOptions{Placeholder: opts.Placeholder})
}
