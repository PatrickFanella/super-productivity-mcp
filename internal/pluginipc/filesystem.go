package pluginipc

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type FS struct{}

func (FS) EnsureDirs(paths ...string) error {
	for _, p := range paths {
		if err := os.MkdirAll(p, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func (FS) WriteJSONAtomic(path string, v any) error {
	tmp := fmt.Sprintf("%s.tmp.%d", path, time.Now().UnixNano())
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func (FS) ReadJSON(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

func Join(elem ...string) string { return filepath.Join(elem...) }
