package pluginipc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/config"
	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

// requestLifecycle owns one request from inbox-write through one of the
// terminal outcomes (OK / ERROR / DEADLETTER / PLUGIN_STALLED / TIMEOUT /
// CANCELED). Splitting this out of Client makes the state machine testable
// without spinning up a full plugin.
type requestLifecycle struct {
	cfg config.Config
	fs  FS
	env Envelope

	inboxPath  string
	outboxPath string
	deadPath   string
}

func newRequestLifecycle(cfg config.Config, fs FS, env Envelope) *requestLifecycle {
	return &requestLifecycle{
		cfg:        cfg,
		fs:         fs,
		env:        env,
		inboxPath:  filepath.Join(cfg.InboxDir, env.ID+".json"),
		outboxPath: filepath.Join(cfg.OutboxDir, env.ID+".json"),
		deadPath:   filepath.Join(cfg.DeadDir, env.ID+".json"),
	}
}

// run drops the envelope into the inbox, then polls outbox/deadletter on
// cfg.PollInterval until something terminal happens.
//
// Outcomes (in order of priority each tick):
//
//	OK / ERROR  – outbox has a response file; ERROR if envelope.Error set.
//	DEADLETTER  – deadletter has the file but outbox does not.
//	CANCELED    – ctx done before any response.
//	PLUGIN_STALLED – overall timeout reached AND inbox still holds the
//	                 unread request (plugin never consumed it).
//	TIMEOUT     – overall timeout reached and the request was consumed but
//	              no response materialized.
func (l *requestLifecycle) run(ctx context.Context) (domain.Response, error) {
	if err := l.fs.WriteJSONAtomic(l.inboxPath, l.env); err != nil {
		return domain.Response{}, err
	}

	ticker := time.NewTicker(l.cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.Now().Add(l.cfg.Timeout)

	for {
		// Check for a terminal file before sleeping so a fast plugin
		// reply doesn't pay one full poll interval of latency.
		if resp, err, done := l.observe(); done {
			return resp, err
		}

		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.Canceled) {
				return domain.Response{}, ErrCanceled
			}
			// DeadlineExceeded falls through to ErrTimeout for symmetry
			// with the overall-timeout path.
			return domain.Response{}, ErrTimeout
		case <-ticker.C:
		}

		if time.Now().After(deadline) {
			// Last observation before declaring the verdict.
			if resp, err, done := l.observe(); done {
				return resp, err
			}
			// Stalled means the inbox file is still where we put it —
			// the plugin never picked it up.
			if _, err := os.Stat(l.inboxPath); err == nil {
				return domain.Response{}, ErrPluginStalled
			}
			return domain.Response{}, ErrTimeout
		}
	}
}

// observe checks for terminal files on disk. The third return is true iff
// the lifecycle is over (success or terminal error).
func (l *requestLifecycle) observe() (domain.Response, error, bool) {
	if _, err := os.Stat(l.outboxPath); err == nil {
		var resp Envelope
		if err := l.fs.ReadJSON(l.outboxPath, &resp); err != nil {
			return domain.Response{}, err, true
		}
		_ = os.Remove(l.outboxPath)
		if resp.Error != nil {
			return domain.Response{}, *resp.Error, true
		}
		return domain.Response{Result: resp.Result}, nil, true
	}
	if _, err := os.Stat(l.deadPath); err == nil {
		// Deadletter only counts as a terminal signal when there is no
		// outbox response; the JS plugin sometimes writes both, in
		// which case the outbox check above wins.
		return domain.Response{}, ErrDeadletter, true
	}
	return domain.Response{}, nil, false
}
