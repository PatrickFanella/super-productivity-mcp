package quickadd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

type PopupPromptOptions struct {
	Placeholder     string
	PopupDir        string
	ThemeCSSPath    string
	ConfigDir       string
	OmarchyThemeDir string
	Run             CommandRunner
}

type PopupPrompt struct {
	PopupJSPath string
	Placeholder string
	ThemeCSS    string
	Run         CommandRunner
}

func NewPopupPrompt(opts PopupPromptOptions) (PopupPrompt, error) {
	popupDir, err := ResolvePopupDir(opts.PopupDir)
	if err != nil {
		return PopupPrompt{}, err
	}
	themeOpts := defaultThemeOptions(opts.ThemeCSSPath, opts.ConfigDir, opts.OmarchyThemeDir)
	themeCSS, err := ResolveThemeCSS(themeOpts)
	if err != nil {
		return PopupPrompt{}, err
	}
	placeholder := opts.Placeholder
	if placeholder == "" {
		placeholder = DefaultPlaceholder
	}
	return PopupPrompt{
		PopupJSPath: filepath.Join(popupDir, "popup.js"),
		Placeholder: placeholder,
		ThemeCSS:    themeCSS,
		Run:         opts.Run,
	}, nil
}

func (p PopupPrompt) Prompt(ctx context.Context, opts PromptOptions) (string, error) {
	placeholder := p.Placeholder
	if opts.Placeholder != "" {
		placeholder = opts.Placeholder
	}
	themePath, cleanup, err := writeThemeCSS(p.ThemeCSS)
	if err != nil {
		return "", err
	}
	defer cleanup()

	args := []string{p.PopupJSPath, "--placeholder", placeholder}
	if themePath != "" {
		args = append(args, "--theme-css", themePath)
	}
	return CommandPrompt{Name: "gjs", Args: args, Run: p.Run}.Prompt(ctx, PromptOptions{})
}

func ResolvePopupDir(explicit string) (string, error) {
	if explicit != "" {
		return requirePopupDir(explicit, "--popup-dir")
	}
	if env := os.Getenv("SP_QUICK_ADD_POPUP_DIR"); env != "" {
		return requirePopupDir(env, "SP_QUICK_ADD_POPUP_DIR")
	}

	if cwd, err := os.Getwd(); err == nil {
		if dir, ok := popupDirIfValid(filepath.Join(cwd, "quickadd-popup")); ok {
			return dir, nil
		}
	}
	if dir, ok := popupDirFromExecutable(); ok {
		return dir, nil
	}
	if dir, ok := popupDirIfValid(defaultUserPopupDir()); ok {
		return dir, nil
	}
	return "", fmt.Errorf("quick-add popup assets not found; set SP_QUICK_ADD_POPUP_DIR or pass --popup-dir")
}

func requirePopupDir(dir string, label string) (string, error) {
	if resolved, ok := popupDirIfValid(dir); ok {
		return resolved, nil
	}
	return "", fmt.Errorf("%s %q does not contain popup.js", label, dir)
}

func popupDirIfValid(dir string) (string, bool) {
	if dir == "" {
		return "", false
	}
	if info, err := os.Stat(filepath.Join(dir, "popup.js")); err == nil && !info.IsDir() {
		return dir, true
	}
	return "", false
}

func popupDirFromExecutable() (string, bool) {
	exe, err := os.Executable()
	if err != nil {
		return "", false
	}
	prefix := filepath.Dir(filepath.Dir(exe))
	return popupDirIfValid(filepath.Join(prefix, "share", "super-productivity-mcp", "quickadd-popup"))
}

func defaultUserPopupDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "super-productivity-mcp", "quickadd-popup")
}

func defaultThemeOptions(explicitCSS string, configDir string, omarchyThemeDir string) ThemeOptions {
	custom := explicitCSS
	if custom == "" {
		custom = os.Getenv("SP_QUICK_ADD_THEME_CSS")
	}
	if configDir == "" {
		configDir = defaultConfigDir()
	}
	if custom == "" {
		custom = filepath.Join(configDir, "style.css")
	}
	if omarchyThemeDir == "" {
		omarchyThemeDir = defaultOmarchyThemeDir()
	}
	return ThemeOptions{CustomCSSPath: custom, OmarchyThemeDir: omarchyThemeDir}
}

func writeThemeCSS(css string) (string, func(), error) {
	if css == "" {
		return "", func() {}, nil
	}
	f, err := os.CreateTemp("", "sp-quick-add-theme-*.css")
	if err != nil {
		return "", nil, err
	}
	path := f.Name()
	if _, err := f.WriteString(css); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", nil, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", nil, err
	}
	return path, func() { _ = os.Remove(path) }, nil
}
