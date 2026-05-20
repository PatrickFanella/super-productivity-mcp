package quickadd

import (
	"fmt"
	"os"
	"path/filepath"
)

type PromptMode string

const (
	PromptModeWalker PromptMode = "walker"
	PromptModePopup  PromptMode = "popup"
)

type PromptProviderOptions struct {
	Mode            string
	Placeholder     string
	PopupDir        string
	ThemeCSSPath    string
	ConfigDir       string
	OmarchyThemeDir string
	Run             CommandRunner
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
	case PromptModePopup:
		return NewPopupPrompt(PopupPromptOptions{
			Placeholder:     placeholder,
			PopupDir:        opts.PopupDir,
			ThemeCSSPath:    opts.ThemeCSSPath,
			ConfigDir:       opts.ConfigDir,
			OmarchyThemeDir: opts.OmarchyThemeDir,
			Run:             opts.Run,
		})
	default:
		return nil, fmt.Errorf("unknown prompt mode %q", opts.Mode)
	}
}

func defaultConfigDir() string {
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, "super-productivity-mcp", "quick-add")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "super-productivity-mcp", "quick-add")
}

func defaultOmarchyThemeDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "omarchy", "current", "theme")
}
