package quickadd

import "fmt"

type PromptMode string

const PromptModeWalker PromptMode = "walker"

type PromptProviderOptions struct {
	Mode        string
	Placeholder string
	Run         CommandRunner
}

func NewPromptProvider(opts PromptProviderOptions) (PromptProvider, error) {
	placeholder := opts.Placeholder
	if placeholder == "" {
		placeholder = DefaultPlaceholder
	}

	switch PromptMode(opts.Mode) {
	case "", PromptModeWalker:
		return CommandPrompt{
			Name: "walker",
			Args: []string{"--dmenu", "--inputonly", "--placeholder", placeholder},
			Run:  opts.Run,
		}, nil
	default:
		return nil, fmt.Errorf("unknown prompt mode %q", opts.Mode)
	}
}
