package pluginipc

import (
	"context"
	"errors"
	"fmt"
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

type terminalObservation struct {
	response domain.Response
	err      error
	done     bool
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
	l.emitEvent(eventRequestSent, l.actionDetails(nil))

	ticker := time.NewTicker(l.cfg.PollInterval)
	defer ticker.Stop()
	deadline := time.Now().Add(l.cfg.Timeout)

	for {
		// Check for a terminal file before sleeping so a fast plugin
		// reply doesn't pay one full poll interval of latency.
		if observed := l.observe(); observed.done {
			return observed.response, observed.err
		}

		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.Canceled) {
				l.emitEvent(eventRequestCanceled, l.actionDetails(nil))
				return domain.Response{}, ErrCanceled
			}
			// DeadlineExceeded falls through to ErrTimeout for symmetry
			// with the overall-timeout path.
			l.emitEvent(eventRequestTimeout, l.actionDetails(nil))
			return domain.Response{}, ErrTimeout
		case <-ticker.C:
		}

		if time.Now().After(deadline) {
			// Last observation before declaring the verdict.
			if observed := l.observe(); observed.done {
				return observed.response, observed.err
			}
			// Stalled means the inbox file is still where we put it —
			// the plugin never picked it up.
			if _, err := os.Stat(l.inboxPath); err == nil {
				l.emitEvent(eventRequestStalled, l.actionDetails(nil))
				return domain.Response{}, ErrPluginStalled
			}
			l.emitEvent(eventRequestTimeout, l.actionDetails(nil))
			return domain.Response{}, ErrTimeout
		}
	}
}

// observe checks for terminal files on disk. The done field is true iff the
// lifecycle is over (success or terminal error).
func (l *requestLifecycle) observe() terminalObservation {
	if _, err := os.Stat(l.outboxPath); err == nil {
		var resp Envelope
		if err := l.fs.ReadJSON(l.outboxPath, &resp); err != nil {
			return terminalObservation{err: err, done: true}
		}
		_ = os.Remove(l.outboxPath)
		if resp.Error != nil {
			l.emitEvent(eventResponseError, l.actionDetails(map[string]any{"code": resp.Error.Code}))
			return terminalObservation{err: *resp.Error, done: true}
		}
		l.emitEvent(eventResponseOK, l.actionDetails(nil))
		return terminalObservation{response: domain.Response{Result: resp.Result}, done: true}
	}
	if _, err := os.Stat(l.deadPath); err == nil {
		// Deadletter only counts as a terminal signal when there is no
		// outbox response; the JS plugin sometimes writes both, in
		// which case the outbox check above wins.
		l.emitEvent(eventRequestDeadletter, l.actionDetails(nil))
		return terminalObservation{err: ErrDeadletter, done: true}
	}
	return terminalObservation{}
}

func (l *requestLifecycle) actionDetails(extra map[string]any) map[string]any {
	details := map[string]any{"action": l.env.Action}
	for k, v := range extra {
		details[k] = v
	}
	return details
}

func (l *requestLifecycle) emitEvent(kind string, details map[string]any) {
	if l.cfg.EventsDir == "" {
		return
	}
	if details == nil {
		details = map[string]any{}
	}
	event := map[string]any{
		"kind":      kind,
		"requestId": l.env.ID,
		"action":    l.env.Action,
		"at":        time.Now().UTC().Format(time.RFC3339Nano),
		"details":   details,
	}
	name := fmt.Sprintf("%s-%d.json", l.env.ID, time.Now().UnixNano())
	_ = l.fs.WriteJSONAtomic(filepath.Join(l.cfg.EventsDir, name), event)
}
