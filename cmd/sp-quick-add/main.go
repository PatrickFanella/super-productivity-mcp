package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/pluginipc"
	"github.com/PatrickFanella/super-productivity-mcp/internal/quickadd"
)

type cliOptions struct {
	title       string
	dryRun      bool
	prompt      string
	noNotify    bool
	placeholder string
}

func main() {
	os.Exit(run(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, stdout io.Writer, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		return 2
	}

	var prompt quickadd.PromptProvider
	if opts.title == "" {
		prompt, err = quickadd.NewPromptProvider(quickadd.PromptProviderOptions{
			Mode:        opts.prompt,
			Placeholder: opts.placeholder,
		})
		if err != nil {
			fmt.Fprintf(stderr, "sp-quick-add: %v\n", err)
			return 1
		}
	}

	var creator quickadd.TaskCreator
	if !opts.dryRun {
		bridge, err := pluginipc.NewClient(config.Load())
		if err != nil {
			fmt.Fprintf(stderr, "sp-quick-add: failed to init bridge: %v\n", err)
			return 1
		}
		creator = quickadd.BridgeTaskCreator{Bridge: bridge}
	}

	var notifier quickadd.Notifier
	if !opts.noNotify {
		notifier = quickadd.CommandNotifier{}
	}

	res, err := quickadd.Run(ctx, quickadd.Options{
		Title:       opts.title,
		DryRun:      opts.dryRun,
		Placeholder: opts.placeholder,
		Prompt:      prompt,
		Creator:     creator,
		Notifier:    notifier,
	})
	if err != nil {
		fmt.Fprintf(stderr, "sp-quick-add: %v\n", err)
		return 1
	}
	if res.DryRun && res.Title != "" {
		fmt.Fprintf(stdout, "dry-run: %s\n", res.Title)
	}
	return 0
}

func parseOptions(args []string, stderr io.Writer) (cliOptions, error) {
	var opts cliOptions
	fs := flag.NewFlagSet("sp-quick-add", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.StringVar(&opts.title, "title", "", "task title to create without prompting")
	fs.BoolVar(&opts.dryRun, "dry-run", false, "resolve the title but do not create a task")
	fs.StringVar(&opts.prompt, "prompt", string(quickadd.PromptModeWalker), "prompt adapter: walker")
	fs.BoolVar(&opts.noNotify, "no-notify", false, "disable notify-send success/failure notifications")
	fs.StringVar(&opts.placeholder, "placeholder", quickadd.DefaultPlaceholder, "prompt placeholder text")
	if err := fs.Parse(args); err != nil {
		return cliOptions{}, err
	}
	return opts, nil
}
