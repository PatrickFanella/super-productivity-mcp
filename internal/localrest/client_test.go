package localrest

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PatrickFanella/super-productivity-mcp/internal/domain"
)

const testToken = "fixture-token-value"

type fixtureResponse struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
}

func loadEnvelopes(t *testing.T) map[string]fixtureResponse {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "test", "fixtures", "upstream", "v20", "rest-envelopes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Responses map[string]fixtureResponse `json:"responses"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Responses
}

// serve answers every request with the fixture response and records requests.
func serve(t *testing.T, fx fixtureResponse, seen *[]*http.Request) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = append(*seen, r.Clone(context.Background()))
		}
		for k, v := range fx.Headers {
			w.Header().Set(k, v)
		}
		w.WriteHeader(fx.Status)
		var text string
		if json.Unmarshal(fx.Body, &text) == nil {
			_, _ = w.Write([]byte(text)) // a string body is sent verbatim
			return
		}
		_, _ = w.Write(fx.Body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newClient(t *testing.T, base string) *Client {
	t.Helper()
	c, err := New(Config{BaseURL: base, Token: testToken, Timeout: 2 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func typed(t *testing.T, err error) domain.TypedError {
	t.Helper()
	var te domain.TypedError
	if !errors.As(err, &te) {
		t.Fatalf("expected TypedError, got %T %v", err, err)
	}
	if strings.Contains(te.Message, testToken) {
		t.Fatalf("error message leaks the token: %q", te.Message)
	}
	return te
}

func TestNewValidatesConfiguration(t *testing.T) {
	cases := []struct {
		cfg  Config
		code string
	}{
		{Config{}, CodeNotConfigured},
		{Config{BaseURL: "   "}, CodeNotConfigured},
		{Config{BaseURL: "127.0.0.1:3876"}, CodeMisconfigured},
		{Config{BaseURL: "ftp://127.0.0.1:3876"}, CodeMisconfigured},
		{Config{BaseURL: "http://user:pw@127.0.0.1:3876"}, CodeMisconfigured},
		{Config{BaseURL: "http://127.0.0.1:3876?x=1"}, CodeMisconfigured},
		{Config{BaseURL: "http://sp.example.com:3876"}, CodeMisconfigured},
		// The app listens on 127.0.0.1 only and its Host check refuses ::1.
		{Config{BaseURL: "http://[::1]:3876"}, CodeMisconfigured},
		{Config{BaseURL: "http://127.0.0.2:3876"}, CodeMisconfigured},
		{Config{BaseURL: "http://127.0.0.1:3876", Token: "abc\r\nX-Injected: 1"}, CodeMisconfigured},
	}
	for _, c := range cases {
		_, err := New(c.cfg)
		if te := typed(t, err); te.Code != c.code {
			t.Errorf("New(%+v) code = %s, want %s", c.cfg, te.Code, c.code)
		}
	}
	for _, base := range []string{"http://127.0.0.1:3876", "http://localhost:3876/", "http://127.0.0.1:4767/api"} {
		if _, err := New(Config{BaseURL: base}); err != nil {
			t.Errorf("New(%q): %v", base, err)
		}
	}
	if _, err := New(Config{BaseURL: "http://sp.example.com:3876", AllowRemote: true}); err != nil {
		t.Errorf("AllowRemote: %v", err)
	}
}

func TestDoDecodesSuccessAndSendsToken(t *testing.T) {
	fx := loadEnvelopes(t)["archiveOk"]
	var seen []*http.Request
	srv := serve(t, fx, &seen)
	data, err := newClient(t, srv.URL+"/").Do(context.Background(), Request{Method: http.MethodPost, Path: mustPath(t, "tasks", "fx-day-overdue", "archive"), Mutation: true})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	var got map[string]any
	_ = json.Unmarshal(data, &got)
	if got["archived"] != true || got["id"] != "fx-day-overdue" {
		t.Fatalf("data = %s", data)
	}
	if len(seen) != 1 {
		t.Fatalf("expected one request, got %d", len(seen))
	}
	r := seen[0]
	if r.Method != http.MethodPost || r.URL.Path != "/tasks/fx-day-overdue/archive" {
		t.Fatalf("request %s %s", r.Method, r.URL.Path)
	}
	if r.Header.Get("Authorization") != "Bearer "+testToken {
		t.Fatalf("missing bearer token")
	}
}

func TestDoKeepsPathPrefixAndEscapesSegments(t *testing.T) {
	var seen []*http.Request
	srv := serve(t, loadEnvelopes(t)["archiveOk"], &seen)
	_, err := newClient(t, srv.URL+"/api").Do(context.Background(), Request{Method: http.MethodPost, Path: mustPath(t, "tasks", "a/b?c", "archive"), Mutation: true})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got := seen[0].URL.EscapedPath(); got != "/api/tasks/a%2Fb%3Fc/archive" {
		t.Fatalf("path = %s", got)
	}
}

func TestDoClassifiesUpstreamErrors(t *testing.T) {
	envs := loadEnvelopes(t)
	cases := []struct {
		fixture   string
		mutation  bool
		code      string
		retryable bool
	}{
		{"unauthorized", false, CodeUnauthorized, false},
		{"apiDisabled", true, CodeUnavailable, true},
		{"appNotReady", true, CodeUnavailable, true},
		{"tooManyRequests", true, CodeUnavailable, true},
		{"routeNotFound", true, CodeUnsupportedRoute, false},
		{"archiveUnknown", true, "TASK_NOT_FOUND", false},
		{"archiveSubtask", true, CodeInvalidRequest, false},
		{"repeatCfgUnsupportedField", true, "UNSUPPORTED_FIELD", false},
		{"rendererTimeout", true, CodeOutcomeUnknown, false},
		{"rendererTimeout", false, CodeFailed, true},
		{"internalError", true, CodeOutcomeUnknown, false},
		{"malformed", true, CodeOutcomeUnknown, false},
		{"malformed", false, CodeMalformedResponse, false},
		{"successWithoutOk", true, CodeOutcomeUnknown, false},
		{"successWithoutOk", false, CodeMalformedResponse, false},
	}
	for _, c := range cases {
		fx := envs[c.fixture]
		srv := serve(t, fx, nil)
		_, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: fx.Method, Path: fx.Path, Mutation: c.mutation})
		te := typed(t, err)
		if te.Code != c.code || te.Retryable != c.retryable {
			t.Errorf("%s (mutation=%v): code=%s retryable=%v, want %s %v", c.fixture, c.mutation, te.Code, te.Retryable, c.code, c.retryable)
		}
		if strings.Contains(te.Message, "<html>") {
			t.Errorf("%s: message echoes the response body: %q", c.fixture, te.Message)
		}
	}
}

func TestDoRefusesRedirectsWithoutForwardingToken(t *testing.T) {
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		elsewhere.Add(1)
	}))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/steal", http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	_, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	if te := typed(t, err); te.Code != CodeRedirectRefused {
		t.Fatalf("code = %s", te.Code)
	}
	if elsewhere.Load() != 0 {
		t.Fatalf("redirect was followed")
	}
}

func TestDoIgnoresProxyEnvironment(t *testing.T) {
	var proxied atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied.Add(1)
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("ALL_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	srv := serve(t, loadEnvelopes(t)["health"], nil)
	if _, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: http.MethodGet, Path: "/health"}); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if proxied.Load() != 0 {
		t.Fatalf("request went through the proxy")
	}
}

func TestDoReportsRefusedConnectionAsUnavailable(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	_, err = newClient(t, "http://"+addr).Do(context.Background(), Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	te := typed(t, err)
	if te.Code != CodeUnavailable || !te.Retryable {
		t.Fatalf("refused connection: %+v", te)
	}
}

func TestDoTimeoutAfterSendIsUncertainForMutations(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
	}))
	defer srv.Close()
	defer close(release)
	c, err := New(Config{BaseURL: srv.URL, Timeout: 100 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Do(context.Background(), Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	if te := typed(t, err); te.Code != CodeOutcomeUnknown || te.Retryable {
		t.Fatalf("mutation timeout: %+v", te)
	}
	_, err = c.Do(context.Background(), Request{Method: http.MethodGet, Path: "/tasks"})
	if te := typed(t, err); te.Code != CodeTimeout || !te.Retryable {
		t.Fatalf("read timeout: %+v", te)
	}
}

func TestDoCanceledBeforeSend(t *testing.T) {
	srv := serve(t, loadEnvelopes(t)["archiveOk"], nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := newClient(t, srv.URL).Do(ctx, Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	if te := typed(t, err); te.Code != CodeCanceled {
		t.Fatalf("code = %s", te.Code)
	}
}

func mustPath(t *testing.T, segments ...string) string {
	t.Helper()
	p, err := SegmentPath(segments...)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSegmentPathRefusesDotSegments(t *testing.T) {
	for _, id := range []string{"", ".", ".."} {
		_, err := SegmentPath("tasks", id, "archive")
		if te := typed(t, err); te.Code != CodeInvalidRequest {
			t.Errorf("SegmentPath(%q) code = %s", id, te.Code)
		}
	}
	if got := mustPath(t, "tasks", "..x", "archive"); got != "/tasks/..x/archive" {
		t.Errorf("path = %s", got)
	}
}

func TestServerErrorMessageIsNotPassedThrough(t *testing.T) {
	srv := serve(t, fixtureResponse{Status: 500, Body: json.RawMessage(`{"ok":false,"error":{"code":"INTERNAL_ERROR","message":"Fixture private task title"}}`)}, nil)
	_, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: http.MethodGet, Path: "/tasks"})
	te := typed(t, err)
	if te.Code != CodeFailed || strings.Contains(te.Message, "Fixture private") {
		t.Fatalf("5xx read: %+v", te)
	}
}

func TestBodyCutOffAfterHeadersIsUncertainForMutations(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true`))
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Error("no hijacker")
			return
		}
		conn, _, _ := hj.Hijack()
		_ = conn.Close()
	}))
	defer srv.Close()
	_, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	if te := typed(t, err); te.Code != CodeOutcomeUnknown {
		t.Fatalf("code = %s", te.Code)
	}
}

func TestCancelAfterSendIsUncertainForMutations(t *testing.T) {
	received := make(chan struct{})
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(received)
		<-release
	}))
	defer srv.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-received
		cancel()
	}()
	_, err := newClient(t, srv.URL).Do(ctx, Request{Method: http.MethodPost, Path: "/tasks/x/archive", Mutation: true})
	if te := typed(t, err); te.Code != CodeOutcomeUnknown {
		t.Fatalf("code = %s", te.Code)
	}
}

func TestDoEncodesQuery(t *testing.T) {
	var seen []*http.Request
	srv := serve(t, loadEnvelopes(t)["health"], &seen)
	_, err := newClient(t, srv.URL).Do(context.Background(), Request{Method: http.MethodGet, Path: "/task-repeat-cfgs", Query: url.Values{"projectId": {"a b&c"}}})
	if err != nil {
		t.Fatal(err)
	}
	if got := seen[0].URL.Query().Get("projectId"); got != "a b&c" {
		t.Fatalf("projectId = %q", got)
	}
}
